import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { runBacktest } from "./engine";
import { runPortfolioBacktest } from "./portfolio";
import { useTemporaryDatabase } from "@/lib/db/testing";

// `runBacktest` emits to the durable event ledger; this compute-only suite needs somewhere
// isolated to write it.
useTemporaryDatabase();

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function walk(seed: number, length: number): Candle[] {
  const next = lcg(seed);
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < length; i += 1) {
    const open = price;
    const close = Math.max(1, price + (next() - 0.48) * 4);
    bars.push({
      time: 1_700_000_000 + i * 86_400,
      open,
      high: Math.max(open, close) + next() * 2,
      low: Math.max(0.5, Math.min(open, close) - next() * 2),
      close,
      volume: 1_000,
    });
    price = close;
  }
  return bars;
}

function dsl(overrides: Partial<StrategyDsl> = {}): StrategyDsl {
  return {
    name: "portfolio_probe",
    universe: { market: "US", maxPositions: 10 },
    entry: { feature: "close", op: "gt", value: 100 },
    exit: { afterDays: 5, stopLossPct: 4 },
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 2, slippageBps: 3 },
    ...overrides,
  } as StrategyDsl;
}

describe("agreement with the single-instrument engine", () => {
  it("produces identical trades for one instrument with one slot", () => {
    // If the two engines disagree here, every portfolio result is describing different rules
    // from the ones the parity gate validated.
    for (let seed = 1; seed <= 20; seed += 1) {
      const bars = walk(seed, 150);
      const spec = dsl({ universe: { market: "US", maxPositions: 1 } } as Partial<StrategyDsl>);

      const single = runBacktest(spec, bars);
      const portfolio = runPortfolioBacktest(spec, { ONLY: bars });
      expect(single.ok && portfolio.ok).toBe(true);
      if (!single.ok || !portfolio.ok) return;

      expect(portfolio.trades).toHaveLength(single.trades.length);
      portfolio.trades.forEach((trade, index) => {
        expect(trade.entryIndex).toBe(single.trades[index].entryIndex);
        expect(trade.exitIndex).toBe(single.trades[index].exitIndex);
        expect(trade.netReturn).toBeCloseTo(single.trades[index].netReturn, 12);
        expect(trade.exitReason).toBe(single.trades[index].exitReason);
      });
    }
  });

  it("agrees on crossing events, which need the previous bar", () => {
    // Regression: this engine evaluated conditions without the prior bar's features, so a
    // crossover was permanently "unknowable" and the strategy silently never traded here —
    // while the single-instrument engine traded normally. Zero trades is not a disagreement
    // any aggregate metric would flag, so the two engines are compared directly.
    let tradesSeen = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const bars = walk(seed, 150);
      const spec = dsl({
        universe: { market: "US", maxPositions: 1 },
        entry: { crossover: ["close", "sma20"] },
      } as Partial<StrategyDsl>);

      const single = runBacktest(spec, bars);
      const portfolio = runPortfolioBacktest(spec, { ONLY: bars });
      expect(single.ok && portfolio.ok).toBe(true);
      if (!single.ok || !portfolio.ok) return;

      tradesSeen += single.trades.length;
      expect(portfolio.trades).toHaveLength(single.trades.length);
      portfolio.trades.forEach((trade, index) => {
        expect(trade.entryIndex).toBe(single.trades[index].entryIndex);
        expect(trade.exitIndex).toBe(single.trades[index].exitIndex);
        expect(trade.netReturn).toBeCloseTo(single.trades[index].netReturn, 12);
      });
    }
    // Guards the guard: two engines that both trade nothing would agree vacuously.
    expect(tradesSeen).toBeGreaterThan(0);
  });
});

describe("position capacity", () => {
  const dataset = () => ({
    AAA: walk(1, 120),
    BBB: walk(2, 120),
    CCC: walk(3, 120),
    DDD: walk(4, 120),
    EEE: walk(5, 120),
  });

  it("never holds more positions than the cap allows", () => {
    const result = runPortfolioBacktest(dsl({ universe: { market: "US", maxPositions: 2 } } as Partial<StrategyDsl>), dataset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reconstruct concurrency from the trade log: at no point may more than two overlap.
    const events = result.trades
      .flatMap((trade) => [{ at: trade.entryTime, delta: 1 }, { at: trade.exitTime, delta: -1 }])
      .sort((a, b) => a.at - b.at || a.delta - b.delta);
    let concurrent = 0;
    for (const event of events) {
      concurrent += event.delta;
      expect(concurrent).toBeLessThanOrEqual(2);
    }
  });

  it("reports signals it had to drop for want of a slot", () => {
    // Without this count, a capacity-starved strategy silently reports only the trades it
    // happened to fit — which reads as selectivity rather than a capacity ceiling.
    const tight = runPortfolioBacktest(dsl({ universe: { market: "US", maxPositions: 1 } } as Partial<StrategyDsl>), dataset());
    const loose = runPortfolioBacktest(dsl({ universe: { market: "US", maxPositions: 50 } } as Partial<StrategyDsl>), dataset());
    expect(tight.ok && loose.ok).toBe(true);
    if (!tight.ok || !loose.ok) return;

    expect(tight.signalsRejectedForCapacity).toBeGreaterThan(0);
    expect(loose.signalsRejectedForCapacity).toBe(0);
    expect(tight.trades.length).toBeLessThan(loose.trades.length);
  });

  it("reuses a slot freed earlier in the same session", () => {
    const result = runPortfolioBacktest(dsl({ universe: { market: "US", maxPositions: 2 } } as Partial<StrategyDsl>), dataset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades.length).toBeGreaterThan(2);
    expect(result.instrumentsEvaluated).toBe(5);
  });
});

describe("mismatched calendars", () => {
  it("evaluates each instrument only on bars it actually printed", () => {
    // A holiday on one exchange must not make the other instrument's bar stand in for it.
    const full = walk(11, 120);
    const sparse = walk(12, 120).filter((_, index) => index % 3 !== 0);

    const result = runPortfolioBacktest(dsl(), { FULL: full, SPARSE: sparse });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sparseTimes = new Set(sparse.map((bar) => bar.time));
    for (const trade of result.trades.filter((t) => t.instrumentId === "SPARSE")) {
      expect(sparseTimes.has(trade.entryTime)).toBe(true);
      expect(sparseTimes.has(trade.exitTime)).toBe(true);
    }
  });
});

describe("refusals", () => {
  it("refuses an undeliverable feature across the whole universe", () => {
    const result = runPortfolioBacktest(
      dsl({ entry: { feature: "market_cap", op: "gt", value: 1 } } as Partial<StrategyDsl>),
      { AAA: walk(1, 60) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("names the instrument whose bars are out of order", () => {
    const broken = walk(3, 60);
    broken[40].time = broken[39].time;
    const result = runPortfolioBacktest(dsl(), { GOOD: walk(1, 60), BROKEN: broken });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNORDERED_BARS");
    expect(result.message).toMatch(/BROKEN/);
  });

  it("refuses an empty dataset", () => {
    const result = runPortfolioBacktest(dsl(), {});
    expect(result.ok).toBe(false);
  });
});
