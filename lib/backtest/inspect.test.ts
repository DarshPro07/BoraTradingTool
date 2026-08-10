import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema } from "@/lib/strategy/dsl";
import { inspectTrades } from "./inspect";

/**
 * Trade inspection must answer, for every trade: why it existed, what happened, and where the
 * money went — with arithmetic a reader can check, not summaries they must trust.
 */

const OPEN = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000; // 09:15 IST, Monday
const FIVE = 300;

function session(count = 75, start = 100, step = 0.1): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const price = start + index * step;
    return { time: OPEN + index * FIVE, open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 10_000 };
  });
}

const DSL = StrategyDslSchema.parse({
  name: "inspect_probe",
  universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
  entry: {
    all: [
      { compare: ["close", "opening_range_high"], op: "gt" },
      { feature: "minutes_since_open", op: "gte", value: 15 },
    ],
  },
  exit: { stopLossPct: 5, takeProfitPct: 50 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
});

describe("why the trade existed", () => {
  it("reports each entry clause's verdict against the signal bar, not the fill bar", () => {
    const report = inspectTrades("inspect_probe", DSL, { "IN:XNSE:T": session() });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.trades.length).toBeGreaterThan(0);

    const first = report.trades[0];
    expect(first.clauses.map((clause) => clause.clause)).toEqual([
      "close gt opening_range_high",
      "minutes_since_open gte 15",
    ]);
    // On the bar that signalled, every clause must have passed — that is what "signalled" means.
    for (const clause of first.clauses) expect(clause.passed).toBe(true);
    // And the observed values are real numbers a reader can check against the bars.
    for (const clause of first.clauses) expect(clause.observed).not.toBeNull();
  });
});

describe("what happened", () => {
  it("computes MFE and MAE from the bars actually held", () => {
    const report = inspectTrades("inspect_probe", DSL, { "IN:XNSE:T": session() });
    if (!report.ok) throw new Error(report.message);
    const trade = report.trades[0];
    // Rising ramp: the best excursion is positive and at least the final move; the worst is the
    // entry bar's low, half a point below.
    expect(trade.mfe).not.toBeNull();
    expect(trade.mae).not.toBeNull();
    expect(trade.mfe!).toBeGreaterThan(0);
    expect(trade.mae!).toBeLessThan(0);
    expect(trade.mfe!).toBeGreaterThanOrEqual(trade.grossReturn);
  });

  it("carries the execution assumptions the run was simulated under", () => {
    const report = inspectTrades("inspect_probe", DSL, { "IN:XNSE:T": session() });
    if (!report.ok) throw new Error(report.message);
    expect(report.execution?.broker).toBe("ZERODHA");
    expect(report.execution?.mandatoryExit).toBe("15:25");
  });

  it("shows no exit past the broker deadline — the audit the table exists for", () => {
    const report = inspectTrades("inspect_probe", DSL, { "IN:XNSE:T": session() });
    if (!report.ok) throw new Error(report.message);
    for (const trade of report.trades) {
      const ist = new Date((trade.exitTime + 5.5 * 3600) * 1000);
      const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      expect(minute).toBeLessThanOrEqual(15 * 60 + 25);
    }
  });
});

describe("where the money went", () => {
  it("decomposes fees with arithmetic that adds up, at a stated quantity of one", () => {
    const report = inspectTrades("inspect_probe", DSL, { "IN:XNSE:T": session() });
    if (!report.ok) throw new Error(report.message);
    const { economics } = report.trades[0];
    expect(economics).not.toBeNull();
    if (economics === null) return;

    expect(economics.quantityAssumed).toBe(1);
    // The decomposition must reconcile: statutory + DP = total, and net = gross − total.
    expect(economics.statutoryFees + economics.dpCharge).toBeCloseTo(economics.totalFees, 2);
    expect(economics.netPnl).toBeCloseTo(economics.grossPnl - economics.totalFees, 2);
    // Intraday: no DP charge, by the fee schedule.
    expect(economics.dpCharge).toBe(0);
    expect(economics.feeScheduleId).toMatch(/INTRADAY/);
  });
});

describe("empty and refused inputs stay honest", () => {
  it("refuses an empty dataset with the engine's own code", () => {
    const report = inspectTrades("inspect_probe", DSL, {});
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.code).toBe("INSUFFICIENT_BARS");
  });
});

describe("a trade no fee schedule covers", () => {
  it("abstains on economics instead of crashing the whole report", () => {
    // The owner's dev log, verbatim: POST /api/strategy/trades 500 — CostModelError: No US fee
    // schedule covers US_EXCHANGE_ONLY on 2023-10-25. One 2023 trade must not hide every other
    // trade's evidence, and pricing it at 2026 rates would be a confident wrong number.
    const OLD_OPEN = Date.UTC(2023, 9, 2, 13, 30, 0) / 1000; // pre-2024, US session
    const bars = Array.from({ length: 60 }, (_, index) => {
      const price = 100 + index;
      return { time: OLD_OPEN + index * 86_400, open: price - 0.5, high: price + 1, low: price - 1, close: price, volume: 1_000 };
    });
    const dailyUs = StrategyDslSchema.parse({
      name: "us_probe",
      universe: { market: "US", maxPositions: 4, resolution: "D" },
      entry: { feature: "close", op: "gt", value: 110 },
      exit: { afterDays: 3, stopLossPct: 5 },
      sizing: { maxPositionPct: 25 },
      costs: { commissionBps: 1, slippageBps: 1 },
    });

    const report = inspectTrades("us_probe", dailyUs, { "US:XNAS:T": bars });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.trades.length).toBeGreaterThan(0);
    const trade = report.trades[0];
    expect(trade.economics).toBeNull();
    expect(trade.economicsUnavailable).toMatch(/No US fee schedule covers/);
    // The rest of the evidence survives: clauses, path, excursions.
    expect(trade.clauses.length).toBeGreaterThan(0);
  });
});
