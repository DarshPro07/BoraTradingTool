import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { subscribeAll, type MarketPulseEvent } from "@/lib/brain/event-bus";
import { applyNseSecurityMasterSync } from "@/lib/market/security-master";
import { persistCandles } from "@/lib/market/candle-store";
import { sessionOpenEpoch } from "@/lib/market/session-calendar";
import type { ImportedCandle } from "@/lib/market/dataset-import";
import { enqueue, getJob, enqueueDependent } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { FIXTURE_ENVELOPE } from "@/lib/research/proposal-contract";
import type { BridgeResult } from "@/lib/research/bridge";
import { runInstrumentResearch } from "./runtime";
import { RESEARCH_INSTRUMENT_V1 } from "./definitions";

/**
 * The first Agent slice, per the owner's §15 acceptance:
 *
 *   JOB OS → Agent → Model → Result → Ledger → Event → Dependent wake
 *
 * proven end to end, plus the failure and dependency mappings. Two layers of test:
 *   - handler-logic tests inject a deterministic research CORE (no model, no network), exercising
 *     the AgentRun recording, its provenance, and the failure → dependency-grammar mapping directly;
 *   - one full-path test drives a real durable job through the worker with only the GATEWAY mocked,
 *     so the real bridge runs, verifies citations, emits RESEARCH_COMPLETED, and a dependent wakes.
 */

const INSTRUMENT = "IN:XNSE:RELIANCE";

/**
 * The gateway is mocked file-wide (hoisted), because the worker's import chain pulls the real
 * gateway BEFORE any in-test `vi.doMock` could take effect — an unmocked run spawns the Claude CLI
 * and the test times out. `runAgent`/`detectProviders` are overridden; every other export is kept.
 */
const gatewayMock = vi.hoisted(() => ({ calls: 0, response: null as unknown }));

vi.mock("@/lib/runtime/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/gateway")>();
  return {
    ...actual,
    detectProviders: async () => [{ id: "claude-code", status: "READY", models: ["test-model"], reason: null }],
    runAgent: async () => {
      gatewayMock.calls += 1;
      if (!gatewayMock.response) throw new Error("gateway mock: no response configured for this test");
      return gatewayMock.response;
    },
  };
});

/** Seed an NSE master that actually lists RELIANCE, so `findNseInstrument` resolves it as known. */
function seedNseMasterWithReliance(): void {
  const result = applyNseSecurityMasterSync({
    observedAt: new Date("2026-08-09T00:00:00Z"),
    actor: "agent-slice-test",
    minimumRows: 1,
    sources: [
      {
        kind: "MAIN",
        url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        content: [
          "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
          "RELIANCE,Reliance Industries Limited,EQ,01-JAN-2020,10,1,INE002A01018,10",
        ].join("\n"),
      },
    ],
  });
  if (!result.ok) throw new Error(result.message);
}

function okResult(): BridgeResult {
  return { ok: true, envelope: FIXTURE_ENVELOPE, events: [] };
}
function failResult(code: string, provider = "claude-code"): BridgeResult {
  return { ok: false, code, message: `${code} occurred`, events: [], provider, model: "test-model" };
}

