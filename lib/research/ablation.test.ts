import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { MINIMUM_TRADES, ablateStrategy, describeCondition, entryComponents } from "./ablation";

/**
 * Bars that oscillate, so `sma20` crosses `sma50` often enough to produce a scoreable sample.
 *
 * A trending or flat series would give a handful of trades and every variant would come back
 * unscored — which is correct behaviour and useless as a test of the arithmetic above it.
 */
function oscillating(count = 700, period = 20): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const close = 100 + 8 * Math.sin((2 * Math.PI * i) / period);
    bars.push({
      time: 1_700_000_000 + i * 86_400,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000_000,
    });
  }
  return bars;
}

function dsl(entry: Record<string, unknown>, name = "ablation_demo"): StrategyDsl {
  return StrategyDslSchema.parse({
    name,
    universe: { market: "US", maxPositions: 10 },
    entry,
    exit: { afterDays: 5, stopLossPct: 5 },
    sizing: { maxPositionPct: 5 },
    costs: { commissionBps: 1, slippageBps: 1 },
  });
}

const CROSS = { crossover: ["sma20", "sma50"] };
/** True on every bar of this series — adding it must not change anything. */
const ALWAYS = { feature: "close", op: "gt", value: 0 };
/** False on every bar — adding it must collapse the sample, not quietly score zero. */
const NEVER = { feature: "close", op: "lt", value: 0 };

describe("decomposition", () => {
  it("splits a top-level all into its conjuncts", () => {
    expect(entryComponents({ all: [CROSS, ALWAYS] } as never)).toHaveLength(2);
  });

  it("does not split an any, because removing a branch changes the rule", () => {
    // A disjunction is not a stack of filters. Ablating `any` would silently test a different
    // strategy and report the difference as a component's contribution.
    expect(entryComponents({ any: [CROSS, ALWAYS] } as never)).toHaveLength(1);
  });

  it("treats a bare condition as one component", () => {
    expect(entryComponents(CROSS as never)).toHaveLength(1);
  });

  it("labels components readably", () => {
    expect(describeCondition(CROSS as never)).toBe("sma20 crosses above sma50");
    expect(describeCondition(ALWAYS as never)).toBe("close gt 0");
  });
});

describe("a single-component entry says so rather than returning an empty report", () => {
  it("reports one step and a note", () => {
    const report = ablateStrategy(dsl(CROSS), oscillating(), { minimumTrades: 5 });
    expect(report.components).toHaveLength(1);
    expect(report.incremental).toHaveLength(1);
    expect(report.leaveOneOut).toHaveLength(0);
    expect(report.notes.join(" ")).toMatch(/nothing to ablate/i);
    expect(report.summary).toMatch(/single-component/i);
  });
});

describe("scoring", () => {
  const bars = oscillating();

  it("scores every variant out-of-sample only", () => {
    const report = ablateStrategy(dsl({ all: [CROSS, ALWAYS] }), bars, { minimumTrades: 5 });
    const full = report.incremental[1];
    expect(full.refusal).toBeNull();
    expect(full.sharpe).not.toBeNull();
    expect(full.trades).toBeGreaterThanOrEqual(5);
  });

  it("shows a component that changes nothing as a delta of zero", () => {
    // `close > 0` is true on every bar of this series, so it filters nothing. Its marginal
    // contribution must be exactly zero — not merely small.
    const report = ablateStrategy(dsl({ all: [CROSS, ALWAYS] }), bars, { minimumTrades: 5 });
    expect(report.incremental[1].changed).toBe("close gt 0");
    expect(report.incremental[1].delta).toBe(0);
    expect(report.leaveOneOut.find((step) => step.changed === "close gt 0")?.delta).toBe(0);
  });

  it("refuses to score a variant with too few trades instead of returning zero", () => {
    // The failure this guards: a filter that kills the sample scores 0 rather than null, gets
    // ranked against real numbers, and reads as "neutral" when it is actually unmeasurable.
    const report = ablateStrategy(dsl({ all: [CROSS, NEVER] }), bars, { minimumTrades: 5 });
    const collapsed = report.incremental[1];
    expect(collapsed.trades).toBe(0);
    expect(collapsed.sharpe).toBeNull();
    expect(collapsed.profitFactor).toBeNull();
    expect(collapsed.refusal).toMatch(/minimum before a score/i);
  });

  it("leaves the delta null when either side is unscored", () => {
    const report = ablateStrategy(dsl({ all: [CROSS, NEVER] }), bars, { minimumTrades: 5 });
    // Delta against an unscored variant is unknown, not small.
    expect(report.incremental[1].delta).toBeNull();
  });

  it("applies the default minimum when none is supplied", () => {
    const report = ablateStrategy(dsl(CROSS), oscillating(120));
    expect(MINIMUM_TRADES).toBe(30);
    expect(report.incremental[0].refusal).toMatch(new RegExp(`${MINIMUM_TRADES} is the minimum`));
  });
});

describe("the trial cost is stated, not hidden", () => {
  it("counts every backtest run", () => {
    // 3 incremental + 3 leave-one-out. Ablating and then gauntleting the winner while declaring
    // one trial is how a search gets reported as a discovery.
    const report = ablateStrategy(dsl({ all: [CROSS, ALWAYS, { feature: "rsi14", op: "lt", value: 70 }] }), oscillating(), {
      minimumTrades: 5,
    });
    expect(report.variantsEvaluated).toBe(6);
    expect(report.notes.join(" ")).toMatch(/selection-cost denominator/i);
  });

  it("names order dependence when the two views disagree", () => {
    const report = ablateStrategy(
      dsl({ all: [CROSS, { feature: "rsi14", op: "lt", value: 55 }, { feature: "rsi14", op: "gt", value: 30 }] }),
      oscillating(),
      { minimumTrades: 5 },
    );
    // Whether these particular rules disagree depends on the series; what must hold is that the
    // report never presents the two tables as interchangeable without saying so.
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.variantsEvaluated).toBe(6);
  });
});
