import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { searchInstruments } from "@/lib/market/catalog";
import { parseInstrument } from "@/lib/market/instruments";
import { buildResearchSnapshot, getNormalizedQuote } from "@/lib/market/service";
import { buildEvidencePackage } from "@/lib/ai/evidence";
import { persistEvidencePackage } from "@/lib/ai/evidence-store";
import { getPaperPortfolio } from "@/lib/paper/service";
import { getPaperRiskSummary } from "@/lib/paper/risk";
import { fetchQuantResource } from "@/lib/quantcore/client";
import { QUANT_RESOURCES } from "@/lib/quantcore/contract";
import { AnalystRecordSchema } from "@/lib/analyst/schema";
import { listAnalyses, listAnalysesForInstrument, recordAnalysis } from "@/lib/analyst/service";
import {
  listAudit,
  recordClaim,
  recordConcept,
  recordFailure,
  recordHypothesis,
  recordLesson,
  recordSource,
  traceBack,
  traceForward,
} from "@/lib/knowledge/repository";
import { EPISTEMIC_STATUSES, LESSON_LEVELS, PLANES, SOURCE_KINDS } from "@/lib/knowledge/types";
import { JOB_KINDS, JOB_STATUSES, enqueue, listJobs, queueStats } from "@/lib/research/queue";
import { getLearningMode } from "@/lib/governance/runtime";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Writes to the local knowledge store only. These tools cannot reach a broker, an
 * external service, or the filesystem outside the application database.
 */
const localWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const FormatSchema = z.enum(["concise", "detailed"]).default("concise");
const MAX_OUTPUT_CHARACTERS = 20_000;

function bounded(value: unknown): Record<string, unknown> {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= MAX_OUTPUT_CHARACTERS) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  }
  return {
    truncated: true,
    originalCharacters: text.length,
    preview: text.slice(0, MAX_OUTPUT_CHARACTERS - 200),
    guidance: "Request concise format or fewer instruments.",
  };
}

