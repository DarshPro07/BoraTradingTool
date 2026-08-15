import { createHash } from "node:crypto";
import { emit } from "@/lib/brain/event-bus";
import { recordAgentRun } from "@/lib/runtime/agent-runs";
import type { EvidencePacket, PacketResult } from "@/lib/research/bridge";
import type { Capability } from "@/lib/runtime/routing";
import type { ModelEntry } from "@/lib/runtime/model-catalog";
import { routeRoleModel } from "@/lib/runtime/model-router";
import { computeModelStats } from "@/lib/runtime/model-stats";
import { isProviderDefaultModel } from "@/lib/runtime/roster";
import { recordArtifact } from "./artifacts";
import {
  completeTeamRun,
  createTeamRun,
  failTeamRun,
  type TeamExecutionPlan,
  type TeamResult,
} from "./team-runs";
import { resolveTeamDefinition, type TeamDefinition, type TeamMemberSpec } from "./teams";

/**
 * The Chief-of-Staff runtime — coordinates a bounded semantic team for one durable job.
 *
 * The separation the owner made non-negotiable, enforced here:
 *   - the Brain decides work exists; the Job OS owns lifecycle; the CHIEF-OF-STAFF only coordinates.
 *   - members exchange PERSISTED ARTIFACTS, not chat: each member's output is written to
 *     `agent_artifacts` and the synthesizer consumes them BY ID.
 *   - the plan is persisted BEFORE any member runs, so the manager cannot silently rewrite the team.
 *   - DISSENT survives synthesis — the Critic's and Verifier's concerns are first-class TeamResult fields.
 *   - no member and not the chief holds privileged authority; the strongest output is a recommendation.
 *   - failures reuse the existing Job OS grammar — a member failure fails the TeamRun and THROWS a
 *     coded error the queue classifies. There is no TeamRetryLoop.
 */

/** The result of running one member: its parsed artifact content, or a coded failure. Never throws. */
export interface MemberRun {
  ok: boolean;
  content?: Record<string, unknown>;
  provider: string;
  model: string;
  tokens: number | null;
  cost: number | null;
  costCurrency: string | null;
  code?: string;
  message?: string;
}

/**
 * The gateway seam, injectable for tests. Default calls the real gateway once per member.
 * `assignedModel` is the router's pick for this role (A6.2): a concrete id is REQUESTED from the
 * adapter; the `<provider>:default` sentinel (or null) lets the provider serve its configured model.
 */
export type RunMember = (
  member: TeamMemberSpec,
  packet: EvidencePacket,
  assignedModel?: string | null,
) => Promise<MemberRun>;
export type BuildPacket = (instrumentId: string) => PacketResult;

export interface TeamDeps {
  team?: TeamDefinition;
  buildPacket?: BuildPacket;
  runMember?: RunMember;
  /**
   * The available models (rung 4, roster-agnostic). When present, the ModelRouter assigns a model per
   * role from LEDGER history and records the decision in the plan. Default empty — the real detected
   * roster is a separate wiring step; the routing POLICY exists and is exercised whenever a roster is.
   */
  roster?: readonly ModelEntry[];
}

export interface TeamResearchOutcome {
  ok: boolean;
  teamRunId: string | null;
  agentId: string;
  agentVersion: string;
  instrumentId: string;
  /** SOURCE_VERIFIED / CONFLICTED / INSUFFICIENT_EVIDENCE on success; a code otherwise. */
  verification: string;
  recommendation?: string;
  deferred?: { reason: string; dataState: string; ingestJobId: number | null };
}

function coded(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

const sha = (input: string) => createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
const asString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => asString(x)).filter((s) => s.length > 0) : [];

/** Bounded-parallelism map: at most `limit` in flight, so members genuinely overlap in wall-clock. */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

