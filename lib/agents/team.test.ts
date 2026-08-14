import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { subscribeAll, type MarketPulseEvent } from "@/lib/brain/event-bus";
import { persistCandles } from "@/lib/market/candle-store";
import type { ImportedCandle } from "@/lib/market/dataset-import";
import { enqueue, enqueueDependent, getJob } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { runInstrumentResearchTeam, type RunMember } from "./team-runtime";
import { getTeamRun } from "./team-runs";
import { getArtifact } from "./artifacts";
import { RESEARCH_TEAM_V1 } from "./teams";

/**
 * Chief-of-Staff / Team OS acceptance — the owner's 17 cases.
 *
 * Two layers:
 *   - DIRECT orchestration tests inject a deterministic member runner (no model, no network) to
 *     exercise budget, failure mapping, dissent, idempotency, and true parallel overlap;
 *   - FULL-PATH tests drive a real durable job through `runWorker` with ONLY the gateway mocked, so
 *     the real Chief-of-Staff runtime plans, runs members, verifies citations, synthesizes, and emits.
 */

const INSTRUMENT = "IN:XNSE:RELIANCE";

const RESEARCHER_OUT = {
  thesis: "Close holding above its 20-day mean continues over the next two weeks.",
  direction: "LONG",
  timeframe: "SWING",
  rationale: "The last close sits above the supplied 20-day average with positive drift.",
  requiredFeatures: ["sma_20"],
  sources: [`mp://security-master/${INSTRUMENT}`],
  confidence: 0.55,
  missingEvidence: ["No fundamentals or news are in the packet."],
};
const VERIFIER_OUT = {
  assessment: "MODERATE",
  corroboratingSources: [`mp://security-master/${INSTRUMENT}`],
  unsupportedClaims: ["A sector catalyst is not independently corroborated."],
  concern: "The evidence leans heavily on the last 20 sessions.",
};
const CRITIC_OUT = {
  weaknesses: ["A 70-bar sample is thin."],
  failureModes: ["Mean reversion in weak breadth."],
  concern: "Momentum may already be exhausted.",
};

function contentFor(role: string): Record<string, unknown> {
  if (role === "researcher") return { ...RESEARCHER_OUT };
  if (role === "source_verifier") return { ...VERIFIER_OUT };
  return { ...CRITIC_OUT };
}

/** A deterministic member runner: every role "succeeds" with its contracted content. */
const okRunMember: RunMember = async (member) => ({
  ok: true,
  content: contentFor(member.role),
  provider: "claude-code",
  model: "test-model",
  tokens: 100,
  cost: null,
  costCurrency: null,
});

/** A daily series long enough to clear the bridge's 60-bar research floor. */
function seedDailyCandles(count = 70): void {
  const base = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);
  const candles: ImportedCandle[] = [];
  for (let index = 0; index < count; index += 1) {
    const price = 100 + Math.sin(index / 5) * 4 + index * 0.1;
    candles.push({ ticker: INSTRUMENT, resolution: "D", time: base + index * 86_400, open: price, high: price + 1, low: price - 1, close: price + 0.3, volume: 1_000_000 });
  }
  persistCandles(candles);
}

const agentRuns = () => getDb().select().from(schema.agentRuns).all();
const teamRuns = () => getDb().select().from(schema.teamRuns).all();
const artifacts = () => getDb().select().from(schema.agentArtifacts).all();

