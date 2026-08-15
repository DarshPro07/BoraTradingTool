import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { TeamExecutionPlan, TeamResult } from "@/lib/agents/team-runs";

/**
 * The Brain execution trace — ONE read model over the ledgers the runtime already writes.
 *
 * Derived, never duplicated (owner rule: no second tracing database): `team_runs` +
 * `agent_runs` + `agent_artifacts` + `research_jobs` are the authoritative records, and every
 * edge here is ID-EXACT — the member-run and artifact ids are deterministic
 * (`agr_sha(teamRunId|role|instrument)`, `art_sha(teamRunId|role)`), so role attribution is
 * recomputed from identity, never guessed from symbols, minutes, or "latest row".
 *
 * Honesty rules carried through:
 *   - ASSIGNED (the plan's ModelRouter decision, with its binding) and EXECUTED (the run's
 *     recorded model) are separate fields with a verification class — never collapsed.
 *   - Totals reconcile against the children or say so (`reconciled`).
 *   - Tokens are measured; cost is a sum ONLY of provider-reported costs — absent pricing is
 *     "COST UNAVAILABLE", never an estimate.
 *   - A FAILED member appears as failed; a Job-OS retry re-records the same logical id, so a
 *     retried member is ONE truthful row, not two successes.
 *   - Job state comes from the job row — team completion never infers it.
 */

const sha = (input: string) => createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);

export interface ExecutionArtifactView {
  id: string;
  role: string;
  kind: string;
  producerAgentRunId: string | null;
  createdAt: string;
  bytes: number;
  /** Consumption edges are not recorded by the runtime yet — stated, not fabricated. */
  consumers: "unrecorded";
}

export interface ExecutionMemberView {
  role: string;
  agentRunId: string;
  /** AgentDefinition provenance, from the run row. */
  agentId: string | null;
  agentVersion: string | null;
  status: string;
  /** The plan's ModelRouter decision for this role — what SHOULD run, and why. */
  assigned: {
    providerId: string | null;
    modelId: string | null;
    binding: string | null;
    source: string | null;
    reason: string | null;
  } | null;
  /** What the ledger says actually ran. */
  executed: { provider: string; model: string } | null;
  /** RESPONSE_REPORTED | USAGE_REPORTED | REQUEST_BOUND_ONLY from the envelope; UNRECORDED for rows predating the field. */
  modelVerification: string;
  refusalCode: string | null;
  refusalMessage: string | null;
  tokens: number | null;
  cost: number | null;
  costCurrency: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  artifacts: ExecutionArtifactView[];
}

export interface ExecutionTotals {
  /** Null = UNMEASURED (no usage reported). Never 0-as-a-stand-in — see tokensMeasurement. */
  tokens: number | null;
  /**
   * Measurement census over MODEL-CALL members only (ledger-recorded runs whose provider is not
   * "deterministic" — the deterministic chief spends no tokens BY DESIGN, it is not a model
   * call). MEASURED = every such member reported usage; PARTIAL = a strict subset did, so
   * `tokens` is a subset sum, not a total; UNMEASURED = none did (tokens is null).
   */
  tokensMeasurement: "MEASURED" | "PARTIAL" | "UNMEASURED";
  /** Sum of provider-REPORTED costs only, single-currency. Null = COST UNAVAILABLE. */
  cost: number | null;
  costCurrency: string | null;
  artifactCount: number;
  dissentCount: number;
  unresolvedCount: number;
  membersFailed: number;
}

export interface ExecutionTrace {
  teamRunId: string;
  teamId: string;
  teamVersion: string;
  instrumentId: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  /** The lifecycle authority, read from ITS OWN row — never inferred from team status. */
  job: { id: number; kind: string; status: string; attempts: number; lastError: string | null } | null;
  objective: string | null;
  parallelGroups: string[][] | null;
  members: ExecutionMemberView[];
  result: TeamResult | null;
  totals: ExecutionTotals;
  /** True when the team row's token total equals the sum over child runs (both measured). */
  /** true/false when both sides are measured; null when there is nothing to compare. */
  reconciled: boolean | null;
}

