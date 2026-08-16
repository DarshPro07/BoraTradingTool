import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { MIN_UNIVERSE, runCrossSectionalBacktest, type CrossSectionalStrategy } from "./cross-sectional";

/**
 * `fam_qc001_xsec_momentum` was the one declared family the engine could not express. Its
 * mechanism — "rank the eligible universe by lookback return, hold the top N, rotate on a fixed
 * cadence" — is a statement about a symbol's position RELATIVE to every other symbol at the same
 * instant, and the DSL's conditions are per-instrument booleans. No feature fixes that.
 *
 * The property these tests exist for is the one that makes ranking dangerous: a rank computed on a
 * close must never be tradable at that close, and the lookback window must never touch a bar that
 * had not printed. A lookahead here does not fail — it produces a superb equity curve.
 */

const DAY = 86_400;
const T0 = 1_700_000_000;

function series(closes: readonly number[]): Candle[] {
  return closes.map((close, index) => ({
    time: T0 + index * DAY,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1_000,
  }));
}

/** `count` instruments, each drifting at its own constant rate. */
function universe(count: number, length = 60): Record<string, Candle[]> {
  const dataset: Record<string, Candle[]> = {};
  for (let i = 0; i < count; i += 1) {
    const drift = 1 + (i - count / 2) * 0.002;
    const closes = Array.from({ length }, (_unused, day) => 100 * drift ** day);
    dataset[`IN:XNSE:S${String(i).padStart(2, "0")}`] = series(closes);
  }
  return dataset;
}

const base: CrossSectionalStrategy = {
  name: "xsec_probe",
  universe: { market: "NSE", resolution: "D" },
  lookbackDays: 20,
  skipRecentDays: 2,
  ranking: "RAW_RETURN",
  direction: "TOP",
  topN: 5,
  rebalanceDays: 5,
  sizing: { maxPositionPct: 10 },
  costs: { commissionBps: 5, slippageBps: 10 },
};

describe("ranking a universe", () => {
  it("holds exactly the declared number of names per rotation", () => {
    const result = runCrossSectionalBacktest(base, universe(20));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rebalances).toBeGreaterThan(0);
    // Every rotation opened topN positions, so trades divide evenly by the portfolio size.
    expect(result.trades.length % base.topN).toBe(0);
    expect(result.underfilledRebalances).toBe(0);
  });

  it("selects the strongest names when direction is TOP", () => {
    // The universe drifts monotonically by index, so the best performers are the highest indices.
    const result = runCrossSectionalBacktest(base, universe(20));
    if (!result.ok) throw new Error("expected a run");
    const firstRotation = result.trades.filter((t) => t.entryTime === result.trades[0].entryTime);
    for (const trade of firstRotation) {
      const index = Number(trade.instrumentId.slice(-2));
      expect(index, "the top 5 of a monotone universe are its last 5").toBeGreaterThanOrEqual(15);
    }
  });

  it("selects the weakest names when direction is BOTTOM", () => {
    const result = runCrossSectionalBacktest({ ...base, direction: "BOTTOM" }, universe(20));
    if (!result.ok) throw new Error("expected a run");
    const first = result.trades.filter((t) => t.entryTime === result.trades[0].entryTime);
    for (const trade of first) {
      expect(Number(trade.instrumentId.slice(-2))).toBeLessThan(5);
    }
  });
});