describe("Team OS — orchestration (injected member runner)", () => {
  useTemporaryDatabase();

  it("[2,3,4,5,7,8,9] a deep run produces ONE TeamRun that pins the version, persists a plan, records member runs + artifacts, and preserves dissent", async () => {
    seedDailyCandles();
    const outcome = await runInstrumentResearchTeam(INSTRUMENT, 99, { runMember: okRunMember });

    expect(outcome.ok).toBe(true);
    expect(outcome.teamRunId).toBeTruthy();

    // #2 exactly one TeamRun; #3 pins the versioned TeamDefinition.
    const teams = teamRuns();
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ teamId: "research.instrument.team", teamVersion: "v1", status: "COMPLETED" });

    // #4 the execution plan was persisted (before members ran).
    const stored = getTeamRun(outcome.teamRunId!);
    expect(stored?.plan?.roles).toEqual(["researcher", "source_verifier", "critic"]);
    expect(stored?.plan?.parallelGroups?.[0]).toEqual(["researcher", "source_verifier", "critic"]);

    // #5 expected member AgentRuns + the chief, all linked to the TeamRun.
    const runs = agentRuns().filter((r) => r.teamRunId === outcome.teamRunId);
    expect(runs).toHaveLength(4);
    expect(runs.map((r) => r.agentId).sort()).toEqual(
      ["research.role.chief_of_staff", "research.role.critic", "research.role.researcher", "research.role.source_verifier"].sort(),
    );

    // #7 each member output is a persisted structured artifact (+ the synthesis).
    const arts = artifacts();
    expect(arts.map((a) => a.kind).sort()).toEqual(["CRITIQUE", "RESEARCH", "SYNTHESIS", "VERIFICATION"]);

    // #8 the synthesizer consumed artifacts BY ID: the persisted verifier/critic artifacts carry the
    // exact concerns that survive into the TeamResult — not a copied transcript blob.
    const verifierArtId = stored!.artifactIds.find((id) => getArtifact(id)?.role === "source_verifier")!;
    expect(getArtifact(verifierArtId)?.content.concern).toBe(VERIFIER_OUT.concern);

    // #9 dissent survives synthesis, from BOTH the verifier and the critic.
    const dissent = stored!.result!.dissent;
    expect(dissent.map((d) => d.role).sort()).toEqual(["critic", "source_verifier"]);
    expect(dissent.find((d) => d.role === "critic")?.concern).toBe(CRITIC_OUT.concern);
    expect(dissent.find((d) => d.role === "source_verifier")?.concern).toBe(VERIFIER_OUT.concern);
    // A verified, non-neutral thesis with non-weak evidence → the strongest a team may do: recommend.
    expect(stored!.result!.recommendation).toBe("GENERATE_STRATEGY_CANDIDATE");
  });

  it("[6] independent members overlap in wall-clock time", async () => {
    seedDailyCandles();
    let active = 0;
    let maxActive = 0;
    const trackingRunMember: RunMember = async (member) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { ok: true, content: contentFor(member.role), provider: "claude-code", model: "test-model", tokens: 1, cost: null, costCurrency: null };
    };

    await runInstrumentResearchTeam(INSTRUMENT, 1, { runMember: trackingRunMember });
    expect(maxActive, "at least two members were in flight at once").toBeGreaterThanOrEqual(2);
  });

  it("[16] the team budget cannot be exceeded — the Chief-of-Staff cannot widen its own envelope", async () => {
    const tightTeam = { ...RESEARCH_TEAM_V1, budget: { ...RESEARCH_TEAM_V1.budget, maxModelCalls: 2 } };
    await expect(
      runInstrumentResearchTeam(INSTRUMENT, 1, { team: tightTeam, runMember: okRunMember }),
    ).rejects.toThrow(/TEAM_BUDGET_EXCEEDED/);

    // The guard fires BEFORE any member or TeamRun — nothing was spent.
    expect(agentRuns()).toHaveLength(0);
    expect(teamRuns()).toHaveLength(0);
  });

  it("[13] a member provider failure fails the TeamRun and THROWS a coded error for the Job OS (no team retry loop)", async () => {
    seedDailyCandles();
    const failCritic: RunMember = async (member) =>
      member.role === "critic"
        ? { ok: false, code: "AGENT_UNAVAILABLE", message: "no provider could serve RESEARCH", provider: "claude-code", model: "none", tokens: null, cost: null, costCurrency: null }
        : { ok: true, content: contentFor(member.role), provider: "claude-code", model: "test-model", tokens: 100, cost: null, costCurrency: null };

    await expect(runInstrumentResearchTeam(INSTRUMENT, 5, { runMember: failCritic })).rejects.toThrow(/AGENT_UNAVAILABLE/);

    const teams = teamRuns();
    expect(teams).toHaveLength(1);
    expect(teams[0].status).toBe("FAILED");
    // Every member attempt is still recorded — the two that succeeded and the one that failed.
    const runs = agentRuns();
    expect(runs).toHaveLength(3); // no chief run on failure
    expect(runs.find((r) => r.status === "FAILED")).toMatchObject({ refusalCode: "AGENT_UNAVAILABLE", agentId: "research.role.critic" });
  });

  it("[15] re-running the same team (crash-retry) cannot duplicate completed member work", async () => {
    seedDailyCandles();
    await runInstrumentResearchTeam(INSTRUMENT, 7, { runMember: okRunMember });
    const runsAfterFirst = agentRuns().length;
    const artsAfterFirst = artifacts().length;
    expect(runsAfterFirst).toBe(4);
    expect(artsAfterFirst).toBe(4);

    // Same jobId → deterministic ids → idempotent writes: no duplication.
    await runInstrumentResearchTeam(INSTRUMENT, 7, { runMember: okRunMember });
    expect(agentRuns().length, "no duplicate member/chief runs").toBe(runsAfterFirst);
    expect(artifacts().length, "no duplicate artifacts").toBe(artsAfterFirst);
    expect(teamRuns().length, "still one TeamRun").toBe(1);
  });

  it("[15b] a member that FAILED then SUCCEEDS on a Job-OS retry does not leave a stale FAILED row — latest outcome wins", async () => {
    seedDailyCandles();
    let criticAttempts = 0;
    const flakeCritic: RunMember = async (member) => {
      if (member.role === "critic") {
        criticAttempts += 1;
        if (criticAttempts === 1) {
          return { ok: false, code: "AGENT_UNAVAILABLE", message: "transient outage", provider: "claude-code", model: "none", tokens: null, cost: null, costCurrency: null };
        }
      }
      return { ok: true, content: contentFor(member.role), provider: "claude-code", model: "test-model", tokens: 100, cost: null, costCurrency: null };
    };

    // Attempt 1: the critic fails → the TeamRun fails → the critic's run is recorded FAILED.
    await expect(runInstrumentResearchTeam(INSTRUMENT, 42, { runMember: flakeCritic })).rejects.toThrow(/AGENT_UNAVAILABLE/);
    expect(agentRuns().find((r) => r.agentId === "research.role.critic")?.status).toBe("FAILED");

    // Attempt 2 (the Job OS retries the same job): every member succeeds → the deterministic-id
    // critic row is OVERWRITTEN with COMPLETED, not left lying as FAILED.
    const outcome = await runInstrumentResearchTeam(INSTRUMENT, 42, { runMember: flakeCritic });
    expect(outcome.ok).toBe(true);

    const criticRows = agentRuns().filter((r) => r.agentId === "research.role.critic");
    expect(criticRows, "exactly one critic run — no duplication").toHaveLength(1);
    expect(criticRows[0].status, "the retry's success overwrote the earlier FAILED row").toBe("COMPLETED");
    expect(teamRuns()[0].status).toBe("COMPLETED");
  });
});