describe("runInstrumentResearch — handler logic (injected core)", () => {
  useTemporaryDatabase(seedNseMasterWithReliance);

  const agentRuns = () => getDb().select().from(schema.agentRuns).all();

  it("a successful run records an AgentRun with agent + job provenance, COMPLETED", async () => {
    let coreCalls = 0;
    const outcome = await runInstrumentResearch(INSTRUMENT, 42, async () => {
      coreCalls += 1;
      return okResult();
    });

    expect(coreCalls, "the gateway/core is called exactly once").toBe(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.agentId).toBe(RESEARCH_INSTRUMENT_V1.agentId);
    expect(outcome.agentVersion).toBe(RESEARCH_INSTRUMENT_V1.version);

    const rows = agentRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "COMPLETED",
      agentId: "research.instrument",
      agentVersion: "v1",
      jobId: 42,
      instrumentId: INSTRUMENT,
      // The recorded provider/model come from the envelope's researchRun — assert them so a
      // regression that scrambled attribution on the SUCCESS path (a different line than the
      // failure path) cannot pass unnoticed.
      provider: "fixture",
      model: "contract-fixture",
    });
    // The row pins the exact definition by version, so a later prompt change never rewrites history.
    // verificationStatus is derived from the envelope, never accepted as a separate claim.
    expect(rows[0].verificationStatus).toBe(FIXTURE_ENVELOPE.status);
  });

  it("a provider failure records a FAILED AgentRun and THROWS a coded error for the Job OS to retry", async () => {
    await expect(
      runInstrumentResearch(INSTRUMENT, 7, async () => failResult("AGENT_TIMEOUT")),
    ).rejects.toThrow(/AGENT_TIMEOUT/);

    const rows = agentRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "FAILED", refusalCode: "AGENT_TIMEOUT", jobId: 7, provider: "claude-code" });
  });

  it("an invalid structured output (CONTRACT_VIOLATION) is a visible FAILED run and a retryable throw", async () => {
    await expect(
      runInstrumentResearch(INSTRUMENT, 8, async () => failResult("CONTRACT_VIOLATION")),
    ).rejects.toThrow(/CONTRACT_VIOLATION/);
    expect(agentRuns()[0]).toMatchObject({ status: "FAILED", refusalCode: "CONTRACT_VIOLATION" });
  });

  it("a permanent code (INSTRUMENT_UNKNOWN) throws so the Job OS kills it — REFUSED run, no blind retry", async () => {
    await expect(
      runInstrumentResearch(INSTRUMENT, 9, async () => failResult("INSTRUMENT_UNKNOWN", "none")),
    ).rejects.toThrow(/INSTRUMENT_UNKNOWN/);
    expect(agentRuns()[0]).toMatchObject({ status: "REFUSED", refusalCode: "INSTRUMENT_UNKNOWN" });
  });

  it("NO_STORED_DATA returns to the dependency grammar — ingestion + a dependent research job, and the run defers (not a blind retry)", async () => {
    // The real dependency resolver runs here: RELIANCE is known in the seeded master but has no
    // stored bars, so the requirement resolves to REMEDIATION_QUEUED with a real ingest job.
    const outcome = await runInstrumentResearch(INSTRUMENT, 10, async () => failResult("NO_STORED_DATA", "none"));

    expect(outcome.ok).toBe(false);
    expect(outcome.deferred?.reason).toBe("NO_STORED_DATA");
    // The refusal is recorded, AND the work that unblocks it was created.
    expect(agentRuns()[0]).toMatchObject({ status: "REFUSED", refusalCode: "NO_STORED_DATA" });

    const jobs = getDb().select().from(schema.researchJobs).all();
    const ingest = jobs.find((j) => j.kind === "ingest_history");
    const dependent = jobs.find((j) => j.kind === "instrument_research");
    expect(ingest, "the missing history was queued for ingestion").toBeDefined();
    expect(dependent, "a research job that waits for the data was queued").toBeDefined();
    expect(dependent?.status, "the dependent research is paused until ingestion succeeds").toBe("waiting_dependency");
  });
});

/**
 * A deterministic daily series long enough to clear the bridge's 60-bar research floor.
 *
 * Walks **trading days**, not calendar days. An earlier version advanced by a flat 86,400s and so
 * produced Saturday and Sunday bars — a series no exchange ever emitted, and one the store now
 * refuses outright (`tests/invariants/session-calendar.invariant.test.ts`).
 */
function seedDailyCandles(count = 70): void {
  const cursor = new Date("2026-01-01T00:00:00Z");
  const candles: ImportedCandle[] = [];
  for (let index = 0; index < count; ) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const price = 100 + Math.sin(index / 5) * 4 + index * 0.1;
      candles.push({
        ticker: INSTRUMENT,
        resolution: "D",
        time: sessionOpenEpoch(cursor.toISOString().slice(0, 10)),
        open: price,
        high: price + 1,
        low: price - 1,
        close: price + 0.3,
        volume: 1_000_000,
      });
      index += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  persistCandles(candles);
}