describe("point-in-time discipline", () => {
  it("fills at the NEXT bar's open, never the close the rank was computed on", () => {
    const dataset = universe(15);
    const result = runCrossSectionalBacktest(base, dataset);
    if (!result.ok) throw new Error("expected a run");

    for (const trade of result.trades.slice(0, 10)) {
      const bars = dataset[trade.instrumentId];
      const entry = bars.find((bar) => bar.time === trade.entryTime)!;
      expect(trade.entryPrice).toBe(entry.open);
    }
  });

  it("cannot see the future: appending later bars does not change earlier trades", () => {
    // The decisive lookahead test. If any part of the ranking read ahead, extending the series
    // would rewrite decisions that had already been made.
    const short = universe(15, 45);
    const long = universe(15, 60);

    const a = runCrossSectionalBacktest(base, short);
    const b = runCrossSectionalBacktest(base, long);
    if (!a.ok || !b.ok) throw new Error("expected runs");

    const key = (t: { instrumentId: string; entryTime: number; entryPrice: number }) =>
      `${t.instrumentId}@${t.entryTime}:${t.entryPrice.toFixed(6)}`;
    const lastShortBar = short[Object.keys(short)[0]].at(-1)!.time;
    const early = a.trades.filter((t) => t.exitTime <= lastShortBar - DAY);
    for (const trade of early) {
      expect(b.trades.map(key), `${key(trade)} changed when later bars were appended`).toContain(
        key(trade),
      );
    }
    expect(early.length).toBeGreaterThan(0);
  });

  it("skips the most recent days, as the family declares", () => {
    // A name that spikes inside the skipped window must NOT be selected on that spike: skip_recent
    // exists precisely so short-term reversal cannot contaminate a momentum rank.
    const dataset = universe(15);
    const victim = "IN:XNSE:S00"; // the weakest drifter
    const bars = dataset[victim];
    for (let i = bars.length - 2; i < bars.length; i += 1) {
      bars[i] = { ...bars[i], close: bars[i].close * 5, open: bars[i].open * 5 };
    }
    const result = runCrossSectionalBacktest(base, dataset);
    if (!result.ok) throw new Error("expected a run");
    const lastEntry = result.trades.at(-1)!.entryTime;
    const last = result.trades.filter((t) => t.entryTime === lastEntry);
    expect(last.map((t) => t.instrumentId)).not.toContain(victim);
  });
});

describe("refusing what it cannot rank", () => {
  it("refuses a universe too thin to be a cross-section", () => {
    const result = runCrossSectionalBacktest(base, universe(MIN_UNIVERSE - 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_BARS");
    expect(result.message).toMatch(/measures the handful/i);
  });

  it("refuses out-of-order bars rather than re-sorting a provider defect", () => {
    const dataset = universe(15);
    const bars = dataset["IN:XNSE:S05"];
    [bars[10], bars[11]] = [bars[11], bars[10]];
    const result = runCrossSectionalBacktest(base, dataset);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNORDERED_BARS");
  });

  it("reports a rotation that could not be filled to the declared width", () => {
    // A "top 10" that was really a top 3 is a different strategy, so thinness is stated.
    const result = runCrossSectionalBacktest({ ...base, topN: 14 }, universe(12));
    if (!result.ok) throw new Error("expected a run");
    expect(result.underfilledRebalances).toBeGreaterThan(0);
  });
});

describe("volatility-scaled ranking", () => {
  it("is a different ordering from raw return — which is why the contract offers both", () => {
    const dataset = universe(20);
    // Give one strong name violent noise: raw return still likes it, vol-scaled should not.
    const noisy = dataset["IN:XNSE:S19"];
    for (let i = 0; i < noisy.length; i += 1) {
      const shock = i % 2 === 0 ? 1.25 : 0.8;
      noisy[i] = { ...noisy[i], close: noisy[i].close * shock, open: noisy[i].open * shock };
    }
    const raw = runCrossSectionalBacktest(base, dataset);
    const scaled = runCrossSectionalBacktest({ ...base, ranking: "VOL_SCALED_RETURN" }, dataset);
    if (!raw.ok || !scaled.ok) throw new Error("expected runs");

    const firstOf = (r: typeof raw) =>
      r.trades
        .filter((t) => t.entryTime === r.trades[0].entryTime)
        .map((t) => t.instrumentId)
        .sort();
    expect(firstOf(raw)).not.toEqual(firstOf(scaled));
  });
});