describe("Team OS — no member holds privileged authority [17]", () => {
  it("every role (members + chief) carries only READ / RECOMMEND_ONLY permissions", () => {
    const allowed = new Set(["READ_MARKET_DATA", "READ_RESEARCH_DB", "RECOMMEND_ONLY"]);
    const definitions = [...RESEARCH_TEAM_V1.members.map((m) => m.definition), RESEARCH_TEAM_V1.chief];
    for (const definition of definitions) {
      expect(definition.permissions.every((p) => allowed.has(p)), `${definition.agentId} permissions`).toBe(true);
    }
  });
});

// ── Full path: real Chief-of-Staff runtime through the worker, only the gateway mocked ──────────
const gw = vi.hoisted(() => ({ calls: 0, mode: "ok" as "ok" | "critic_fail" | "critic_badjson" }));

vi.mock("@/lib/runtime/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/gateway")>();
  const success = (obj: unknown, runId: string) => ({
    ok: true as const,
    provider: "claude-code" as const,
    model: "test-model",
    text: JSON.stringify(obj),
    runId,
    sessionId: null,
    tokens: 100,
    cost: null,
    costCurrency: null,
    startedAt: "2026-08-14T09:00:00.000Z",
    completedAt: "2026-08-14T09:00:03.000Z",
    fallbackReason: null,
  });
  const SINGLE_PROPOSAL = {
    instrumentId: INSTRUMENT,
    thesis: "Close above SMA20 continues over the next two weeks.",
    rationale: "The last close is above the 20-day average with positive short-term drift.",
    direction: "LONG",
    timeframe: "SWING",
    requiredFeatures: ["sma_20", "close_vs_sma20_pct"],
    entryConcept: "Enter when close holds above sma_20.",
    exitConcept: "Exit on a close back below sma_20, or a fixed stop at 2 ATR.",
    catalysts: ["Trend persistence"],
    risks: ["Mean reversion"],
    sources: [`mp://security-master/${INSTRUMENT}`],
    confidence: 0.5,
    missingEvidence: ["No fundamentals or news are in the packet."],
  };
  return {
    ...actual,
    detectProviders: async () => [{ id: "claude-code", status: "READY", models: ["test-model"], reason: null }],
    runAgent: async (request: { systemPrompt?: string }) => {
      gw.calls += 1;
      const sp = request.systemPrompt ?? "";
      if (sp.includes("securities researcher on a bounded research team")) return success(RESEARCHER_OUT, `run_${gw.calls}`);
      if (sp.includes("source and evidence verifier")) return success(VERIFIER_OUT, `run_${gw.calls}`);
      if (sp.includes("skeptical critic")) {
        if (gw.mode === "critic_fail") {
          return { ok: false as const, code: "AGENT_UNAVAILABLE", message: "no provider could serve RESEARCH", attempted: [{ provider: "claude-code", reason: "spawn ENOENT" }] };
        }
        if (gw.mode === "critic_badjson") {
          // A model reply that is not the contracted JSON object → the runtime raises CONTRACT_VIOLATION.
          return { ...success({}, `run_${gw.calls}`), text: "I could not complete this analysis." };
        }
        return success(CRITIC_OUT, `run_${gw.calls}`);
      }
      // The single-agent bridge's analyst prompt.
      return success(SINGLE_PROPOSAL, `run_${gw.calls}`);
    },
  };
});

