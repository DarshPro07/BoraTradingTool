import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { persistCandles } from "@/lib/market/candle-store";
import { sessionOpenEpoch, sessionDatesFrom } from "@/lib/market/session-calendar";
import { planUniverseIngestion, universeCoverage } from "@/lib/market/universe-coverage";

/**
 * **What MarketPulse claims can never happen:** an instrument the planner queues for refresh is
 * turned away by the executor because it already has enough history.
 *
 * This is the SAME defect as `freshness-planning.invariant.test.ts`, one layer down, and it escaped
 * because that invariant tested the planner in isolation.
 *
 * Measured 2026-08-26. Daily ingestion had been dead for ten days: 2,088 of 2,122 instruments were
 * twelve days stale while the job queue reported success. `planUniverseIngestion` correctly emitted
 * 3,324 items reading "deep but stale — refresh, not backfill", and `ingestInstrumentHistory`
 * answered every one of them with:
 *
 * ```
 * if (storedBefore >= MIN_BARS_FOR_RESEARCH) return { code: "ALREADY_READY", ... }
 * ```
 *
 * Depth was fixed the same day the planner learned to distinguish depth from freshness. The
 * executor never did, so the two layers disagreed about what the work WAS — and the disagreement
 * was invisible because each layer was individually correct and individually tested.
 *
 * So this invariant drives the real chain end to end:
 *
 *   real bars -> universeCoverage -> planUniverseIngestion -> ingestInstrumentHistory
 *
 * with nothing injected between the planner and the executor.
 */

useTemporaryDatabase();

/**
 * 17:30 IST on Wednesday 2026-08-26 — after the close, so 08-26 itself is the latest session whose
 * bar should exist. Pinned, because "current" is now judged against the calendar and the clock
 * rather than against whatever the store happens to hold.
 */
const NOW = new Date("2026-08-26T12:00:00Z");
const LATEST_SESSION = "2026-08-26";
const SESSIONS = sessionDatesFrom("2023-01-02", 1_200)
  .filter((date) => date <= LATEST_SESSION)
  .slice(-700)
  .map(sessionOpenEpoch);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

function seedListing(symbol: string): void {
  const db = getDb();
  db.insert(schema.securityMasterSyncs)
    .values({
      id: "sync-refresh-invariant",
      observedAt: NOW,
      startedAt: NOW,
      status: "SUCCEEDED",
      sourceManifest: "{}",
      actor: "invariant",
    })
    .onConflictDoNothing()
    .run();
  db.insert(schema.nseSecurities)
    .values({ isin: `INE_${symbol}`, firstObservedAt: NOW, lastObservedAt: NOW })
    .onConflictDoNothing()
    .run();
  db.insert(schema.nseListingVersions)
    .values({
      isin: `INE_${symbol}`,
      symbol,
      name: symbol,
      series: "EQ",
      assetType: "EQUITY",
      listingStatus: "LISTED",
      effectiveFrom: NOW,
      sourceSyncId: "sync-refresh-invariant",
    })
    .run();
}

/** Bars on exactly these session dates. */
function seedSessions(symbol: string, dates: readonly string[]): void {
  persistCandles(
    dates.map((date) => ({
      ticker: `IN:XNSE:${symbol}`,
      resolution: "D",
      time: sessionOpenEpoch(date),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1_000,
    })),
  );
}

/** `count` real sessions ending `endedSessionsAgo` before the newest session in `SESSIONS`. */
function seedBars(symbol: string, count: number, endedSessionsAgo: number): void {
  const end = SESSIONS.length - 1 - endedSessionsAgo;
  persistCandles(
    Array.from({ length: count }, (_unused, i) => ({
      ticker: `IN:XNSE:${symbol}`,
      resolution: "D",
      time: SESSIONS[end - (count - 1 - i)]!,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1_000,
    })),
  );
}

