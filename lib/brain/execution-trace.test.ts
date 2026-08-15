import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { completeTeamRun, createTeamRun, failTeamRun, type TeamExecutionPlan, type TeamResult } from "@/lib/agents/team-runs";
import { recordArtifact } from "@/lib/agents/artifacts";
import { recordAgentRun } from "@/lib/runtime/agent-runs";
import { enqueue } from "@/lib/research/queue";
import { executionTrace, listExecutions } from "./execution-trace";

/**
 * The read model's contract, on SEEDED LEDGER ROWS written by the runtime's own writers
 * (createTeamRun/completeTeamRun/recordAgentRun/recordArtifact) — the same code paths a real
 * team run uses, so the tree is proven against the authoritative records, not against fixtures
 * shaped to please it. Owner acceptance items pinned here: id-exact role attribution, assigned
 * vs executed never collapsed, binding classes, failed member visible, retry latest-wins (#13),
 * totals reconcile (#11), TOKENS MEASURED / COST UNAVAILABLE, job state above team state (#2).
 */

useTemporaryDatabase();

const sha = (input: string) => createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
const INSTRUMENT = "IN:XNSE:TRACEPROBE";

const PLAN: TeamExecutionPlan = {
  objective: "Deep research on the probe.",
  roles: ["researcher", "critic"],
  tasks: [
    { role: "researcher", task: "research" },
    { role: "critic", task: "critique" },
  ],
  parallelGroups: [["researcher", "critic"]],
  artifactContracts: [
    { role: "researcher", kind: "RESEARCH" },
    { role: "critic", kind: "CRITIQUE" },
  ],
  stopConditions: ["budget"],
  budget: { maxAgents: 3, maxParallel: 2, maxModelCalls: 4, maxTokens: null, maxCost: null, maxDurationMs: 600_000 },
  modelAssignments: [
    {
      role: "researcher",
      providerId: "vllm-local",
      modelId: "fixture-large",
      source: "PRIOR",
      reason: "only available",
      binding: "REQUESTED",
    },
    {
      role: "critic",
      providerId: "claude-code",
      modelId: "claude-code:default",
      source: "PRIOR",
      reason: "sentinel",
      binding: "PROVIDER_DEFAULT",
    },
  ],
};

const RESULT: TeamResult = {
  conclusion: "Candidate worth quantitative testing.",
  supportingEvidence: ["volume expansion"],
  contradictoryEvidence: ["sector weakness"],
  unresolvedQuestions: ["catalyst durability"],
  dissent: [
    { role: "critic", concern: "Parameter stability not established." },
    { role: "researcher", concern: "One catalyst lacks independent confirmation." },
  ],
  confidenceBasis: "two verified sources",
  recommendation: "GENERATE_STRATEGY_CANDIDATE",
};

function seedMemberRun(
  teamRunId: string,
  role: string,
  overrides: Partial<Parameters<typeof recordAgentRun>[0]> = {},
): string {
  const id = `agr_${sha(`${teamRunId}|${role}|${INSTRUMENT}`)}`;
  recordAgentRun({
    id,
    capability: "RESEARCH",
    provider: overrides.provider ?? "vllm-local",
    model: overrides.model ?? "fixture-large",
    status: overrides.status ?? "COMPLETED",
    trigger: "LEARNING",
    instrumentId: INSTRUMENT,
    evidenceFingerprint: null,
    envelope: null,
    refusalCode: overrides.refusalCode ?? null,
    refusalMessage: overrides.refusalMessage ?? null,
    tokens: overrides.tokens ?? 100,
    cost: overrides.cost ?? null,
    costCurrency: overrides.costCurrency ?? null,
    fallbackReason: null,
    agentId: `agent.${role}`,
    agentVersion: "1",
    jobId: overrides.jobId ?? null,
    teamRunId,
    startedAt: overrides.startedAt ?? new Date("2026-08-15T05:00:00Z"),
    completedAt: overrides.completedAt ?? new Date("2026-08-15T05:00:40Z"),
    ...overrides,
  });
  return id;
}

