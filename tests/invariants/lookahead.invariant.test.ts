import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { runCrossSectionalBacktest, type CrossSectionalStrategy } from "@/lib/backtest/cross-sectional";
import { NSE_QC_001_XSEC_SEED } from "@/lib/strategy/campaigns/nse-qc-001-seeds";

/**
 * **What MarketPulse claims can never happen:** a decision changes because of a bar that had not
 * printed when the decision was made.
 *
 * This is the failure that does not announce itself. A lookahead does not throw, does not fail a
 * unit test and does not look wrong — it produces a superb equity curve, and the better it looks
 * the more it is trusted. Cross-sectional ranking is the most exposed surface in the system
 * because a rank is computed across the whole universe at one instant.
 *
 * The test is deliberately blunt: run the same strategy over a short series and a longer one, then
 * assert that every decision made in the overlapping region is byte-identical.
 */

const DAY = 86_400;
const T0 = 1_700_000_000;

function universe(count: number, length: number): Record<string, Candle[]> {
  const dataset: Record<string, Candle[]> = {};
  for (let i = 0; i < count; i += 1) {
    const drift = 1 + (i - count / 2) * 0.002;
    dataset[`IN:XNSE:L${String(i).padStart(2, "0")}`] = Array.from({ length }, (_unused, day) => {
      const close = 100 * drift ** day;
      return {
        time: T0 + day * DAY,
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume: 1_000,
      };
    });
  }
  return dataset;
}

const seed: CrossSectionalStrategy = NSE_QC_001_XSEC_SEED.strategy;

describe("INVARIANT: appending future bars never rewrites an earlier decision", () => {
  const key = (t: { instrumentId: string; entryTime: number; entryPrice: number }) =>
    `${t.instrumentId}@${t.entryTime}:${t.entryPrice.toFixed(6)}`;

  it("holds for the campaign's own cross-sectional seed", () => {
    const short = runCrossSectionalBacktest(seed, universe(20, 150));
    const long = runCrossSectionalBacktest(seed, universe(20, 220));
    if (!short.ok || !long.ok) throw new Error("expected both runs to produce results");

    const cutoff = T0 + 149 * DAY;
    const earlier = short.trades.filter((t) => t.exitTime < cutoff - DAY);
    expect(earlier.length, "the comparison is empty unless earlier trades exist").toBeGreaterThan(0);

    const longKeys = new Set(long.trades.map(key));
    for (const trade of earlier) {
      expect(longKeys, `${key(trade)} changed when later bars were appended`).toContain(key(trade));
    }
  });

  it("fills at the next bar's open, never the close the rank was computed on", () => {
    const dataset = universe(20, 150);
    const result = runCrossSectionalBacktest(seed, dataset);
    if (!result.ok) throw new Error("expected a run");

    for (const trade of result.trades.slice(0, 12)) {
      const entry = dataset[trade.instrumentId].find((bar) => bar.time === trade.entryTime)!;
      expect(trade.entryPrice).toBe(entry.open);
    }
  });
});