function result(value: unknown) {
  const structuredContent = bounded(value);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function conciseSnapshot(snapshot: Awaited<ReturnType<typeof buildResearchSnapshot>>) {
  return {
    instrument: snapshot.instrument,
    quote: snapshot.quote,
    technicals: snapshot.technicals,
    signals: snapshot.signals,
    fundamentals: snapshot.fundamentals,
    generatedAt: snapshot.generatedAt,
    snapshotId: snapshot.snapshotId,
  };
}

export function createMarketPulseMcpServer(): McpServer {
  const server = new McpServer({ name: "marketpulse", version: "0.2.0" });

  server.registerTool(
    "marketpulse_search_instruments",
    {
      description: "Search the supported US, NSE, and BSE cash-equity catalog. Read-only.",
      inputSchema: z.object({
        query: z.string().trim().max(80).default(""),
        exchange: z.enum(["XNAS", "XNYS", "XNSE", "XBOM"]).optional(),
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ query, exchange }) => result({ instruments: searchInstruments(query, exchange) }),
  );

  server.registerTool(
    "marketpulse_get_quote",
    {
      description: "Get one normalized research quote with currency, source, age, and quality. Read-only.",
      inputSchema: z.object({ instrumentId: z.string().min(1).max(64) }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ instrumentId }) => result(await getNormalizedQuote(parseInstrument(instrumentId))),
  );

  server.registerTool(
    "marketpulse_get_research_snapshot",
    {
      description: "Get bounded technical, fundamental, news, and provenance evidence for one instrument. Read-only.",
      inputSchema: z.object({
        instrumentId: z.string().min(1).max(64),
        format: FormatSchema,
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ instrumentId, format }) => {
      const snapshot = await buildResearchSnapshot(parseInstrument(instrumentId));
      const evidencePackage = buildEvidencePackage(snapshot);
      persistEvidencePackage(evidencePackage);
      return result(format === "concise" ? { ...conciseSnapshot(snapshot), evidencePackage } : { ...snapshot, evidencePackage });
    },
  );

  server.registerTool(
    "marketpulse_compare_instruments",
    {
      description: "Compare two to five normalized US/NSE/BSE research snapshots. Read-only.",
      inputSchema: z.object({
        instrumentIds: z.array(z.string().min(1).max(64)).min(2).max(5),
        format: FormatSchema,
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ instrumentIds, format }) => {
      const snapshots = await Promise.all(instrumentIds.map((id) => buildResearchSnapshot(parseInstrument(id))));
      return result({
        comparisons: snapshots.map((snapshot) => format === "concise" ? conciseSnapshot(snapshot) : snapshot),
      });
    },
  );

  server.registerTool(
    "marketpulse_get_watchlist",
    {
      description: "List the local research watchlist without changing it. Read-only.",
      inputSchema: z.object({ format: FormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async () => {
      const tickers = getDb().select().from(schema.userWatchlist).all().map((row) => row.ticker);
      return result({ tickers, count: tickers.length });
    },
  );

  server.registerTool(
    "marketpulse_get_paper_portfolio",
    {
      description: "Read separate USD and INR paper cash, positions, and recent paper orders. Read-only.",
      inputSchema: z.object({ format: FormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ format }) => {
      const portfolio = getPaperPortfolio();
      return result(format === "concise" ? {
        accounts: portfolio.accounts,
        positions: portfolio.positions,
        recentOrders: portfolio.orders.slice(0, 10),
      } : portfolio);
    },
  );

  server.registerTool(
    "marketpulse_get_risk_summary",
    {
      description: "Read deterministic paper exposure and capital-utilization metrics. Read-only.",
      inputSchema: z.object({ format: FormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async () => result(getPaperRiskSummary()),
  );

  server.registerTool(
    "marketpulse_quantcore",
    {
      description:
        "Read a resource from the Python quant core (health, board, universe, forwardOutcomes, regime, trials). " +
        "Returns an explicit unavailable or not-provided code rather than fabricating data. Read-only.",
      inputSchema: z.object({ resource: z.enum(QUANT_RESOURCES) }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ resource }) => result(await fetchQuantResource(resource)),
  );

  server.registerTool(
    "marketpulse_system_status",
    {
      description: "Read learning mode, execution capability, and quant-core reachability in one call. Read-only.",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    async () =>
      result({
        learningMode: getLearningMode(),
        execution: { enabled: false, reason: "EXECUTION_ADAPTER_MISSING" },
        quantCore: await fetchQuantResource("health"),
      }),
  );

  server.registerTool(
    "marketpulse_record_analysis",
    {
      description:
        "Record a structured analysis with an explicit stance, bull/bear/neutral debate, epistemically tagged " +
        "evidence, risks, and invalidation conditions. A directional stance requires at least one item of known " +
        "or historically observed evidence and at least one invalidation condition, otherwise choose abstain. " +
        "This records research only and carries no order authority.",
      inputSchema: AnalystRecordSchema,
      annotations: localWriteAnnotations,
    },
    async (input) => {
      try {
        const stored = recordAnalysis(input);
        return result({
          recorded: true,
          id: stored.id,
          stance: stored.stance,
          epistemicProfile: stored.epistemicProfile,
          note: "Recorded as research. This system has no execution path.",
        });
      } catch (error) {
        return result({
          recorded: false,
          code: error instanceof Error ? error.name : "ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "marketpulse_list_analyses",
    {
      description: "List recorded analyses, optionally for one instrument. Read-only.",
      inputSchema: z
        .object({
          instrumentId: z.string().trim().max(64).optional(),
          limit: z.number().int().min(1).max(50).default(10),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ instrumentId, limit }) =>
      result({
        analyses: (instrumentId ? listAnalysesForInstrument(instrumentId, limit) : listAnalyses(limit)).map(
          (analysis) => ({
            id: analysis.id,
            instrumentId: analysis.instrumentId,
            stance: analysis.stance,
            conviction: analysis.conviction,
            summary: analysis.summary,
            epistemicProfile: analysis.epistemicProfile,
            recordedAt: analysis.recordedAt,
          }),
        ),
      }),
  );

  server.registerTool(
    "marketpulse_record_source",
    {
      description:
        "Archive a research source (paper, video, repository, report, documentation, web) in durable memory. " +
        "Deduplicates by content hash and returns the existing id when the content was seen before.",
      inputSchema: z
        .object({
          kind: z.enum(SOURCE_KINDS),
          title: z.string().trim().min(3).max(300),
          content: z.string().min(1).max(200_000),
          url: z.string().trim().max(500).optional(),
          locator: z.string().trim().max(200).optional(),
          license: z.string().trim().max(80).optional(),
          authors: z.array(z.string().trim().max(120)).max(20).optional(),
        })
        .strict(),
      annotations: localWriteAnnotations,
    },
    async (input) => result(recordSource(input)),
  );

  server.registerTool(
    "marketpulse_record_claim",
    {
      description:
        "Extract one claim from an archived source, tagged with its epistemic status. " +
        "Use 'known' only for directly observed facts; use 'inferred' when reasoning beyond the source.",
      inputSchema: z
        .object({
          sourceId: z.string().trim().min(1).max(64),
          statement: z.string().trim().min(5).max(1_000),
          locator: z.string().trim().max(200).optional(),
          epistemicStatus: z.literal("inferred").default("inferred"),
          confidence: z.number().min(0).max(1).optional(),
          indiaRelevant: z.boolean().optional(),
        })
        .strict(),
      annotations: localWriteAnnotations,
    },
    async (input) => {
      try {
        return result({ claimId: recordClaim(input) });
      } catch (error) {
        return result({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "marketpulse_record_hypothesis",
    {
      description:
        "Register a testable hypothesis derived from a claim. A hypothesis is not evidence — it enters the " +
        "validation gauntlet before it can become a paper challenger.",
      inputSchema: z
        .object({
          claimId: z.string().trim().max(64).optional(),
          title: z.string().trim().min(3).max(200),
          statement: z.string().trim().min(10).max(1_000),
          rationale: z.string().trim().max(2_000).optional(),
          market: z.enum(["US", "NSE", "BSE"]).optional(),
        })
        .strict(),
      annotations: localWriteAnnotations,
    },
    async (input) => result({ hypothesisId: recordHypothesis({ ...input, createdBy: "claude_code" }) }),
  );

  server.registerTool(
    "marketpulse_record_lesson",
    {
      description:
        "Write a teaching note into durable memory. Every citation must resolve to an archived source or a " +
        "recorded claim — uncited lessons are rejected.",
      inputSchema: z
        .object({
          plane: z.enum(PLANES),
          level: z.enum(LESSON_LEVELS),
          title: z.string().trim().min(3).max(200),
          body: z.string().trim().min(20).max(20_000),
          citations: z.array(z.string().trim().min(1).max(64)).min(1).max(20),
          concept: z
            .object({ name: z.string().trim().min(2).max(120), summary: z.string().trim().min(5).max(1_000) })
            .strict()
            .optional(),
        })
        .strict(),
      annotations: localWriteAnnotations,
    },
    async ({ concept, plane, ...rest }) => {
      try {
        const conceptId = concept ? recordConcept(plane, concept.name, concept.summary) : undefined;
        return result({ lessonId: recordLesson({ ...rest, plane, conceptId }), conceptId });
      } catch (error) {
        return result({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "marketpulse_record_failure",
    {
      description:
        "Record a failure and the lesson drawn from it, so the same dead end is not explored twice. " +
        "Failures are permanent: they cannot be deleted once written.",
      inputSchema: z
        .object({
          scope: z.enum(["strategy", "feature", "data", "system"]),
          failureMode: z.string().trim().min(3).max(120),
          detail: z.string().trim().min(10).max(4_000),
          subjectId: z.string().trim().max(64).optional(),
          lesson: z.string().trim().max(2_000).optional(),
        })
        .strict(),
      annotations: localWriteAnnotations,
    },
    async ({ scope, failureMode, detail, subjectId, lesson }) =>
      result({ failureId: recordFailure(scope, failureMode, detail, subjectId, lesson) }),
  );

  server.registerTool(
    "marketpulse_memory_trace",
    {
      description:
        "Trace the memory graph. Direction 'forward' walks from a source to everything it produced; " +
        "'back' walks from any node to the sources that justify it. Read-only.",
      inputSchema: z
        .object({
          nodeId: z.string().trim().min(1).max(64),
          direction: z.enum(["forward", "back"]).default("back"),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ nodeId, direction }) => {
      try {
        return result(direction === "forward" ? traceForward(nodeId) : traceBack(nodeId));
      } catch (error) {
        return result({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "marketpulse_get_audit",
    {
      description: "Read the append-only governance audit trail of allowed and denied actions. Read-only.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ limit }) => result({ events: listAudit(limit) }),
  );

  server.registerTool(
    "marketpulse_enqueue_research",
    {
      description:
        "Queue a source for the research factory. The worker archives, links and deduplicates it without a " +
        "model, so supply any claims and hypotheses you have already extracted — the worker will not invent them.",
      inputSchema: z
        .object({
          kind: z.enum(JOB_KINDS),
          dedupeKey: z.string().trim().max(200).optional(),
          priority: z.number().int().min(1).max(1_000).optional(),
          payload: z
            .object({
              kind: z.enum(SOURCE_KINDS),
              title: z.string().trim().min(3).max(300),
              content: z.string().min(1).max(200_000),
              url: z.string().trim().max(500).optional(),
              license: z.string().trim().max(80).optional(),
              claims: z
                .array(
                  z
                    .object({
                      statement: z.string().trim().min(5).max(1_000),
                      locator: z.string().trim().max(200).optional(),
                      epistemicStatus: z.enum(EPISTEMIC_STATUSES).optional(),
                      confidence: z.number().min(0).max(1).optional(),
                    })
                    .strict(),
                )
                .max(50)
                .optional(),
              hypotheses: z
                .array(
                  z
                    .object({
                      title: z.string().trim().min(3).max(200),
                      statement: z.string().trim().min(10).max(1_000),
                      rationale: z.string().trim().max(2_000).optional(),
                      market: z.enum(["US", "NSE", "BSE"]).optional(),
                    })
                    .strict(),
                )
                .max(20)
                .optional(),
            })
            .strict(),
        })
        .strict(),
      annotations: localWriteAnnotations,
    },
    async ({ kind, payload, dedupeKey, priority }) =>
      result(enqueue({ kind, payload: payload as unknown as Record<string, unknown>, dedupeKey, priority })),
  );

  server.registerTool(
    "marketpulse_research_queue",
    {
      description: "Read research queue state and recent jobs. Read-only.",
      inputSchema: z
        .object({ status: z.enum(JOB_STATUSES).optional(), limit: z.number().int().min(1).max(100).default(20) })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ status, limit }) =>
      result({
        stats: queueStats(),
        jobs: listJobs(status, limit).map((job) => ({
          id: job.id,
          kind: job.kind,
          status: job.status,
          attempts: job.attempts,
          lastError: job.lastError,
        })),
      }),
  );

  return server;
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  void serveStdio(createMarketPulseMcpServer);
  console.error("MarketPulse MCP server running on stdio");
}