function buildExecutionPlan(
  team: TeamDefinition,
  instrumentId: string,
  modelAssignments?: TeamExecutionPlan["modelAssignments"],
): TeamExecutionPlan {
  return {
    objective: `Deep research on ${instrumentId}: propose, independently verify the evidence, critique, then synthesize with dissent preserved.`,
    roles: team.members.map((m) => m.role),
    tasks: team.members.map((m) => ({ role: m.role, task: m.definition.role })),
    // Every member reasons over the SAME packet independently, so they form one parallel group.
    parallelGroups: [team.members.map((m) => m.role)],
    artifactContracts: team.members.map((m) => ({ role: m.role, kind: m.artifactKind })),
    stopConditions: [
      "any member fails → the TeamRun fails and the Job OS classifies the error",
      "invalid member output → CONTRACT_VIOLATION",
      "budget exceeded → TEAM_BUDGET_EXCEEDED",
    ],
    budget: team.budget,
    modelAssignments,
  };
}

/**
 * Ask the ModelRouter (rung 4) to assign a model to each role from the roster, LEARNING from the
 * ledger. Roster-agnostic: a one-model roster routes everyone there honestly; a richer roster
 * differentiates by each role's needs and each model's earned verification rate.
 */
function assignModels(
  team: TeamDefinition,
  roster: readonly ModelEntry[],
): NonNullable<TeamExecutionPlan["modelAssignments"]> {
  const stats = computeModelStats();
  return team.members.map((member) => {
    const decision = routeRoleModel(
      { role: member.role, needs: member.modelNeeds },
      roster,
      stats,
      member.definition.gatewayCapability as Capability,
    );
    if (!decision.ok) {
      return { role: member.role, providerId: null, modelId: null, source: "REFUSED", reason: decision.message };
    }
    return {
      role: member.role,
      providerId: decision.providerId,
      modelId: decision.modelId,
      source: decision.source,
      reason: decision.reason,
      // A6.2 truth: a sentinel entry means the provider chooses its own model — say so, don't
      // pretend a specific model was requested.
      binding: isProviderDefaultModel(decision.modelId) ? ("PROVIDER_DEFAULT" as const) : ("REQUESTED" as const),
    };
  });
}

/** The default gateway-backed member runner: same capability → same model for every role. */
async function makeGatewayRunMember(): Promise<RunMember> {
  const { runAgent, detectProviders } = await import("@/lib/runtime/gateway");
  const { extractJson } = await import("@/lib/research/bridge");
  const { defaultProfile } = await import("@/lib/runtime/routing");
  const detected = await detectProviders();

  return async (member, packet, assignedModel) => {
    const profile = defaultProfile("SUBSCRIPTION_FIRST", `team_${member.role}`);
    const userPrompt = `Evidence packet (this is everything you have):\n${JSON.stringify(packet, null, 2)}`;
    // A6.2: a concrete assigned id is REQUESTED from the adapter; the sentinel/null means the
    // provider serves its configured default (a stated limitation, recorded as PROVIDER_DEFAULT).
    const concreteModel =
      assignedModel && !isProviderDefaultModel(assignedModel) ? assignedModel : null;
    const run = await runAgent({
      capability: member.definition.gatewayCapability as Capability,
      prompt: userPrompt,
      systemPrompt: member.systemPrompt,
      profile,
      detected,
      model: concreteModel,
    });
    if (!run.ok) {
      return {
        ok: false,
        provider: run.attempted[0]?.provider ?? "none",
        model: "none",
        tokens: null,
        cost: null,
        costCurrency: null,
        code: run.code,
        message: run.message,
      };
    }
    // Parse the structured artifact. A member that does not return the contracted shape is a
    // CONTRACT_VIOLATION — the same code the single-agent bridge uses.
    let content: Record<string, unknown>;
    try {
      content = extractJson(run.text) as Record<string, unknown>;
    } catch (caught) {
      return {
        ok: false,
        provider: run.provider,
        model: run.model,
        tokens: run.tokens,
        cost: run.cost,
        costCurrency: run.costCurrency,
        code: "CONTRACT_VIOLATION",
        message: `${member.role} did not return a JSON object: ${caught instanceof Error ? caught.message : String(caught)}`,
      };
    }
    const missing = member.requiredFields.filter((f) => content[f] === undefined || content[f] === null);
    if (missing.length > 0) {
      return {
        ok: false,
        provider: run.provider,
        model: run.model,
        tokens: run.tokens,
        cost: run.cost,
        costCurrency: run.costCurrency,
        code: "CONTRACT_VIOLATION",
        message: `${member.role} output is missing required field(s): ${missing.join(", ")}`,
      };
    }
    return {
      ok: true,
      content,
      provider: run.provider,
      model: run.model,
      tokens: run.tokens,
      cost: run.cost,
      costCurrency: run.costCurrency,
    };
  };
}