describe("Team OS — full durable-job path (gateway mocked, real runtime)", () => {
  useTemporaryDatabase();

  let previousTestMode: string | undefined;
  beforeAll(() => {
    previousTestMode = process.env.MARKETPULSE_TEST_MODE;
    process.env.MARKETPULSE_TEST_MODE = "1";
  });
  afterAll(() => {
    if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
    else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
  });

  it("[1] a non-deep job runs the verified SINGLE-agent path, unchanged — no team", async () => {
    seedDailyCandles();
    gw.calls = 0;
    gw.mode = "ok";

    enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT } });
    const drained = await runWorker("single-test", 3);

    expect(drained.succeeded).toBeGreaterThanOrEqual(1);
    expect(teamRuns(), "a non-deep job creates no team").toHaveLength(0);
    const runs = agentRuns();
    expect(runs.some((r) => r.agentId === "research.instrument"), "the single-agent definition ran").toBe(true);
    expect(runs.every((r) => r.teamRunId === null)).toBe(true);
  });

  it("[2,10,11,12] a deep job → team → RESEARCH_COMPLETED once → job succeeds once → dependent wakes", async () => {
    seedDailyCandles();
    gw.calls = 0;
    gw.mode = "ok";

    const seen: MarketPulseEvent[] = [];
    const unsubscribe = subscribeAll((event) => seen.push(event));

    const teamJob = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT, depth: "deep" } });
    const dependent = enqueueDependent({ kind: "memory_validate", payload: {} }, [teamJob.id]);
    expect(getJob(dependent.id)?.status).toBe("waiting_dependency");

    const drained = await runWorker("team-test", 5);
    unsubscribe();

    expect(gw.calls, "one model call per member, exactly three").toBe(3);
    expect(getJob(teamJob.id)?.status).toBe("succeeded"); // #10 completes once
    expect(getJob(dependent.id)?.status, "the dependent woke on the team job's success").toBe("succeeded"); // #12

    const teams = teamRuns();
    expect(teams, "exactly one TeamRun").toHaveLength(1); // #2
    expect(teams[0].status).toBe("COMPLETED");

    const completed = seen.filter((e) => e.kind === "RESEARCH_COMPLETED" && e.instrumentId === INSTRUMENT);
    expect(completed, "RESEARCH_COMPLETED fired exactly once").toHaveLength(1); // #11

    const linked = agentRuns().filter((r) => r.teamRunId === teams[0].id);
    expect(linked, "3 members + chief, all linked to the TeamRun").toHaveLength(4);
  });

  it("[14] an invalid member output is a CONTRACT_VIOLATION that fails the team and the job", async () => {
    seedDailyCandles();
    gw.calls = 0;
    gw.mode = "critic_badjson";

    const job = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT, depth: "deep" }, maxAttempts: 1 });
    const drained = await runWorker("bad-test", 3);

    expect(drained.succeeded).toBe(0);
    expect(getJob(job.id)?.status).toBe("dead");
    expect(getJob(job.id)?.lastError ?? "").toContain("CONTRACT_VIOLATION");
    expect(teamRuns()[0]?.status).toBe("FAILED");
  });

  it("[13] a member provider failure follows Job OS retry semantics (dead at maxAttempts 1)", async () => {
    seedDailyCandles();
    gw.calls = 0;
    gw.mode = "critic_fail";

    const job = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT, depth: "deep" }, maxAttempts: 1 });
    const drained = await runWorker("fail-test", 3);

    expect(drained.succeeded).toBe(0);
    expect(getJob(job.id)?.status).toBe("dead");
    expect(getJob(job.id)?.lastError ?? "").toContain("AGENT_UNAVAILABLE");
    expect(teamRuns()[0]?.status).toBe("FAILED");
  });
});