describe("INVARIANT: depth never turns away work the planner queued as a refresh", () => {
  it("the executor attempts a fetch for a DEEP BUT STALE instrument", async () => {
    seedListing("CURRENTCO");
    seedListing("STALECO");
    seedBars("CURRENTCO", 400, 0); // up to date — defines the universe's newest bar
    seedBars("STALECO", 400, 12); // plenty of history, twelve sessions behind

    // The planner's view, from real rows.
    const report = universeCoverage();
    const stale = report.securities.find((s) => s.symbol === "STALECO");
    expect(stale?.historyReady, "400 bars is ample depth").toBe(true);
    expect(stale?.freshnessReady, "twelve sessions behind is stale").toBe(false);

    const plan = planUniverseIngestion(20, report);
    const queued = plan.find((item) => item.instrumentId === "IN:XNSE:STALECO");
    expect(queued, "the planner must queue it").toBeDefined();
    expect(queued?.reason).toMatch(/refresh, not backfill/i);

    // Now hand that exact item to the executor. The provider is mocked so the test asserts
    // INTENT — that a fetch is attempted at all — rather than depending on a network call.
    const service = await import("@/lib/market/service");
    const spy = vi.spyOn(service, "getNormalizedCandles").mockResolvedValue({
      candles: [],
      provenance: { identityVerdict: "UNSTATED" },
    } as never);

    const { ingestInstrumentHistory } = await import("@/lib/market/ingest");
    const outcome = await ingestInstrumentHistory("IN:XNSE:STALECO");

    expect(
      outcome.code,
      "a stale instrument must not be dismissed as ALREADY_READY — that is the whole defect",
    ).not.toBe("ALREADY_READY");
    expect(spy, "the executor must actually reach for data").toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still short-circuits an instrument that is deep AND current", async () => {
    // The guard must not become a blunt instrument: re-fetching everything on every pass would
    // hammer the provider and undo the reason the early return exists.
    seedListing("FRESHCO");
    seedBars("FRESHCO", 400, 0);

    const service = await import("@/lib/market/service");
    const spy = vi.spyOn(service, "getNormalizedCandles");

    const { ingestInstrumentHistory } = await import("@/lib/market/ingest");
    const outcome = await ingestInstrumentHistory("IN:XNSE:FRESHCO");

    expect(outcome.code).toBe("ALREADY_READY");
    expect(spy, "a current instrument needs no provider call").not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("INVARIANT: the SCHEDULED path queues refresh work, not only the executor", () => {
  /**
   * The previous fix covered the planner and the executor, and was reported as fixing daily
   * ingestion. It did not. Three weeks later 2,077 of 2,122 instruments were 24 days stale and
   * exactly ONE instrument updated per session.
   *
   * Two more layers sat between planner and executor on the scheduled path, each judging "done" on
   * depth alone:
   *
   *   resolveDataRequirement  asked instrumentReadiness(), depth-only -> SATISFIED for stale names
   *   enqueue()               deduped against a past SUCCEEDED row for the same key, forever
   *
   * A manual catch-up that called the executor directly worked, which is precisely what hid them:
   * the one path that got exercised was the one path that was not broken. The lone instrument that
   * did update was the one whose job kept FAILING — only a dead row was revivable.
   *
   * So this drives `resolveUniverseDataGaps`, the function the cycle actually calls.
   */
  function seedSucceededJob(symbol: string, updatedAt: Date): void {
    getDb()
      .insert(schema.researchJobs)
      .values({
        kind: "ingest_history",
        payload: JSON.stringify({ instrumentId: `IN:XNSE:${symbol}` }),
        status: "succeeded",
        priority: 100,
        attempts: 1,
        maxAttempts: 3,
        dedupeKey: `ingest-history-IN:XNSE:${symbol}`,
        availableAt: updatedAt,
        createdAt: updatedAt,
        updatedAt,
      })
      .run();
  }

  const jobFor = (symbol: string) =>
    getDb()
      .select()
      .from(schema.researchJobs)
      .where(eq(schema.researchJobs.dedupeKey, `ingest-history-IN:XNSE:${symbol}`))
      .get();

  it("re-queues a deep-but-stale instrument whose last ingest SUCCEEDED long ago", async () => {
    seedListing("NOWCO");
    seedListing("LAGCO");
    seedBars("NOWCO", 400, 0);
    seedBars("LAGCO", 400, 12);
    seedSucceededJob("LAGCO", new Date(Date.now() - 3 * 86_400_000));

    const { resolveUniverseDataGaps } = await import("@/lib/brain/dependency-resolver");
    await resolveUniverseDataGaps({ quota: 50 });

    expect(
      jobFor("LAGCO")?.status,
      "a past success must not stand in for today's refresh",
    ).toBe("queued");
  });

  it("leaves a deep AND current instrument alone, even with a succeeded job on file", async () => {
    // Refreshing everything every cycle would hammer the provider for bars that do not exist yet.
    seedListing("OKCO");
    seedBars("OKCO", 400, 0);
    seedSucceededJob("OKCO", new Date(Date.now() - 3 * 86_400_000));

    const { resolveUniverseDataGaps } = await import("@/lib/brain/dependency-resolver");
    await resolveUniverseDataGaps({ quota: 50 });

    expect(jobFor("OKCO")?.status).toBe("succeeded");
  });

  it("does not re-queue a stale instrument refreshed moments ago", async () => {
    // Before the close, a refresh can succeed and leave the instrument still "stale" because the
    // provider has no new bar yet. Without a cooldown, every cycle would re-queue it — the enqueue
    // cadence would become the retry loop.
    seedListing("FRESHNOW");
    seedListing("JUSTRAN");
    seedBars("FRESHNOW", 400, 0);
    seedBars("JUSTRAN", 400, 12);
    seedSucceededJob("JUSTRAN", new Date());

    const { resolveUniverseDataGaps } = await import("@/lib/brain/dependency-resolver");
    await resolveUniverseDataGaps({ quota: 50 });

    expect(jobFor("JUSTRAN")?.status).toBe("succeeded");
  });
});

describe("INVARIANT: current means current through the latest SESSION, not the latest bar we hold", () => {
  /**
   * Freshness used to be measured against the store's own newest bar. That rule has a fixed point
   * it can never leave: if ingestion stops for EVERY instrument at once, every instrument is exactly
   * as current as the newest bar, nothing is stale, nothing is queued, and the newest bar never
   * moves again. The only thing that broke it in production was one instrument whose job kept
   * failing and being revived.
   */
  it("reads a universe that stopped TOGETHER as stale — a paused ingest is not a quiet market", () => {
    const symbols = ["PAUSEA", "PAUSEB", "PAUSEC"];
    for (const symbol of symbols) {
      seedListing(symbol);
      seedBars(symbol, 400, 2);
    }

    const report = universeCoverage();
    for (const symbol of symbols) {
      expect(
        report.securities.find((s) => s.symbol === symbol)?.freshnessReady,
        `${symbol} is two sessions behind the latest session, whatever its neighbours hold`,
      ).toBe(false);
    }
    expect(
      planUniverseIngestion(20, report).map((item) => item.instrumentId).sort(),
      "every paused instrument must re-enter the worklist",
    ).toEqual(symbols.map((symbol) => `IN:XNSE:${symbol}`));
  });

  it("does not call a calendar holiday staleness", () => {
    // The reason the relative rule existed. Monday 2026-09-14 is an NSE holiday: at 17:30 IST that
    // day the latest session is Friday 09-11, and an instrument current through Friday is current.
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
    seedListing("HOLIDAYCO");
    seedSessions("HOLIDAYCO", sessionDatesFrom("2025-01-01", 600).filter((d) => d <= "2026-09-11").slice(-400));

    const security = universeCoverage().securities.find((s) => s.symbol === "HOLIDAYCO");
    expect(security?.freshnessReady, "a holiday is not a missing bar").toBe(true);
  });

  it("does not expect today's bar before the provider can have published it", () => {
    // 07:30 IST on Thursday 08-27: the market has not opened, so Wednesday's bar is the newest
    // that can exist.
    vi.setSystemTime(new Date("2026-08-27T02:00:00Z"));
    seedListing("EARLYCO");
    seedBars("EARLYCO", 400, 0);

    const security = universeCoverage().securities.find((s) => s.symbol === "EARLYCO");
    expect(security?.freshnessReady).toBe(true);
  });
});

describe("INVARIANT: the scheduled CYCLE refreshes stale data with nothing else wrong", () => {
  /**
   * Layers 1-4 of this defect were fixed and each fix was tested at its own layer, including
   * `resolveUniverseDataGaps` called directly. The cycle never called it: its only call site sat
   * inside the branch for a strategy whose universe had NO bars at all. A universe that was merely
   * stale never entered that branch, so on the scheduled path nothing ever queued a refresh.
   *
   * This drives `runLearningCycle` — the body the Windows task runs — with no strategy, no outage,
   * one stale instrument, and asserts the refresh is queued AND attempted in the same pass.
   */
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ["MARKETPULSE_TEST_MODE", "QUANT_CORE_URL", "QUANT_CORE_ROOT"]) saved[key] = process.env[key];
    // Empty provider: the test asserts the attempt, not a network call.
    process.env.MARKETPULSE_TEST_MODE = "1";
    process.env.QUANT_CORE_URL = "off";
    process.env.QUANT_CORE_ROOT = path.join(os.tmpdir(), "marketpulse-no-quant-core");
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("queues and drains a deep-but-stale instrument", async () => {
    const { setLearningMode } = await import("@/lib/governance/runtime");
    setLearningMode("learning", "owner");
    seedListing("CYCLECO");
    seedBars("CYCLECO", 400, 3);

    const { runLearningCycle } = await import("@/lib/learning/cycle");
    await runLearningCycle(
      "invariant-cycle",
      async () => ({}),
      async () => ({ dataset: {}, reference: [], references: {} }) as never,
      async () => ({ failed: false, reason: "intake off", enqueued: 0, deduped: 0, rejected: 0 }),
    );

    const job = getDb()
      .select()
      .from(schema.researchJobs)
      .where(eq(schema.researchJobs.dedupeKey, "ingest-history-IN:XNSE:CYCLECO"))
      .get();
    expect(job, "the cycle itself must queue the refresh — no strategy outage required").toBeDefined();
    expect(job!.attempts, "and drain it in the same pass").toBeGreaterThan(0);
  }, 60_000);
});