interface MemberOutcome {
  role: string;
  runId: string;
  artifactId: string | null;
  ok: boolean;
  content?: Record<string, unknown>;
  code?: string;
  message?: string;
  tokens: number | null;
  cost: number | null;
}

/**
 * Run the instrument-research TEAM for one durable job.
 *
 * @param instrumentId the instrument to research
 * @param jobId        the durable job that owns lifecycle (retry/lease/wake)
 * @param deps         injection seam for tests (team override, packet builder, member runner)
 */
export async function runInstrumentResearchTeam(
  instrumentId: string,
  jobId: number | null,
  deps: TeamDeps = {},
): Promise<TeamResearchOutcome> {
  const team = deps.team ?? resolveTeamDefinition("research.instrument.team");
  const chief = team.chief;

  // Budget pre-guard: the Chief-of-Staff operates INSIDE the envelope and cannot widen it.
  if (team.members.length > team.budget.maxAgents - 1 || team.members.length > team.budget.maxModelCalls) {
    throw coded(
      "TEAM_BUDGET_EXCEEDED",
      `team ${team.teamId} would run ${team.members.length} members but the budget allows ` +
        `maxAgents=${team.budget.maxAgents} (minus chief), maxModelCalls=${team.budget.maxModelCalls}.`,
    );
  }

  const buildPacket = deps.buildPacket ?? (await import("@/lib/research/bridge")).buildEvidencePacket;
  const built = buildPacket(instrumentId);

  if (!built.ok) {
    // DATA prerequisite → the dependency grammar, not a blind retry (single-path parity). The
    // dependent research job carries the same depth marker so it re-teams when the bars arrive.
    if (built.code === "NO_STORED_DATA") {
      const { resolveDataRequirement } = await import("@/lib/brain/dependency-resolver");
      const { enqueueDependent } = await import("@/lib/research/queue");
      const resolution = await resolveDataRequirement({ instrumentId, purpose: "research" });
      if (resolution.jobId !== null) {
        enqueueDependent(
          { kind: "instrument_research", payload: { instrumentId, depth: "deep" }, dedupeKey: `team-research-${instrumentId}` },
          [resolution.jobId],
        );
      }
      return {
        ok: false,
        teamRunId: null,
        agentId: chief.agentId,
        agentVersion: chief.version,
        instrumentId,
        verification: built.code,
        deferred: { reason: built.code, dataState: resolution.state, ingestJobId: resolution.jobId },
      };
    }
    // INSTRUMENT_UNKNOWN and any other packet failure is permanent/real — throw for the Job OS.
    throw coded(built.code, built.message);
  }

  const packet = built.packet;
  const fingerprint = built.fingerprint;

  // Deterministic TeamRun id (idempotent across a crash/retry of the same job).
  const teamRunId = `tmr_${sha(`${jobId ?? "nojob"}|${team.teamId}|${team.version}|${instrumentId}`)}`;
  // A6.1: the PRODUCTION default roster is built from what detection actually found — never a
  // fixture. An explicit deps.roster (tests, future owner selection of 1-5 active models) overrides;
  // an explicit [] is an honest "nothing available" and records no assignments.
  let roster: readonly ModelEntry[];
  if (deps.roster !== undefined) {
    roster = deps.roster;
  } else {
    const { detectProviders } = await import("@/lib/runtime/gateway");
    const { buildDetectedRoster } = await import("@/lib/runtime/roster");
    roster = buildDetectedRoster(await detectProviders());
  }
  const modelAssignments = roster.length > 0 ? assignModels(team, roster) : undefined;
  const plan = buildExecutionPlan(team, instrumentId, modelAssignments);
  // The plan of record is written BEFORE any member runs; a re-run reuses the row (onConflictDoNothing).
  createTeamRun({ id: teamRunId, teamId: team.teamId, teamVersion: team.version, jobId, instrumentId, plan });

  const runMember = deps.runMember ?? (await makeGatewayRunMember());

  const startedAt = new Date();
  // Members run in bounded parallel; each records its AgentRun (COMPLETED or FAILED) and, on success,
  // its structured artifact. Deterministic ids make a crash-retry reuse the same rows (idempotency).
  const assignmentByRole = new Map((modelAssignments ?? []).map((a) => [a.role, a.modelId]));
  const outcomes: MemberOutcome[] = await mapWithLimit(team.members, team.budget.maxParallel, async (member) => {
    const runId = `agr_${sha(`${teamRunId}|${member.role}|${instrumentId}`)}`;
    // The RunMember contract is "returns a coded failure, never throws" — enforced here so a member
    // that DOES throw (a real gateway fault escaping its own handling) still becomes a clean failure.
    // Otherwise the throw would escape mapWithLimit and leave the TeamRun stuck at RUNNING forever.
    let result: MemberRun;
    try {
      result = await runMember(member, packet, assignmentByRole.get(member.role) ?? null);
    } catch (caught) {
      result = {
        ok: false,
        provider: "none",
        model: "none",
        tokens: null,
        cost: null,
        costCurrency: null,
        code: "MEMBER_THREW",
        message: caught instanceof Error ? caught.message : String(caught),
      };
    }
    recordAgentRun({
      id: runId,
      capability: member.definition.gatewayCapability,
      provider: result.provider,
      model: result.model,
      status: result.ok ? "COMPLETED" : "FAILED",
      trigger: "LEARNING",
      instrumentId,
      evidenceFingerprint: fingerprint,
      envelope: null,
      refusalCode: result.ok ? null : result.code ?? "MEMBER_FAILED",
      refusalMessage: result.ok ? null : result.message ?? null,
      tokens: result.tokens,
      cost: result.cost,
      costCurrency: result.costCurrency,
      fallbackReason: null,
      agentId: member.definition.agentId,
      agentVersion: member.definition.version,
      jobId,
      teamRunId,
      startedAt,
      completedAt: new Date(),
    });

    let artifactId: string | null = null;
    if (result.ok && result.content) {
      artifactId = `art_${sha(`${teamRunId}|${member.role}`)}`;
      recordArtifact({
        id: artifactId,
        teamRunId,
        jobId,
        role: member.role,
        kind: member.artifactKind,
        agentRunId: runId,
        content: result.content,
      });
    }

    return {
      role: member.role,
      runId,
      artifactId,
      ok: result.ok,
      content: result.content,
      code: result.code,
      message: result.message,
      tokens: result.tokens,
      cost: result.cost,
    };
  });

  const memberRunIds = outcomes.map((o) => o.runId);
  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    // A member failed. Fail the TeamRun and hand a CODED error to the Job OS — its failure taxonomy
    // decides retry vs dead. No bespoke team retry loop.
    const first = failed[0];
    failTeamRun(teamRunId, `${first.code}: ${first.message}`, memberRunIds);
    throw coded(first.code ?? "MEMBER_FAILED", first.message ?? `member ${first.role} failed`);
  }

  // ── Synthesis (Chief-of-Staff, deterministic in this slice) ─────────────────────────────────
  // Consume the members' artifacts BY the parsed content we already persisted (each is an artifact
  // in agent_artifacts, referenced by artifactId). Reconcile into a TeamResult that preserves dissent.
  const byRole = new Map(outcomes.map((o) => [o.role, o.content ?? {}]));
  const researcher = byRole.get("researcher") ?? {};
  const verifier = byRole.get("source_verifier") ?? {};
  const critic = byRole.get("critic") ?? {};

  // Platform-side citation verification (the doctrine: agents propose, the platform verifies).
  const cited = asStringArray(researcher.sources);
  const citable = new Set(packet.citableSources);
  const verifiedSources = cited.filter((s) => citable.has(s));
  const verificationStatus =
    verifiedSources.length === 0 ? "INSUFFICIENT_EVIDENCE" : verifiedSources.length === cited.length ? "SOURCE_VERIFIED" : "CONFLICTED";

  const direction = asString(researcher.direction).toUpperCase();
  const assessment = asString(verifier.assessment).toUpperCase();
  const dissent = [
    { role: "source_verifier", concern: asString(verifier.concern) },
    { role: "critic", concern: asString(critic.concern) },
  ].filter((d) => d.concern.length > 0);

  const recommendation: TeamResult["recommendation"] =
    verificationStatus === "SOURCE_VERIFIED" && assessment !== "WEAK" && direction !== "" && direction !== "NEUTRAL"
      ? "GENERATE_STRATEGY_CANDIDATE"
      : assessment === "WEAK" || verificationStatus === "INSUFFICIENT_EVIDENCE"
        ? "NEEDS_MORE_EVIDENCE"
        : "ABSTAIN";

  const result: TeamResult = {
    conclusion: direction === "NEUTRAL" || direction === "" ? "No directional thesis is warranted from this evidence." : asString(researcher.thesis),
    supportingEvidence: [asString(researcher.rationale), ...asStringArray(verifier.corroboratingSources)].filter((s) => s.length > 0),
    contradictoryEvidence: [...asStringArray(critic.weaknesses), ...asStringArray(critic.failureModes)],
    unresolvedQuestions: [...asStringArray(researcher.missingEvidence), ...asStringArray(verifier.unsupportedClaims)],
    dissent,
    confidenceBasis: `platform citation check=${verificationStatus}; verifier assessment=${assessment || "n/a"}; researcher confidence=${asString(researcher.confidence) || "n/a"}`,
    recommendation,
  };

  // The chief coordination run — recorded so the team has an author, provider "deterministic" (it
  // ran no model; it reconciled artifacts). A SYNTHESIS artifact records the reconciliation itself.
  const chiefRunId = `agr_${sha(`${teamRunId}|${chief.agentId}`)}`;
  const synthArtifactId = `art_${sha(`${teamRunId}|synthesis`)}`;
  recordArtifact({
    id: synthArtifactId,
    teamRunId,
    jobId,
    role: "chief_of_staff",
    kind: "SYNTHESIS",
    agentRunId: chiefRunId,
    content: result as unknown as Record<string, unknown>,
  });
  recordAgentRun({
    id: chiefRunId,
    capability: "RESEARCH",
    provider: "deterministic",
    model: "chief_of_staff",
    status: "COMPLETED",
    trigger: "LEARNING",
    instrumentId,
    evidenceFingerprint: fingerprint,
    envelope: null,
    refusalCode: null,
    refusalMessage: null,
    tokens: null,
    cost: null,
    costCurrency: null,
    fallbackReason: null,
    agentId: chief.agentId,
    agentVersion: chief.version,
    jobId,
    teamRunId,
    startedAt,
    completedAt: new Date(),
  });

  const artifactIds = [...outcomes.map((o) => o.artifactId).filter((id): id is string => id !== null), synthArtifactId];
  // Unmeasured is null, never 0: a provider that reports no usage must not make the team look
  // like it measured zero spend (statistics consumers would read a fake 0 as "free").
  const measuredTokenOutcomes = outcomes.filter((o) => o.tokens != null);
  const totalTokens = measuredTokenOutcomes.reduce((sum, o) => sum + (o.tokens ?? 0), 0);
  const totalCost = outcomes.reduce((sum, o) => sum + (o.cost ?? 0), 0);

  // Post-guard: aggregate spend cannot exceed a stated cap.
  if (team.budget.maxTokens !== null && totalTokens > team.budget.maxTokens) {
    failTeamRun(teamRunId, `TEAM_BUDGET_EXCEEDED: tokens ${totalTokens} > ${team.budget.maxTokens}`, memberRunIds);
    throw coded("TEAM_BUDGET_EXCEEDED", `team spent ${totalTokens} tokens, budget ${team.budget.maxTokens}`);
  }

  completeTeamRun({
    id: teamRunId,
    chiefAgentRunId: chiefRunId,
    memberAgentRunIds: memberRunIds,
    artifactIds,
    result,
    tokens: measuredTokenOutcomes.length > 0 ? totalTokens : null,
    cost: totalCost > 0 ? totalCost : null,
    costCurrency: outcomes.find((o) => o.cost != null) ? "USD" : null,
  });

  // The single semantic completion event for the team path — emitted exactly once, on success.
  emit({ kind: "RESEARCH_COMPLETED", instrumentId, proposalId: teamRunId, verdict: verificationStatus });

  return {
    ok: true,
    teamRunId,
    agentId: chief.agentId,
    agentVersion: chief.version,
    instrumentId,
    verification: verificationStatus,
    recommendation,
  };
}