describe("the execution tree", () => {
  it("correlates job → team → members → artifacts by identity, with binding truth intact", () => {
    const { id: jobId } = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT } });
    const teamRunId = `tmr_${sha(`trace-happy`)}`;
    createTeamRun({ id: teamRunId, teamId: "research.instrument.team", teamVersion: "1", jobId, instrumentId: INSTRUMENT, plan: PLAN });

    const researcher = seedMemberRun(teamRunId, "researcher", {
      startedAt: new Date("2026-08-15T05:00:02Z"),
      completedAt: new Date("2026-08-15T05:00:34Z"),
      tokens: 320,
    });
    // The critic's envelope carries the binding provenance field the transports leg introduced.
    const critic = seedMemberRun(teamRunId, "critic", {
      provider: "claude-code",
      model: "claude-x",
      tokens: 180,
      startedAt: new Date("2026-08-15T05:00:02Z"),
      completedAt: new Date("2026-08-15T05:00:20Z"),
    });
    // Plant ONLY the envelope's binding path directly — the full envelope contract is the
    // bridge's concern; this read model parses exactly researchRun.modelBinding out of it.
    getDb()
      .update(schema.agentRuns)
      .set({ envelope: JSON.stringify({ researchRun: { modelBinding: "USAGE_REPORTED" } }) })
      .where(eq(schema.agentRuns.id, critic))
      .run();

    const chief = `agr_${sha(`${teamRunId}|chief`)}`;
    recordAgentRun({
      id: chief,
      capability: "RESEARCH",
      provider: "claude-code",
      model: "claude-x",
      status: "COMPLETED",
      trigger: "LEARNING",
      instrumentId: INSTRUMENT,
      evidenceFingerprint: null,
      envelope: null,
      refusalCode: null,
      refusalMessage: null,
      tokens: 50,
      cost: null,
      costCurrency: null,
      fallbackReason: null,
      agentId: "agent.chief",
      agentVersion: "1",
      jobId,
      teamRunId,
      startedAt: new Date("2026-08-15T05:00:35Z"),
      completedAt: new Date("2026-08-15T05:00:44Z"),
    });

    recordArtifact({
      id: `art_${sha(`${teamRunId}|researcher`)}`,
      teamRunId,
      jobId,
      role: "researcher",
      kind: "RESEARCH",
      agentRunId: researcher,
      content: { thesis: "probe" },
    });
    recordArtifact({
      id: `art_${sha(`${teamRunId}|critic`)}`,
      teamRunId,
      jobId,
      role: "critic",
      kind: "CRITIQUE",
      agentRunId: critic,
      content: { objections: 2 },
    });

    completeTeamRun({
      id: teamRunId,
      chiefAgentRunId: chief,
      memberAgentRunIds: [researcher, critic],
      artifactIds: [`art_${sha(`${teamRunId}|researcher`)}`, `art_${sha(`${teamRunId}|critic`)}`],
      result: RESULT,
      tokens: 550,
      cost: null,
      costCurrency: null,
    });

    const trace = executionTrace(teamRunId);
    expect(trace).not.toBeNull();
    if (!trace) return;

    // Job state from the JOB row — above team state, never inferred.
    expect(trace.job?.id).toBe(jobId);
    expect(trace.job?.kind).toBe("instrument_research");
    expect(trace.job?.status).toBe("queued");
    expect(trace.status).toBe("COMPLETED");

    // Id-exact role attribution, assigned vs executed never collapsed.
    const researcherView = trace.members.find((member) => member.role === "researcher");
    expect(researcherView?.assigned?.modelId).toBe("fixture-large");
    expect(researcherView?.assigned?.binding).toBe("REQUESTED");
    expect(researcherView?.executed?.model).toBe("fixture-large");
    expect(researcherView?.agentId).toBe("agent.researcher");
    expect(researcherView?.agentVersion).toBe("1");
    expect(researcherView?.artifacts.map((artifact) => artifact.kind)).toEqual(["RESEARCH"]);

    const criticView = trace.members.find((member) => member.role === "critic");
    expect(criticView?.assigned?.binding).toBe("PROVIDER_DEFAULT");
    expect(criticView?.executed?.model).toBe("claude-x");
    // The binding classes: envelope-recorded on the critic, honestly UNRECORDED on the
    // researcher whose row predates the field.
    expect(criticView?.modelVerification).toBe("USAGE_REPORTED");
    expect(researcherView?.modelVerification).toBe("UNRECORDED");

    // Dissent survives synthesis, verbatim.
    expect(trace.result?.dissent).toHaveLength(2);
    expect(trace.totals.dissentCount).toBe(2);
    expect(trace.totals.unresolvedCount).toBe(1);
    expect(trace.totals.artifactCount).toBe(2);

    // TOKENS MEASURED / COST UNAVAILABLE — and the totals reconcile against the children.
    expect(trace.totals.tokens).toBe(550);
    expect(trace.totals.cost).toBeNull();
    expect(trace.reconciled).toBe(true);

    // Real timing exposes the parallel members (same start, different durations).
    expect(researcherView?.durationMs).toBe(32_000);
    expect(criticView?.durationMs).toBe(18_000);

    const summaries = listExecutions();
    expect(summaries[0]?.teamRunId).toBe(teamRunId);
    expect(summaries[0]?.dissentCount).toBe(2);
    expect(summaries[0]?.recommendation).toBe("GENERATE_STRATEGY_CANDIDATE");
  });

  it("a failed member is visibly failed, and a retried run is ONE truthful row (#12, #13)", () => {
    const teamRunId = `tmr_${sha(`trace-failed`)}`;
    createTeamRun({ id: teamRunId, teamId: "research.instrument.team", teamVersion: "1", jobId: null, instrumentId: INSTRUMENT, plan: PLAN });

    // Attempt 1 fails; the Job-OS retry re-records the SAME deterministic id and succeeds.
    seedMemberRun(teamRunId, "researcher", {
      status: "FAILED",
      refusalCode: "AGENT_TIMEOUT",
      refusalMessage: "timed out",
      tokens: null,
    });
    seedMemberRun(teamRunId, "researcher", { status: "COMPLETED", tokens: 300 });
    // The critic fails and stays failed.
    const critic = seedMemberRun(teamRunId, "critic", {
      status: "FAILED",
      refusalCode: "PROVIDER_UNAVAILABLE",
      refusalMessage: "upstream 500",
      tokens: null,
    });

    failTeamRun(teamRunId, "PROVIDER_UNAVAILABLE: critic failed", [
      `agr_${sha(`${teamRunId}|researcher|${INSTRUMENT}`)}`,
      critic,
    ]);

    const trace = executionTrace(teamRunId);
    expect(trace?.status).toBe("FAILED");
    expect(trace?.error).toMatch(/critic failed/);

    // Retry latest-wins: exactly ONE researcher row, and it is the SUCCESSFUL outcome.
    const researcherRows = trace?.members.filter((member) => member.role === "researcher") ?? [];
    expect(researcherRows).toHaveLength(1);
    expect(researcherRows[0]?.status).toBe("COMPLETED");

    // The failed member is failed — never omitted.
    const criticView = trace?.members.find((member) => member.role === "critic");
    expect(criticView?.status).toBe("FAILED");
    expect(criticView?.refusalCode).toBe("PROVIDER_UNAVAILABLE");
    expect(trace?.totals.membersFailed).toBe(1);
  });

  it("still shows the members of a run killed before the team row could name them", () => {
    // createTeamRun opens the row with an EMPTY member list; only completeTeamRun/failTeamRun
    // fill it. A process killed after the members finished but before the team closed therefore
    // has N recorded agent_runs and N artifacts under a team row that names nobody — and the
    // operator looking at what died is exactly who must not be shown an empty tree.
    const { id: jobId } = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT } });
    const teamRunId = `tmr_${sha("trace-interrupted")}`;
    createTeamRun({ id: teamRunId, teamId: "research.instrument.team", teamVersion: "1", jobId, instrumentId: INSTRUMENT, plan: PLAN });

    const researcher = seedMemberRun(teamRunId, "researcher", { tokens: 210 });
    recordArtifact({
      id: `art_${sha(`${teamRunId}|researcher`)}`,
      teamRunId,
      jobId,
      role: "researcher",
      kind: "RESEARCH",
      agentRunId: researcher,
      content: { thesis: "written before the kill" },
    });
    // ...and then the process dies. No completeTeamRun, no failTeamRun.

    const trace = executionTrace(teamRunId);
    expect(trace?.status).toBe("RUNNING");
    const researcherView = trace?.members.find((member) => member.role === "researcher");
    expect(researcherView, "the recorded member vanished from an in-flight run").toBeDefined();
    expect(researcherView?.status).toBe("COMPLETED");
    expect(researcherView?.tokens).toBe(210);
    // The artifact belongs to a member the tree actually lists — not an orphan count.
    expect(trace?.totals.artifactCount).toBe(1);
    expect(researcherView?.artifacts).toHaveLength(1);
  });

  it("refuses to claim a reconciliation it could not perform, and says why cost is absent", () => {
    // A provider that reports no usage yields null tokens on every member while the runtime still
    // sums them to 0 on the team row. Comparing 0 against nothing is not a passing comparison.
    const { id: jobId } = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT } });
    const teamRunId = `tmr_${sha("trace-unmeasured")}`;
    createTeamRun({ id: teamRunId, teamId: "research.instrument.team", teamVersion: "1", jobId, instrumentId: INSTRUMENT, plan: PLAN });
    const researcher = seedMemberRun(teamRunId, "researcher", { tokens: null });
    const critic = seedMemberRun(teamRunId, "critic", { tokens: null });
    const chief = `agr_${sha(`${teamRunId}|chief`)}`;
    recordAgentRun({
      id: chief,
      capability: "RESEARCH",
      provider: "claude-code",
      model: "claude-x",
      status: "COMPLETED",
      trigger: "LEARNING",
      instrumentId: INSTRUMENT,
      evidenceFingerprint: null,
      envelope: null,
      refusalCode: null,
      refusalMessage: null,
      tokens: null,
      cost: null,
      costCurrency: null,
      fallbackReason: null,
      agentId: "agent.chief",
      agentVersion: "1",
      jobId: null,
      teamRunId,
      startedAt: new Date("2026-08-15T05:00:00Z"),
      completedAt: new Date("2026-08-15T05:00:40Z"),
    });
    completeTeamRun({
      id: teamRunId,
      result: RESULT,
      memberAgentRunIds: [researcher, critic],
      artifactIds: [],
      chiefAgentRunId: chief,
      // The runtime sums member tokens with `?? 0`, so an all-unmeasured team writes 0 here.
      tokens: 0,
      cost: null,
      costCurrency: null,
    });

    const trace = executionTrace(teamRunId);
    expect(trace?.totals.tokens).toBe(0);
    expect(
      trace?.reconciled,
      "an unmeasurable comparison must read NOT COMPARABLE, never as a passing reconciliation",
    ).toBeNull();
  });

  it("counts a failed run's artifacts from the ledger, not from a field failTeamRun never fills", () => {
    const { id: jobId } = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT } });
    const teamRunId = `tmr_${sha("trace-failed-artifacts")}`;
    createTeamRun({ id: teamRunId, teamId: "research.instrument.team", teamVersion: "1", jobId, instrumentId: INSTRUMENT, plan: PLAN });
    const researcher = seedMemberRun(teamRunId, "researcher", { tokens: 90 });
    recordArtifact({
      id: `art_${sha(`${teamRunId}|researcher`)}`,
      teamRunId,
      jobId,
      role: "researcher",
      kind: "RESEARCH",
      agentRunId: researcher,
      content: { thesis: "evidence survived the failure" },
    });
    failTeamRun(teamRunId, "critic unavailable", [researcher]);

    const summary = listExecutions(20).find((execution) => execution.teamRunId === teamRunId);
    expect(
      summary?.artifactCount,
      "the panel advertised 0 artifacts for a run whose own drill-in lists them",
    ).toBe(1);
    expect(executionTrace(teamRunId)?.totals.artifactCount).toBe(1);
  });
});
