import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { persistCandles } from "@/lib/market/candle-store";
import { normalizeSeries, PriceBasisUnavailableError } from "@/lib/market/price-basis";
import { snapshotFromStore } from "@/lib/research-data/snapshot";

/**
 * **What MarketPulse claims can never happen:** a caller asks for a price basis the store cannot
 * establish and is quietly given a different one.
 *
 * VERIFIED against Yahoo, 2026-08-16, around RELIANCE's 1:1 bonus of ex-date 2024-10-28:
 *
 * ```
 *   2024-10-22   as fetched then   O 2675.00  C 2677.05
 *                as fetched now    O 1369.20  C 1343.35
 * ```
 *
 * The provider retroactively adjusts the whole OHLC, so a stored bar carries whatever basis was
 * current the day it was written. `RAW` claims the numbers printed on the tape, and this store
 * cannot make that claim about history — reconstructing it needs per-bar ingestion dates that
 * predate the ingestion ledger.
 *
 * The name was `RAW` for months while meaning `AS_FETCHED`. Execution simulation and cost
 * accounting are exactly where that difference decides whether a fill was possible, so the
 * substitution would have done its damage in the worst available place.
 */

useTemporaryDatabase();

const DAY = 86_400;

function bars(price: number, count: number, from = 1_700_000_000) {
  return Array.from({ length: count }, (_unused, i) => ({
    time: from + i * DAY,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1_000,
  }));
}

describe("INVARIANT: an unestablishable basis is refused, never substituted", () => {
  it("RAW throws rather than returning AS_FETCHED wearing its name", () => {
    expect(() => normalizeSeries(bars(100, 10), [], "RAW")).toThrow(PriceBasisUnavailableError);
    expect(() => normalizeSeries(bars(100, 10), [], "RAW")).toThrow(/retroactively adjusts/i);
  });

  it("AS_FETCHED is available and honest about what it is", () => {
    const out = normalizeSeries(bars(100, 10), [], "AS_FETCHED");
    expect(out.basis).toBe("AS_FETCHED");
    expect(out.bars[0].close).toBe(100);
  });
});

describe("INVARIANT: every snapshot states its basis and its inference debt", () => {
  it("declares the basis it was built on", () => {
    persistCandles(
      bars(100, 40).map((bar) => ({ ...bar, ticker: "IN:XNSE:BASIS", resolution: "D", volume: 1_000 })),
    );
    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    // A series without a declared basis is what let the store hold two of them at once.
    expect(snapshot.priceBasis).toBe("SPLIT_ADJUSTED");
    // ...and how much of any correction rests on inference rather than a declared provider event.
    expect(snapshot.inferredActionsUsed).toBe(0);
  });
});