describe("instrument_research — full durable-job path (gateway mocked, real bridge)", () => {
  // No explicit master seed here: TEST_MODE auto-bootstraps one (dated ~now), and the bridge
  // resolves the instrument id by syntax regardless — seeding again would collide on the sync date.
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

  it("job → agent → gateway (once) → AgentRun COMPLETED → RESEARCH_COMPLETED → dependent wakes", async () => {
    // Seed daily bars directly so the bridge's evidence packet clears the 60-bar floor with no
    // dependency on the provider chain — the point under test is the AGENT SEAM, not ingestion.
    seedDailyCandles();

    gatewayMock.calls = 0;
    gatewayMock.response = {
      ok: true,
      provider: "claude-code",
      model: "test-model",
      text: JSON.stringify({
        instrumentId: INSTRUMENT,
        thesis: "Close holding above its 20-day mean suggests continuation over the next two weeks.",
        rationale: "The last close sits above the supplied 20-day average with positive short-term drift.",
        direction: "LONG",
        timeframe: "SWING",
        requiredFeatures: ["sma_20", "close_vs_sma20_pct"],
        entryConcept: "Enter when close holds above sma_20.",
        exitConcept: "Exit on a close back below sma_20, or a fixed stop at 2 ATR.",
        catalysts: ["Trend persistence"],
        risks: ["Mean reversion in weak breadth"],
        // Cites a string the packet actually supplies → SOURCE_VERIFIED, proving the real
        // verification ran rather than being stubbed.
        sources: [`mp://security-master/${INSTRUMENT}`],
        confidence: 0.5,
        missingEvidence: ["No fundamentals or news are in the packet."],
      }),
      runId: "run_fullpath_1",
      sessionId: null,
      tokens: 120,
      cost: null,
      costCurrency: null,
      startedAt: "2026-08-14T09:00:00.000Z",
      completedAt: "2026-08-14T09:00:04.000Z",
      fallbackReason: null,
    };

    const seen: MarketPulseEvent[] = [];
    const unsubscribe = subscribeAll((event) => seen.push(event));

    const research = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT } });
    // A downstream job that must not run until the research succeeds.
    const dependent = enqueueDependent({ kind: "memory_validate", payload: {} }, [research.id]);
    expect(getJob(dependent.id)?.status).toBe("waiting_dependency");

    const drained = await runWorker("agent-test", 5);
    unsubscribe();

    expect(gatewayMock.calls, "the gateway is called exactly once for one research job").toBe(1);
    expect(drained.succeeded, "research + the woken dependent").toBeGreaterThanOrEqual(2);

    expect(getJob(research.id)?.status).toBe("succeeded");
    expect(getJob(dependent.id)?.status, "the dependent woke on the research job's success").toBe("succeeded");

    const run = getDb().select().from(schema.agentRuns).where(eq(schema.agentRuns.jobId, research.id)).get();
    expect(run, "the AgentRun is linked to the durable job").toBeDefined();
    expect(run).toMatchObject({
      status: "COMPLETED",
      agentId: "research.instrument",
      agentVersion: "v1",
      verificationStatus: "SOURCE_VERIFIED",
      // The configured provider/model of the run are recorded (owner §15: "configured model/provider recorded").
      provider: "claude-code",
      model: "test-model",
    });

    expect(
      seen.some((e) => e.kind === "RESEARCH_COMPLETED" && e.instrumentId === INSTRUMENT),
      "RESEARCH_COMPLETED fired for the job path",
    ).toBe(true);
  });

  it("provider failure THROUGH THE WORKER → AgentRun FAILED linked to the job → job settles dead per the Job OS", async () => {
    // Bars are seeded so the bridge reaches the gateway (a NO_STORED_DATA refusal would DEFER before
    // the model call, proving nothing about provider-failure handling).
    seedDailyCandles();

    gatewayMock.calls = 0;
    // The gateway's own "no provider could serve this" result — a returned refusal, not a throw,
    // which is how the real gateway reports an unavailable provider.
    gatewayMock.response = {
      ok: false,
      code: "AGENT_UNAVAILABLE",
      message: "no provider could serve RESEARCH",
      attempted: [{ provider: "claude-code", reason: "spawn claude ENOENT" }],
    };

    // maxAttempts:1 ⇒ the failure is terminal in one drain and VISIBLE on /jobs — the same
    // "no silent retry forever" pattern the validation-refusal chain uses.
    const research = enqueue({ kind: "instrument_research", payload: { instrumentId: INSTRUMENT }, maxAttempts: 1 });
    const drained = await runWorker("agent-fail-test", 3);

    expect(gatewayMock.calls, "the bridge reached the gateway before failing").toBe(1);
    expect(drained.succeeded).toBe(0);
    expect(drained.dead).toBeGreaterThanOrEqual(1);

    const job = getJob(research.id);
    expect(job?.status, "attempts exhausted → dead, not retried forever").toBe("dead");
    expect(job?.lastError ?? "").toContain("AGENT_UNAVAILABLE");

    // The failure is a first-class AgentRun, linked to the job, with the failing provider preserved.
    const run = getDb().select().from(schema.agentRuns).where(eq(schema.agentRuns.jobId, research.id)).get();
    expect(run).toMatchObject({
      status: "FAILED",
      refusalCode: "AGENT_UNAVAILABLE",
      provider: "claude-code",
      agentId: "research.instrument",
      agentVersion: "v1",
    });
  });
});
