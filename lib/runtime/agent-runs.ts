import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  ResearchProposalEnvelopeSchema,
  type ResearchProposalEnvelope,
} from "@/lib/research/proposal-contract";

/**
 * The AgentRun ledger (§28) — what the system actually did, including what it refused to do.
 *
 * Refusals are recorded with the same weight as completions. A ledger that only keeps successes
 * produces a cockpit that looks healthy while research is silently stopped, which is the exact
 * failure the Brain surface exists to prevent: the owner needs "the provider was quota-blocked at
 * 02:14" to be visible evidence, not an absence.
 */

export type AgentRunStatus = "COMPLETED" | "REFUSED" | "FAILED";
export type AgentRunTrigger = "USER" | "SCHEDULE" | "MARKET_EVENT" | "LEARNING" | "FAILURE";

export interface RecordAgentRunInput {
  id: string;
  capability: string;
  provider: string;
  model: string;
  status: AgentRunStatus;
  trigger: AgentRunTrigger;
  instrumentId: string | null;
  evidenceFingerprint: string | null;
  envelope: ResearchProposalEnvelope | null;
  refusalCode: string | null;
  refusalMessage: string | null;
  tokens: number | null;
  cost: number | null;
  costCurrency: string | null;
  fallbackReason: string | null;
  /** Provenance (0020): the AgentDefinition and durable job behind this run. Null for browser runs. */
  agentId?: string | null;
  agentVersion?: string | null;
  jobId?: number | null;
  /** Provenance (0021): the TeamRun this run was a chief/member of. Null for solo runs. */
  teamRunId?: string | null;
  startedAt: Date;
  completedAt: Date;
}

export function recordAgentRun(input: RecordAgentRunInput): string {
  getDb()
    .insert(schema.agentRuns)
    .values({
      id: input.id,
      capability: input.capability,
      provider: input.provider,
      model: input.model,
      status: input.status,
      trigger: input.trigger,
      instrumentId: input.instrumentId,
      evidenceFingerprint: input.evidenceFingerprint,
      // Derived from the envelope, never accepted as a separate claim that could drift from it.
      verificationStatus: input.envelope?.status ?? null,
      envelope: input.envelope ? JSON.stringify(input.envelope) : null,
      refusalCode: input.refusalCode,
      refusalMessage: input.refusalMessage,
      tokens: input.tokens,
      cost: input.cost,
      costCurrency: input.costCurrency,
      fallbackReason: input.fallbackReason,
      agentId: input.agentId ?? null,
      agentVersion: input.agentVersion ?? null,
      jobId: input.jobId ?? null,
      teamRunId: input.teamRunId ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    })
    // Idempotent by id, LATEST OUTCOME WINS: the durable-job paths use DETERMINISTIC run ids (a team
    // member's id is sha(teamRunId|role|instrument)), so a Job-OS retry of the same job re-records the
    // same id. A plain insert would throw on the primary key; a no-op would freeze a stale outcome
    // (a member that FAILED on attempt 1 then SUCCEEDED on retry would read FAILED forever, lying to
    // the ledger). Overwriting with the new attempt's outcome keeps exactly one row per logical run
    // AND keeps it truthful. Unique-id callers (the browser/single-agent paths) never conflict.
    .onConflictDoUpdate({
      target: schema.agentRuns.id,
      set: {
        capability: input.capability,
        provider: input.provider,
        model: input.model,
        status: input.status,
        trigger: input.trigger,
        instrumentId: input.instrumentId,
        evidenceFingerprint: input.evidenceFingerprint,
        verificationStatus: input.envelope?.status ?? null,
        envelope: input.envelope ? JSON.stringify(input.envelope) : null,
        refusalCode: input.refusalCode,
        refusalMessage: input.refusalMessage,
        tokens: input.tokens,
        cost: input.cost,
        costCurrency: input.costCurrency,
        fallbackReason: input.fallbackReason,
        agentId: input.agentId ?? null,
        agentVersion: input.agentVersion ?? null,
        jobId: input.jobId ?? null,
        teamRunId: input.teamRunId ?? null,
        completedAt: input.completedAt,
      },
    })
    .run();
  return input.id;
}

export interface StoredResearchRun {
  runId: string;
  envelope: ResearchProposalEnvelope;
  completedAt: string;
}

/**
 * The most recent COMPLETED research run for an instrument, if one survives.
 *
 * Re-validated through the contract schema on the way out rather than trusted because it came
 * from our own database: a row written by an older build with a different schema must fail
 * loudly here, not render as a proposal with missing fields. A row that no longer parses is
 * treated as absent — the surface then offers to research again, which is honest, instead of
 * showing a half-envelope.
 */
export function latestResearchRun(instrumentId: string): StoredResearchRun | null {
  const row = getDb()
    .select()
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.instrumentId, instrumentId),
        eq(schema.agentRuns.status, "COMPLETED"),
      ),
    )
    .orderBy(desc(schema.agentRuns.completedAt))
    .get();

  if (!row?.envelope) return null;

  const parsed = ResearchProposalEnvelopeSchema.safeParse(JSON.parse(row.envelope));
  if (!parsed.success) return null;

  return { runId: row.id, envelope: parsed.data, completedAt: row.completedAt.toISOString() };
}

export interface AgentRunSummary {
  runId: string;
  capability: string;
  provider: string;
  model: string;
  status: AgentRunStatus;
  instrumentId: string | null;
  verificationStatus: string | null;
  refusalCode: string | null;
  refusalMessage: string | null;
  tokens: number | null;
  cost: number | null;
  costCurrency: string | null;
  completedAt: string;
}

/** Newest first — what /brain's Researching lane renders, refusals included. */
export function listAgentRuns(limit = 20): AgentRunSummary[] {
  return getDb()
    .select()
    .from(schema.agentRuns)
    .orderBy(desc(schema.agentRuns.completedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      runId: row.id,
      capability: row.capability,
      provider: row.provider,
      model: row.model,
      status: row.status as AgentRunStatus,
      instrumentId: row.instrumentId,
      verificationStatus: row.verificationStatus,
      refusalCode: row.refusalCode,
      refusalMessage: row.refusalMessage,
      tokens: row.tokens,
      cost: row.cost,
      costCurrency: row.costCurrency,
      completedAt: row.completedAt.toISOString(),
    }));
}
