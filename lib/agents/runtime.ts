import { createHash } from "node:crypto";
import { recordAgentRun } from "@/lib/runtime/agent-runs";
import type { BridgeResult } from "@/lib/research/bridge";
import { resolveAgentDefinition, type AgentDefinition } from "./definitions";

/**
 * The Agent Runtime — the seam between the durable Job OS and a specialist agent.
 *
 * The division of authority (owner architecture, rung 3), enforced here:
 *   - The JOB OS owns lifecycle: retry, lease, dependency, dedupe, timeout, wake. This handler
 *     never implements its own retry loop — it either returns a result or throws a coded error and
 *     lets the queue's failure taxonomy decide (PERMANENT dies, RETRYABLE backs off).
 *   - The AGENT RUNTIME owns semantic execution: it resolves the static AgentDefinition, invokes the
 *     model through the gateway (the injected `research` core), and records the AgentRun with full
 *     provenance (agentId + version + jobId). One recording, here, not in the bridge.
 *   - The AGENT RECOMMENDS; deterministic governance decides. This handler never spends a trial,
 *     places an order, or validates anything. Its output is a research proposal an owner or a later
 *     job can act on — nothing privileged is reachable from it.
 *   - A DATA prerequisite failure is returned to the DEPENDENCY RESOLVER, not retried blindly: a
 *     missing history enqueues the ingestion and a research job that depends on it, so the work
 *     resumes when the data arrives (the same grammar every blocked workflow speaks).
 */

/** The injectable semantic core. Defaults to the real bridge; tests supply a deterministic double. */
export type ResearchCore = (instrumentId: string) => Promise<BridgeResult>;

async function defaultResearchCore(instrumentId: string): Promise<BridgeResult> {
  // record:false — this handler records the AgentRun with its agent/job provenance.
  const { researchInstrument } = await import("@/lib/research/bridge");
  return researchInstrument(instrumentId, { record: false });
}

export interface InstrumentResearchOutcome {
  ok: boolean;
  agentRunId: string;
  agentId: string;
  agentVersion: string;
  instrumentId: string;
  /** SOURCE_VERIFIED / CONFLICTED / INSUFFICIENT_EVIDENCE on success; a refusal code otherwise. */
  verification: string | null;
  /** Set when a DATA prerequisite deferred the run: the ingestion + dependent research were queued. */
  deferred?: { reason: string; dataState: string; ingestJobId: number | null };
}

/** Errors whose CODE prefix the queue's failure taxonomy already classifies. */
function coded(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

/**
 * Run the instrument-research agent for one durable job.
 *
 * @param instrumentId  the instrument to research
 * @param jobId         the durable job that owns this run's lifecycle
 * @param research      the semantic core (injectable for tests; defaults to the real bridge)
 */
export async function runInstrumentResearch(
  instrumentId: string,
  jobId: number | null,
  research: ResearchCore = defaultResearchCore,
): Promise<InstrumentResearchOutcome> {
  const definition: AgentDefinition = resolveAgentDefinition("research.instrument");
  const startedAt = new Date();
  const result = await research(instrumentId);

  if (result.ok) {
    const run = result.envelope.researchRun;
    recordAgentRun({
      id: run.runId,
      capability: definition.gatewayCapability,
      provider: run.provider,
      model: run.model,
      status: "COMPLETED",
      trigger: "LEARNING",
      instrumentId,
      evidenceFingerprint: result.envelope.inputEvidenceFingerprint,
      envelope: result.envelope,
      refusalCode: null,
      refusalMessage: null,
      tokens: run.tokens,
      cost: run.cost,
      costCurrency: run.costCurrency,
      fallbackReason: null,
      agentId: definition.agentId,
      agentVersion: definition.version,
      jobId,
      startedAt,
      completedAt: new Date(),
    });
    return {
      ok: true,
      agentRunId: run.runId,
      agentId: definition.agentId,
      agentVersion: definition.version,
      instrumentId,
      verification: result.envelope.status,
    };
  }

  // A failure still produces an AgentRun — a refusal is an outcome, recorded with the same weight
  // as a completion so the cockpit never looks healthy while research is silently stopped.
  const dataMissing = result.code === "NO_STORED_DATA";
  const agentRunId = `agr_${createHash("sha256")
    .update(`${instrumentId}|${result.code}|${startedAt.toISOString()}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
  recordAgentRun({
    id: agentRunId,
    capability: definition.gatewayCapability,
    provider: result.provider ?? "none",
    model: result.model ?? "none",
    status: dataMissing || result.code === "INSTRUMENT_UNKNOWN" ? "REFUSED" : "FAILED",
    trigger: "LEARNING",
    instrumentId,
    evidenceFingerprint: null,
    envelope: null,
    refusalCode: result.code,
    refusalMessage: result.message,
    tokens: result.tokens ?? null,
    cost: result.cost ?? null,
    costCurrency: result.costCurrency ?? null,
    fallbackReason: null,
    agentId: definition.agentId,
    agentVersion: definition.version,
    jobId,
    startedAt,
    completedAt: new Date(),
  });

  // DATA prerequisite → the dependency grammar, not a blind retry. Enqueue the ingestion and a
  // research job that DEPENDS on it, so this workflow resumes automatically when the bars arrive.
  // The current job then SUCCEEDS as "deferred" rather than failing — the work it needed is owned.
  if (dataMissing) {
    const { resolveDataRequirement, dedupeKeyFor } = await import("@/lib/brain/dependency-resolver");
    const { enqueueDependent } = await import("@/lib/research/queue");
    const resolution = await resolveDataRequirement({ instrumentId, purpose: "research" });
    if (resolution.jobId !== null) {
      enqueueDependent(
        { kind: "instrument_research", payload: { instrumentId }, dedupeKey: `instrument-research-${instrumentId}` },
        [resolution.jobId],
      );
    }
    return {
      ok: false,
      agentRunId,
      agentId: definition.agentId,
      agentVersion: definition.version,
      instrumentId,
      verification: result.code,
      deferred: { reason: result.code, dataState: resolution.state, ingestJobId: resolution.jobId },
    };
  }

  // Everything else is a real failure the Job OS should retry (or, for a permanent code like
  // INSTRUMENT_UNKNOWN, kill). The AgentRun above is the durable record of this attempt.
  throw coded(result.code, result.message);
}
