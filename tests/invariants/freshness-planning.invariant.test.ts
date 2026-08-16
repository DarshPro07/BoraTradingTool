import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { planUniverseIngestion, type SecurityCoverage } from "@/lib/market/universe-coverage";

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
