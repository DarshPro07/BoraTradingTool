import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { persistCandles } from "@/lib/market/candle-store";
import {
  planUniverseIngestion,
  universeCoverage,
  type SecurityCoverage,
} from "@/lib/market/universe-coverage";

/**
 * **What MarketPulse claims can never happen:** an instrument with enough history stops being
 * updated because it has enough history.
 *
 * `planUniverseIngestion` filtered candidates on `!security.researchReady`, so an instrument left
 * the ingestion worklist the moment its depth was sufficient and nothing ever returned it on
 * freshness grounds. Self-reinforcing: the better covered a name was, the sooner it went stale.
 *
 * Measured 2026-08-16 — exactly three instruments had fallen behind, and they were **RELIANCE,
 * HDFCBANK and TCS**, the three largest weights on the NSE, eight days stale against a universe
 * that had moved on. Depth and currency are different questions and a single flag answered only
 * the first.
 */

useTemporaryDatabase();

function coverage(symbol: string, over: Partial<SecurityCoverage>): SecurityCoverage {
  return {
    isin: `INE${symbol}`,
    symbol,
    instrumentId: `IN:XNSE:${symbol}`,
    tier: "MAIN_BOARD",
    dailyBars: 900,
    fiveMinuteSessions: 0,
    completeFiveMinuteSessions: 0,
    openingWindowSessions: 0,
    researchReady: true,
    historyReady: true,
    freshnessReady: true,
    lastDailyBar: 1_780_000_000,
    backtestReady: true,
    validationReady: true,
    intradayReady: false,
    missingReason: null,
    ...over,
  };
}

describe("INVARIANT: depth never suppresses freshness work", () => {
  it("a deep but stale instrument re-enters the worklist", () => {
    const plan = planUniverseIngestion(20, {
      securities: [
        coverage("RELIANCE", { freshnessReady: false, lastDailyBar: 1_779_000_000 }),
        coverage("INFY", {}),
      ],
    } as never);

    const stale = plan.find((item) => item.instrumentId === "IN:XNSE:RELIANCE");
    expect(stale, "history-ready but stale must still be planned").toBeDefined();
    expect(stale?.reason).toMatch(/stale/i);
    // ...and a current instrument is not queued for work it does not need.
    expect(plan.find((item) => item.instrumentId === "IN:XNSE:INFY")).toBeUndefined();
  });

  it("distinguishes a refresh from a backfill in what it reports", () => {
    // The two are different work with different urgency, and a planner that called both
    // "ingest this" would hide which one it meant.
    const plan = planUniverseIngestion(20, {
      securities: [
        coverage("STALE", { freshnessReady: false, lastDailyBar: 1_779_000_000 }),
        coverage("THIN", { dailyBars: 12, historyReady: false, researchReady: false, missingReason: "INSUFFICIENT_BARS" }),
      ],
    } as never);

    const stale = plan.find((i) => i.instrumentId === "IN:XNSE:STALE")?.reason ?? "";
    const thin = plan.find((i) => i.instrumentId === "IN:XNSE:THIN")?.reason ?? "";
    expect(stale).toMatch(/refresh, not backfill/i);
    expect(thin).not.toMatch(/refresh/i);
  });
});

describe("INVARIANT: end to end, from real rows — a stale name is planned for refresh", () => {
  /**
   * The stronger form, closing this suite's own gap.
   *
   * The test above hands `planUniverseIngestion` a constructed `SecurityCoverage`, so it proves the
   * PLANNER respects the freshness flag. It does not prove the flag is derived from real bars. This
   * one starts at the store and runs the whole chain:
   *
   *   real listing + real price_candles -> universeCoverage() -> planUniverseIngestion()
   *
   * with nothing injected. RELIANCE, HDFCBANK and TCS went stale inside exactly this composition.
   */
  const NOW = new Date("2026-08-16T00:00:00Z");
  const DAY = 86_400;

  // "Current" is judged against the latest session the calendar says should exist by now, so the
  // clock is pinned: Sunday 08-16 05:30 IST, whose latest session is Friday 08-14.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  const LATEST = Math.floor(NOW.getTime() / 1000);

  function seedListing(symbol: string): void {
    const db = getDb();
    db.insert(schema.securityMasterSyncs)
      .values({
        id: "sync-invariant",
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
        sourceSyncId: "sync-invariant",
      })
      .run();
  }

  /** `count` daily bars ending `endedDaysAgo` before the universe's newest bar. */
  function seedBars(symbol: string, count: number, endedDaysAgo: number): void {
    const end = LATEST - endedDaysAgo * DAY;
    persistCandles(
      Array.from({ length: count }, (_unused, i) => ({
        ticker: `IN:XNSE:${symbol}`,
        resolution: "D",
        time: end - (count - 1 - i) * DAY,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1_000,
      })),
    );
  }

  it("derives staleness from the bars themselves and emits refresh work", () => {
    seedListing("CURRENTCO");
    seedListing("STALECO");
    seedBars("CURRENTCO", 400, 0); // up to date — defines the universe's newest bar
    seedBars("STALECO", 400, 10); // deep, but ten days behind

    const report = universeCoverage();
    const stale = report.securities.find((s) => s.symbol === "STALECO");
    const current = report.securities.find((s) => s.symbol === "CURRENTCO");

    // Depth and currency are answered separately, from real data.
    expect(stale?.historyReady, "400 bars is plenty of depth").toBe(true);
    expect(stale?.freshnessReady, "ten days behind the latest session is stale").toBe(false);
    expect(current?.freshnessReady).toBe(true);

    const plan = planUniverseIngestion(20, report);
    const planned = plan.find((item) => item.instrumentId === "IN:XNSE:STALECO");
    expect(planned, "a deep but stale instrument must re-enter the worklist").toBeDefined();
    expect(planned?.reason).toMatch(/stale/i);
    expect(plan.find((item) => item.instrumentId === "IN:XNSE:CURRENTCO")).toBeUndefined();
  });
});
