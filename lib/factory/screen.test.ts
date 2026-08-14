import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { expectedMaxSharpe } from "@/lib/strategy/statistics";
import { screenPopulation, type Candidate } from "./screen";
import { useTemporaryDatabase } from "@/lib/db/testing";

// Screening runs backtests, and `runBacktest` emits to the durable event ledger; this
// compute-only suite needs somewhere isolated to write it.
useTemporaryDatabase();

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function walk(seed: number, length = 400): Candle[] {
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
    name: "screen_probe",
    universe: { market: "US", maxPositions: 5 },
    entry: { feature: "close", op: "gt", value: 100 },
    exit: { afterDays: 5, stopLossPct: 4 },
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 2, slippageBps: 3 },
    ...overrides,
  } as StrategyDsl;
}

/** A population that varies one threshold — the classic parameter sweep. */
function population(count: number): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cand_${String(index).padStart(3, "0")}`,
    dsl: dsl({ entry: { feature: "close", op: "gt", value: 90 + index * 0.5 } } as Partial<StrategyDsl>),
  }));
}

const BARS = walk(7);

describe("ranking", () => {
  it("returns survivors as a prefix of the full ranking", () => {
    const report = screenPopulation(population(20), BARS, { keep: 3, minTrades: 1 });
    expect(report.survivors).toHaveLength(3);
    report.survivors.forEach((survivor, index) => {
      expect(survivor.id).toBe(report.scored.filter((s) => s.trades >= 1 && s.profitFactor >= 1)[index].id);
    });
  });

  it("ranks best Sharpe first", () => {
    const report = screenPopulation(population(20), BARS, { minTrades: 1 });
    const sharpes = report.scored.map((entry) => entry.sharpe);
    expect([...sharpes].sort((a, b) => b - a)).toEqual(sharpes);
  });

  it("is deterministic and independent of input order", () => {
    const forward = screenPopulation(population(15), BARS, { minTrades: 1 });
    const reversed = screenPopulation([...population(15)].reverse(), BARS, { minTrades: 1 });
    expect(reversed.scored.map((e) => e.id)).toEqual(forward.scored.map((e) => e.id));
  });

  it("buries candidates that trade too rarely to be judged", () => {
    const report = screenPopulation(population(20), BARS, { keep: 20, minTrades: 10_000 });
    expect(report.survivors).toHaveLength(0);
    expect(report.scored.length).toBeGreaterThan(0);
  });
});

describe("selection cost", () => {
  it("counts every candidate that produced a comparable number", () => {
    const report = screenPopulation(population(40), BARS, { keep: 1, minTrades: 1 });
    expect(report.selectionCost).toBe(report.scored.length);
    expect(report.selectionCost).toBe(40);
  });

  it("excludes refusals, which could not have been selected on", () => {
    const candidates: Candidate[] = [
      ...population(5),
      // market_cap is not derivable from OHLCV, so this one produces no statistic at all.
      { id: "impossible", dsl: dsl({ entry: { feature: "market_cap", op: "gt", value: 1 } } as Partial<StrategyDsl>) },
    ];
    const report = screenPopulation(candidates, BARS, { minTrades: 1 });

    expect(report.refused.map((r) => r.id)).toEqual(["impossible"]);
    expect(report.refused[0].code).toBe("FEATURE_NOT_AVAILABLE");
    expect(report.selectionCost).toBe(5);
  });

  it("raises the bar the winner must clear as the population grows", () => {
    // This is the whole point of carrying selectionCost into the gauntlet. Screening 200
    // candidates and grading the winner as a single trial is the error the Factory would
    // otherwise make silently.
    const small = screenPopulation(population(5), BARS, { minTrades: 1 });
    const large = screenPopulation(population(200), BARS, { minTrades: 1 });

    expect(large.selectionCost).toBeGreaterThan(small.selectionCost);
    expect(expectedMaxSharpe(large.selectionCost)).toBeGreaterThan(expectedMaxSharpe(small.selectionCost));
  });

  it("reports zero cost for an empty population rather than pretending to one trial", () => {
    const report = screenPopulation([], BARS);
    expect(report.selectionCost).toBe(0);
    expect(report.survivors).toEqual([]);
  });
});
