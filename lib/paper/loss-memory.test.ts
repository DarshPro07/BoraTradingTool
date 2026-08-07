import { describe, expect, it } from "vitest";
import { closedTrades, lossLedger, PATTERN_THRESHOLD, reconciles, riskPosture, type LossLedger } from "./loss-memory";

/**
 * The requirement in the owner's words: *"whenever it loses, it should adjust itself and add in
 * memory that I lost this and I should do this for this."*
 *
 * The load-bearing assertion in this file is that adaptation only ever **tightens**. A system
 * that can widen its own ceilings after a bad run can trade its way out of a drawdown, which is
 * the mechanism that turns a small loss into a large one.
 */

function ledger(overrides: Partial<LossLedger> = {}): LossLedger {
  return {
    trades: [],
    losses: [],
    byCause: [],
    netRealised: 0,
    grossLoss: 0,
    worst: null,
    realisedToday: 0,
    currency: "INR",
    ...overrides,
  };
}

function cause(name: string, count: number, total: number) {
  return { cause: name, count, total, lastAt: new Date("2026-08-06T00:00:00Z"), isPattern: count >= PATTERN_THRESHOLD };
}

describe("adaptation only tightens", () => {
  it("leaves the owner's ceiling alone when nothing has been lost", () => {
    const posture = riskPosture(ledger(), 100_000, 5, 2);
    expect(posture.positionPct).toBe(5);
    expect(posture.dailyStopPct).toBe(2);
    expect(posture.tightened).toBe(false);
  });

  it("never widens a ceiling after a profitable run", () => {
    // The dangerous direction. A profitable record must not buy a bigger position size.
    const posture = riskPosture(ledger({ netRealised: 50_000 }), 100_000, 5, 2);
    expect(posture.positionPct).toBeLessThanOrEqual(5);
    expect(posture.dailyStopPct).toBeLessThanOrEqual(2);
    expect(posture.drawdown).toBe(0);
  });

  it("tightens in bands as realised drawdown grows", () => {
    const light = riskPosture(ledger({ netRealised: -2_500 }), 100_000, 5, 2); // 2.5%
    const heavy = riskPosture(ledger({ netRealised: -12_000 }), 100_000, 5, 2); // 12%
    expect(light.positionPct).toBeLessThan(5);
    expect(heavy.positionPct).toBeLessThan(light.positionPct);
    expect(heavy.reasons.join(" ")).toMatch(/10%/);
  });

  it("does not move for a drawdown below the first band", () => {
    // Bands rather than a continuous function, so it is always possible to say which rule was
    // in force when a decision was taken.
    const posture = riskPosture(ledger({ netRealised: -1_000 }), 100_000, 5, 2); // 1%
    expect(posture.positionPct).toBe(5);
    expect(posture.tightened).toBe(false);
  });

  it("tightens on a repeated cause even when the money lost is small", () => {
    // Losing the same way four times is a defect, not variance. Size alone would miss it.
    const posture = riskPosture(
      ledger({ netRealised: -50, byCause: [cause("stop_loss on gap-down", 4, -50)] }),
      100_000,
      5,
      2,
    );
    expect(posture.tightened).toBe(true);
    expect(posture.reasons.join(" ")).toMatch(/repeated/);
  });

  it("compounds a repeated cause with a drawdown band", () => {
    const bandOnly = riskPosture(ledger({ netRealised: -6_000 }), 100_000, 5, 2);
    const both = riskPosture(
      ledger({ netRealised: -6_000, byCause: [cause("gap-down", 3, -6_000)] }),
      100_000,
      5,
      2,
    );
    expect(both.positionPct).toBeLessThan(bandOnly.positionPct);
  });

  it("ignores unrealised movement — a ceiling that moves with the market is not a ceiling", () => {
    // netRealised is the only input. There is deliberately no unrealised term.
    const posture = riskPosture(ledger({ netRealised: 0, grossLoss: -80_000 }), 100_000, 5, 2);
    expect(posture.tightened).toBe(false);
  });

  it("does not divide by zero on an account with no starting cash", () => {
    const posture = riskPosture(ledger({ netRealised: -500 }), 0, 5, 2);
    expect(Number.isFinite(posture.drawdown)).toBe(true);
    expect(posture.positionPct).toBe(5);
  });

  it("states why it tightened, never tightening silently", () => {
    const posture = riskPosture(ledger({ netRealised: -12_000 }), 100_000, 5, 2);
    expect(posture.reasons.length).toBeGreaterThan(0);
    expect(posture.tightened).toBe(true);
  });
});

describe("reading the ledger from real orders", () => {
  it("reconstructs without inventing trades", () => {
    const trades = closedTrades();
    expect(Array.isArray(trades)).toBe(true);
    for (const trade of trades) {
      expect(trade.quantity).toBeGreaterThan(0);
      expect(Number.isFinite(trade.realised)).toBe(true);
      // Net of fees, so a "small loss" that is entirely commission is visible as one.
      expect(trade.fees).toBeGreaterThanOrEqual(0);
    }
  });

  it("agrees with the position rows the paper engine wrote", () => {
    // Two views of the same money that disagree are worse than one being wrong, because you
    // cannot tell which to believe.
    expect(reconciles().ok).toBe(true);
  });

  it("summarises without contradicting itself", () => {
    const summary = lossLedger();
    expect(summary.losses.every((trade) => trade.realised < 0)).toBe(true);
    expect(summary.grossLoss).toBeLessThanOrEqual(0);
    expect(summary.byCause.reduce((sum, entry) => sum + entry.count, 0)).toBe(summary.losses.length);
    if (summary.worst) {
      expect(summary.worst.realised).toBeLessThanOrEqual(
        Math.min(...summary.losses.map((trade) => trade.realised)),
      );
    }
  });

  it("orders causes by damage done, not by how often they occurred", () => {
    const { byCause } = lossLedger();
    const totals = byCause.map((entry) => entry.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });
});