export interface ExecutionSummary {
  teamRunId: string;
  teamId: string;
  instrumentId: string | null;
  status: string;
  startedAt: string;
  durationMs: number | null;
  memberCount: number;
  artifactCount: number;
  dissentCount: number;
  tokens: number | null;
  recommendation: string | null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function bindingFromEnvelope(envelopeJson: string | null): string {
  if (!envelopeJson) return "UNRECORDED";
  try {
    const parsed = JSON.parse(envelopeJson) as { researchRun?: { modelBinding?: unknown } };
    const binding = parsed.researchRun?.modelBinding;
    return typeof binding === "string" && binding.length > 0 ? binding : "UNRECORDED";
  } catch {
    return "UNRECORDED";
  }
}

/** The tree for one TeamRun, or null when the id names nothing. */
export function executionTrace(teamRunId: string): ExecutionTrace | null {
  const db = getDb();
  const row = db.select().from(schema.teamRuns).where(eq(schema.teamRuns.id, teamRunId)).get();
  if (!row) return null;

  const plan = row.plan ? (JSON.parse(row.plan) as TeamExecutionPlan) : null;
  const result = row.result ? (JSON.parse(row.result) as TeamResult) : null;
  const memberIds: string[] = row.memberAgentRunIds ? (JSON.parse(row.memberAgentRunIds) as string[]) : [];
  const namedRunIds = [...new Set([...(row.chiefAgentRunId ? [row.chiefAgentRunId] : []), ...memberIds])];

  const artifacts = db
    .select()
    .from(schema.agentArtifacts)
    .where(eq(schema.agentArtifacts.teamRunId, teamRunId))
    .all();

  // The team row only NAMES its members once it finishes — createTeamRun opens the row with an
  // empty list, and completeTeamRun/failTeamRun fill it. A run killed between its members
  // finishing and the team closing would therefore render as zero members holding N artifacts:
  // the tree shrinking exactly where an operator is trying to see what died. So the candidates
  // are the union of what the row names, what the plan's roles deterministically resolve to, and
  // who produced the artifacts — and a candidate the row did not name joins only if the ledger
  // actually holds its run.
  const candidateIds = new Set(namedRunIds);
  if (plan && row.instrumentId) {
    for (const role of plan.roles) candidateIds.add(`agr_${sha(`${teamRunId}|${role}|${row.instrumentId}`)}`);
  }
  for (const artifact of artifacts) if (artifact.agentRunId) candidateIds.add(artifact.agentRunId);

  const runs =
    candidateIds.size > 0
      ? db.select().from(schema.agentRuns).where(inArray(schema.agentRuns.id, [...candidateIds])).all()
      : [];
  const runById = new Map(runs.map((run) => [run.id, run]));

  const allRunIds = [...candidateIds].filter((id) => namedRunIds.includes(id) || runById.has(id));

  // ID-EXACT role attribution: recompute each plan role's deterministic run id. The chief is the
  // run the row names as chief. Anything left is labeled by its artifact's role or "member".
  const roleByRunId = new Map<string, string>();
  if (plan && row.instrumentId) {
    for (const role of plan.roles) {
      roleByRunId.set(`agr_${sha(`${teamRunId}|${role}|${row.instrumentId}`)}`, role);
    }
  }
  for (const artifact of artifacts) {
    if (artifact.agentRunId && !roleByRunId.has(artifact.agentRunId)) {
      roleByRunId.set(artifact.agentRunId, artifact.role);
    }
  }
  if (row.chiefAgentRunId) roleByRunId.set(row.chiefAgentRunId, "chief-of-staff");

  const assignmentByRole = new Map(
    (plan?.modelAssignments ?? []).map((assignment) => [assignment.role, assignment]),
  );

  const artifactViews = artifacts.map<ExecutionArtifactView>((artifact) => ({
    id: artifact.id,
    role: artifact.role,
    kind: artifact.kind,
    producerAgentRunId: artifact.agentRunId,
    createdAt: artifact.createdAt.toISOString(),
    bytes: Buffer.byteLength(artifact.content, "utf8"),
    consumers: "unrecorded",
  }));

  const members: ExecutionMemberView[] = allRunIds.map((runId) => {
    const run = runById.get(runId);
    const role = roleByRunId.get(runId) ?? "member";
    const assignment = assignmentByRole.get(role) ?? null;
    const startedAt = run ? run.startedAt.toISOString() : null;
    const completedAt = run ? run.completedAt.toISOString() : null;
    return {
      role,
      agentRunId: runId,
      agentId: run?.agentId ?? null,
      agentVersion: run?.agentVersion ?? null,
      // A run id the team row names but the ledger does not hold is an interrupted write — shown
      // as UNRECORDED rather than dropped, so the tree never silently shrinks.
      status: run?.status ?? "UNRECORDED",
      assigned: assignment
        ? {
            providerId: assignment.providerId,
            modelId: assignment.modelId,
            binding: assignment.binding ?? null,
            source: assignment.source,
            reason: assignment.reason,
          }
        : null,
      executed: run ? { provider: run.provider, model: run.model } : null,
      modelVerification: bindingFromEnvelope(run?.envelope ?? null),
      refusalCode: run?.refusalCode ?? null,
      refusalMessage: run?.refusalMessage ?? null,
      tokens: run?.tokens ?? null,
      cost: run?.cost ?? null,
      costCurrency: run?.costCurrency ?? null,
      startedAt,
      completedAt,
      durationMs:
        run && run.completedAt.getTime() >= run.startedAt.getTime()
          ? run.completedAt.getTime() - run.startedAt.getTime()
          : null,
      artifacts: artifactViews.filter((artifact) => artifact.producerAgentRunId === runId),
    };
  });

  const measured = members.map((member) => member.tokens).filter((tokens): tokens is number => tokens !== null);
  const childTokens = measured.length > 0 ? measured.reduce((sum, tokens) => sum + tokens, 0) : null;
  // Measurement census: only ledger-recorded model calls can be measured. The deterministic
  // chief reports no usage BY DESIGN and must not drag a fully measured team to PARTIAL.
  const censusMembers = members.filter(
    (member) => member.executed !== null && member.executed.provider !== "deterministic",
  );
  const measuredCensus = censusMembers.filter((member) => member.tokens !== null);
  const tokensMeasurement: ExecutionTotals["tokensMeasurement"] =
    measuredCensus.length === 0
      ? "UNMEASURED"
      : measuredCensus.length === censusMembers.length
        ? "MEASURED"
        : "PARTIAL";
  // Legacy healing: before 2026-08-15 the runtime summed member tokens with `?? 0`, so an
  // all-unmeasured COMPLETED team wrote 0 to its row. A row.tokens of 0 over children that
  // measured nothing can ONLY be that fake zero — a genuinely measured 0 total requires a
  // measured-0 child, which would make childTokens 0, not null — so it reads as null here
  // rather than needing a migration.
  const rowTokens = row.tokens === 0 && childTokens === null ? null : row.tokens;
  const reportedCosts = members
    .map((member) => member.cost)
    .filter((cost): cost is number => cost !== null && Number.isFinite(cost));
  const currencies = new Set(
    members.map((member) => member.costCurrency).filter((currency): currency is string => currency !== null),
  );

  const totals: ExecutionTotals = {
    tokens: rowTokens ?? childTokens,
    tokensMeasurement,
    // Cost is a sum ONLY when every reported cost shares one currency — a mixed-currency sum is
    // a fabricated conversion, so it reports UNAVAILABLE instead.
    cost: reportedCosts.length > 0 && currencies.size === 1 ? reportedCosts.reduce((sum, cost) => sum + cost, 0) : null,
    costCurrency: currencies.size === 1 ? [...currencies][0] : null,
    artifactCount: artifactViews.length,
    dissentCount: result?.dissent.length ?? 0,
    unresolvedCount: result?.unresolvedQuestions.length ?? 0,
    membersFailed: members.filter((member) => member.status === "FAILED" || member.status === "REFUSED").length,
  };

  return {
    teamRunId: row.id,
    teamId: row.teamId,
    teamVersion: row.teamVersion,
    instrumentId: row.instrumentId,
    status: row.status,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: iso(row.completedAt),
    durationMs: row.completedAt ? row.completedAt.getTime() - row.startedAt.getTime() : null,
    job: readJob(row.jobId),
    objective: plan?.objective ?? null,
    parallelGroups: plan?.parallelGroups ?? null,
    members,
    result,
    totals,
    // A comparison that could not be made is NOT a passing comparison. When a provider reports no
    // usage the runtime still writes a summed 0 to the team row while every child reads null —
    // defaulting that to `true` printed "reconciles with members" under a total nothing measured.
    reconciled: row.tokens !== null && childTokens !== null ? row.tokens === childTokens : null,
  };
}

function readJob(jobId: number | null): ExecutionTrace["job"] {
  if (jobId === null) return null;
  const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, jobId)).get();
  if (!job) return null;
  return { id: job.id, kind: job.kind, status: job.status, attempts: job.attempts, lastError: job.lastError };
}

