import { describe, expect, it, vi } from "vitest";
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

const NOW = new Date("2026-08-26T00:00:00Z");
const SESSIONS = sessionDatesFrom("2024-01-02", 700).map(sessionOpenEpoch);

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
