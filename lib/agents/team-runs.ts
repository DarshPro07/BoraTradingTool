import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * The TeamRun ledger — what a Chief-of-Staff team DID, recorded once, pinning the versioned
 * TeamDefinition. Distinct from an AgentRun (one model call) the way AgentRun is from AgentDefinition.
 *
 * Two things are persisted at defined moments, not left in memory:
 *   - the TeamExecutionPlan is written BEFORE any member runs, so "the manager silently rewrote the
 *     team every turn" cannot happen — the plan of record exists before the work does;
 *   - the TeamResult is written AFTER synthesis, with dissent preserved as first-class fields.
 */

/** The plan the Chief-of-Staff commits to before specialists run. Persisted; not silently rewritten. */
export interface TeamExecutionPlan {
  objective: string;
  roles: string[];
  tasks: { role: string; task: string }[];
  /** Groups of roles that may run concurrently. */
  parallelGroups: string[][];
  artifactContracts: { role: string; kind: string }[];
  stopConditions: string[];
  budget: {
    maxAgents: number;
    maxParallel: number;
    maxModelCalls: number;
    maxTokens: number | null;
    maxCost: number | null;
    maxDurationMs: number;
  };
  /**
   * The ModelRouter's per-role decision (rung 4), recorded so "which model, and why" is observable.
   * Omitted when no roster is wired yet (a one-model machine, or the roster not yet connected) — the
   * routing POLICY exists regardless; this is where its decisions land once a roster is present.
   */
  modelAssignments?: {
    role: string;
    providerId: string | null;
    modelId: string | null;
    /** EMPIRICAL (earned on measured history) · PRIOR (unproven, judged on priors) · REFUSED. */
    source: string;
    reason: string;
  }[];
}

/** The synthesized outcome. Dissent is a first-class field — it is never discarded into a consensus. */
export interface TeamResult {
  conclusion: string;
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  unresolvedQuestions: string[];
  dissent: { role: string; concern: string }[];
  confidenceBasis: string;
  /** The strongest thing a team may do: recommend. Deterministic governance decides consequences. */
  recommendation: "GENERATE_STRATEGY_CANDIDATE" | "NEEDS_MORE_EVIDENCE" | "ABSTAIN";
}

export type TeamRunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface CreateTeamRunInput {
  id: string;
  teamId: string;
  teamVersion: string;
  jobId: number | null;
  instrumentId: string | null;
  plan: TeamExecutionPlan;
  startedAt?: Date;
}

/** Open a TeamRun in RUNNING and persist its plan in the same write — the plan exists before members do. */
export function createTeamRun(input: CreateTeamRunInput): string {
  getDb()
    .insert(schema.teamRuns)
    .values({
      id: input.id,
      teamId: input.teamId,
      teamVersion: input.teamVersion,
      jobId: input.jobId,
      instrumentId: input.instrumentId,
      status: "RUNNING",
      chiefAgentRunId: null,
      memberAgentRunIds: JSON.stringify([]),
      artifactIds: JSON.stringify([]),
      plan: JSON.stringify(input.plan),
      result: null,
      tokens: null,
      cost: null,
      costCurrency: null,
      error: null,
      startedAt: input.startedAt ?? new Date(),
      completedAt: null,
    })
    .onConflictDoNothing({ target: schema.teamRuns.id })
    .run();
  return input.id;
}

export interface CompleteTeamRunInput {
  id: string;
  chiefAgentRunId: string;
  memberAgentRunIds: string[];
  artifactIds: string[];
  result: TeamResult;
  tokens: number | null;
  cost: number | null;
  costCurrency: string | null;
  completedAt?: Date;
}

export function completeTeamRun(input: CompleteTeamRunInput): void {
  getDb()
    .update(schema.teamRuns)
    .set({
      status: "COMPLETED",
      chiefAgentRunId: input.chiefAgentRunId,
      memberAgentRunIds: JSON.stringify(input.memberAgentRunIds),
      artifactIds: JSON.stringify(input.artifactIds),
      result: JSON.stringify(input.result),
      tokens: input.tokens,
      cost: input.cost,
      costCurrency: input.costCurrency,
      completedAt: input.completedAt ?? new Date(),
    })
    .where(eq(schema.teamRuns.id, input.id))
    .run();
}

export function failTeamRun(id: string, error: string, memberAgentRunIds: string[] = []): void {
  getDb()
    .update(schema.teamRuns)
    .set({
      status: "FAILED",
      error,
      memberAgentRunIds: JSON.stringify(memberAgentRunIds),
      completedAt: new Date(),
    })
    .where(eq(schema.teamRuns.id, id))
    .run();
}

export interface StoredTeamRun {
  id: string;
  teamId: string;
  teamVersion: string;
  jobId: number | null;
  instrumentId: string | null;
  status: TeamRunStatus;
  chiefAgentRunId: string | null;
  memberAgentRunIds: string[];
  artifactIds: string[];
  plan: TeamExecutionPlan | null;
  result: TeamResult | null;
  error: string | null;
}

export function getTeamRun(id: string): StoredTeamRun | null {
  const row = getDb().select().from(schema.teamRuns).where(eq(schema.teamRuns.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    teamId: row.teamId,
    teamVersion: row.teamVersion,
    jobId: row.jobId,
    instrumentId: row.instrumentId,
    status: row.status as TeamRunStatus,
    chiefAgentRunId: row.chiefAgentRunId,
    memberAgentRunIds: row.memberAgentRunIds ? (JSON.parse(row.memberAgentRunIds) as string[]) : [],
    artifactIds: row.artifactIds ? (JSON.parse(row.artifactIds) as string[]) : [],
    plan: row.plan ? (JSON.parse(row.plan) as TeamExecutionPlan) : null,
    result: row.result ? (JSON.parse(row.result) as TeamResult) : null,
    error: row.error,
  };
}