/**
 * The one place the totals' token/cost words are composed — the UI renders these verbatim and
 * the tests pin every branch, so "measured" can never again be derived from a fake zero.
 */
export function tokensStatement(totals: ExecutionTotals): string {
  if (totals.tokensMeasurement === "UNMEASURED" || totals.tokens === null) {
    return "UNMEASURED — no usage reported by the provider";
  }
  if (totals.tokensMeasurement === "PARTIAL") {
    return `${totals.tokens} (PARTIAL — some members reported no usage)`;
  }
  return String(totals.tokens);
}

export function costStatement(totals: ExecutionTotals): string {
  if (totals.cost !== null) return `${totals.cost} ${totals.costCurrency ?? ""}`.trim();
  if (totals.tokensMeasurement === "UNMEASURED") {
    return "COST UNAVAILABLE (no usage reported by the provider)";
  }
  if (totals.tokensMeasurement === "PARTIAL") {
    return "COST UNAVAILABLE (tokens partially measured; no pricing source)";
  }
  return "COST UNAVAILABLE (tokens measured; no pricing source)";
}

/** Newest first — what the /brain RECENT WORK panel renders. */
export function listExecutions(limit = 10): ExecutionSummary[] {
  const db = getDb();
  const rows = db
    .select()
    .from(schema.teamRuns)
    .orderBy(desc(schema.teamRuns.startedAt))
    .limit(limit)
    .all();

  // Counted from the ARTIFACT ledger, not from the team row's artifactIds: failTeamRun never
  // fills that field, so a run that produced evidence and then failed advertised "0 artifact(s)"
  // in this panel while its own drill-in listed them.
  const countByTeamRun = new Map<string, number>();
  if (rows.length > 0) {
    for (const artifact of db
      .select()
      .from(schema.agentArtifacts)
      .where(inArray(schema.agentArtifacts.teamRunId, rows.map((row) => row.id)))
      .all()) {
      countByTeamRun.set(artifact.teamRunId, (countByTeamRun.get(artifact.teamRunId) ?? 0) + 1);
    }
  }

  return rows
    .map((row) => {
      const result = row.result ? (JSON.parse(row.result) as TeamResult) : null;
      const memberIds: string[] = row.memberAgentRunIds ? (JSON.parse(row.memberAgentRunIds) as string[]) : [];
      return {
        teamRunId: row.id,
        teamId: row.teamId,
        instrumentId: row.instrumentId,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        durationMs: row.completedAt ? row.completedAt.getTime() - row.startedAt.getTime() : null,
        memberCount: memberIds.length + (row.chiefAgentRunId && !memberIds.includes(row.chiefAgentRunId) ? 1 : 0),
        artifactCount: countByTeamRun.get(row.id) ?? 0,
        dissentCount: result?.dissent.length ?? 0,
        tokens: row.tokens,
        recommendation: result?.recommendation ?? null,
      };
    });
}
