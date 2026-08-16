import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { persistCandles } from "@/lib/market/candle-store";
import { recordCorporateActions } from "@/lib/market/corporate-actions";
import { snapshotFromStore } from "@/lib/research-data/snapshot";

/**
 * **What MarketPulse claims can never happen:** a regular-session strategy consumes a price that
 * the store itself cannot explain.
 *
 * Three separate contaminants have to be withheld, and each was found in the production store:
 *
 *   corporate-action step   RELIANCE 2024-10-24 = 2655.70 beside 2024-10-27 = 1334.35. A 1:2 split
 *                           reads as a −50% day with the trend filter intact — the strongest
 *                           possible trigger for the declared swing mean-reversion family.
 *   unexplained seam        TRIVENI stepped 1.711, matching no plausible action ratio. Forcing a
 *                           correction would erase whatever really happened.
 *   session artifact        Three instruments each held one bar stamped exactly 15:30 IST with
 *                           O=H=L=C and volume 0 — a provider stamp at the close, not a trade.
 *
 * Driven through `snapshotFromStore`, the real path every backtest takes, because the point is the
 * boundary and not the individual detectors.
 */

useTemporaryDatabase();

const DAY = 86_400;
const IST_OFFSET = 19_800;

function daily(ticker: string, price: number, count: number, from: number) {
  return Array.from({ length: count }, (_unused, i) => ({
    ticker,
    resolution: "D",
    time: from + i * DAY,
    open: price,
    high: price * 1.005,
    low: price * 0.995,
    close: price,
    volume: 1_000,
  }));
}

describe("INVARIANT: research data contains no unexplained price discontinuity", () => {
  const SPLIT_AT = 1_730_000_000;

  it("withholds an instrument whose step nothing explains, and names it", () => {
    // The TRIVENI shape: a large step with no recorded action and no plausible ratio.
    persistCandles([
      ...daily("IN:XNSE:UNEXPLAINED", 1000, 8, SPLIT_AT - 8 * DAY),
      ...daily("IN:XNSE:UNEXPLAINED", 584, 8, SPLIT_AT),
      ...daily("IN:XNSE:CLEAN", 500, 16, SPLIT_AT - 8 * DAY),
    ]);

    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    expect(snapshot.dataset["IN:XNSE:UNEXPLAINED"]).toBeUndefined();
    expect(snapshot.quarantined.map((q) => q.instrumentId)).toContain("IN:XNSE:UNEXPLAINED");
    // Withholding must never be silent — a reader has to be able to see what was kept back.
    expect(snapshot.quarantined[0].reason.length).toBeGreaterThan(10);
    // ...and a clean instrument beside it is unaffected.
    expect(snapshot.dataset["IN:XNSE:CLEAN"]).toBeDefined();
  });

  it("serves a continuous series once the action explains the step", () => {
    persistCandles([
      ...daily("IN:XNSE:EXPLAINED", 2000, 8, SPLIT_AT - 8 * DAY),
      ...daily("IN:XNSE:EXPLAINED", 1000, 8, SPLIT_AT),
      ...daily("IN:XNSE:CLEAN", 500, 16, SPLIT_AT - 8 * DAY),
    ]);
    recordCorporateActions([
      {
        instrumentId: "IN:XNSE:EXPLAINED",
        effectiveTime: SPLIT_AT,
        kind: "SPLIT",
        ratio: 2,
        amount: null,
        source: "yahoo:events",
      },
    ]);

    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    const served = snapshot.dataset["IN:XNSE:EXPLAINED"];
    expect(served, "an explained step must not quarantine the instrument").toBeDefined();
    const closes = served.map((bar) => bar.close);
    const worst = Math.min(...closes.slice(1).map((c, i) => c / closes[i]));
    expect(worst, "the step must be gone from what research receives").toBeGreaterThan(0.9);

    // The store still holds what the provider actually said.
    const raw = getDb().select().from(schema.priceCandles).all();
    expect(raw.some((row) => row.close === 2000)).toBe(true);
  });
});

describe("INVARIANT: no out-of-session bar reaches regular-session research", () => {
  it("withholds a closing-boundary artifact while keeping the session intact", () => {
    const ticker = "IN:XNSE:CLOSESTAMP";
    const midnight = Math.floor(new Date("2026-08-14T00:00:00Z").getTime() / 1000);
    const at = (h: number, m: number, volume: number) => ({
      ticker,
      resolution: "5",
      time: midnight + h * 3600 + m * 60 - IST_OFFSET,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume,
    });

    const bars = [];
    for (let minute = 9 * 60 + 15; minute <= 15 * 60 + 25; minute += 5) {
      bars.push(at(Math.floor(minute / 60), minute % 60, 1_000));
    }
    bars.push(at(15, 30, 0)); // the artifact: zero volume, stamped at the close
    persistCandles(bars);

    const snapshot = snapshotFromStore("NSE", "5m", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    expect(snapshot.outOfSessionWithheld).toBe(1);
    expect(snapshot.dataset[ticker].length).toBe(bars.length - 1);
    // Auditable: the store keeps the observation the provider made.
    expect(getDb().select().from(schema.priceCandles).all().length).toBe(bars.length);
  });
});
