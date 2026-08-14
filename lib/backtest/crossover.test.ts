import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { compileStrategy, type StrategyDsl } from "@/lib/strategy/dsl";
import { evaluate, runBacktest } from "./engine";
import { buildFeaturePanel } from "./features";
import { useTemporaryDatabase } from "@/lib/db/testing";

// `runBacktest` emits a BACKTEST_COMPLETED event, and the event bus writes it to the durable
// ledger — so this compute-only suite still needs a database to write into. It never used to,
// because the bus swallowed the failure; the isolation guard was firing and being discarded.
useTemporaryDatabase();

function bar(index: number, price: number): Candle {
  return {
    time: 1_700_000_000 + index * 86_400,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1_000_000,
  };
}

/** 40 flat bars at 100, then 20 at `after`: exactly one crossing of close vs SMA20. */
function crossingBars(after: number): Candle[] {
  return [
    ...Array.from({ length: 40 }, (_, index) => bar(index, 100)),
    ...Array.from({ length: 20 }, (_, index) => bar(40 + index, after)),
  ];
}

function dsl(entry: unknown): StrategyDsl {
  const compiled = compileStrategy({
    name: "cross_probe",
    universe: { market: "US", maxPositions: 5 },
    entry,
    exit: { afterDays: 5 },
    sizing: { maxPositionPct: 5 },
    costs: { commissionBps: 1, slippageBps: 1 },
  });
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.dsl;
}

describe("crossover schema", () => {
  it("compiles a crossover between two distinct features", () => {
    expect(() => dsl({ crossover: ["close", "sma20"] })).not.toThrow();
  });

  it("rejects a feature crossing itself", () => {
    const compiled = compileStrategy({
      name: "self_cross",
      universe: { market: "US", maxPositions: 5 },
      entry: { crossover: ["close", "close"] },
      exit: { afterDays: 5 },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 1, slippageBps: 1 },
    });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.code).toBe("SCHEMA_INVALID");
  });
});

describe("crossover event semantics", () => {
  const entry: { crossover: [string, string] } = { crossover: ["close", "sma20"] };

  it("fires only on the crossing bar, not while the state persists", () => {
    const panel = buildFeaturePanel(crossingBars(105));
    // Bar 40 is the first close at 105; SMA20 still trails at 100.25.
    expect(evaluate(entry, panel.at(40), panel.at(39))).toBe(true);
    // One bar later the state (above) persists but the *event* has passed.
    expect(evaluate(entry, panel.at(41), panel.at(40))).toBe(false);
  });

  it("is unknowable without a prior bar", () => {
    const panel = buildFeaturePanel(crossingBars(105));
    expect(evaluate(entry, panel.at(40), undefined)).toBeUndefined();
  });

  it("produces exactly one trade through the backtest engine", () => {
    const result = runBacktest(dsl(entry), crossingBars(105));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryIndex).toBe(41); // decided on bar 40's close, filled next open
    expect(result.trades[0].exitReason).toBe("time_limit");
  });

  it("crossunder mirrors it on the way down", () => {
    const result = runBacktest(dsl({ crossunder: ["close", "sma20"] }), crossingBars(95));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryIndex).toBe(41);
  });
});
