import { describe, expect, it } from "vitest";
import { computeAlphaHealth, type AlphaHealthInputs } from "./alpha-health";

/**
 * Phase D invariants, on the pure computation: every status is reachable, every status states
 * its reason, and the unmeasurable TCA components are named as unmeasured — never guessed.
 */

function base(overrides: Partial<AlphaHealthInputs> = {}): AlphaHealthInputs {
  return {
    historicalMeanNet: 0.004,
    historicalTrades: 73,
    shadowMeanNet: 0.0035,
    shadowResolved: 30,
    shadowDrift: 0.2,
    policyMinSignals: 20,
    paper: {
      meanNetPerTrade: 0.003,
      closedPositions: 12,
      executedIntents: 14,
      rejectedIntents: 3,
      rejectReasons: { INSUFFICIENT_CAPITAL: 3 },
      feeReturnDrag: 0.0004,
      entrySlippageReturn: 0.0008,
    },
    ...overrides,
  };
}

describe("alpha health — statuses are earned, with reasons", () => {
  it("INSUFFICIENT_EVIDENCE below a quarter of the predeclared policy floor", () => {
    const health = computeAlphaHealth(base({ shadowResolved: 3 }));
    expect(health.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(health.reasons[0]).toMatch(/¼ of the predeclared policy/);
  });

  it("HEALTHY when forward tracks the baseline — worded as a sample statement, not a promise", () => {
    const health = computeAlphaHealth(base());
    expect(health.status).toBe("HEALTHY");
    expect(health.reasons[0]).toMatch(/not a promise/);
    expect(health.decay.shadowVsHistorical).toBeCloseTo(0.0035 / 0.004, 10);
  });

  it("DECAYING when shadow keeps under half the historical edge", () => {
    const health = computeAlphaHealth(base({ shadowMeanNet: 0.001 }));
    expect(health.status).toBe("DECAYING");
    expect(health.reasons[0]).toMatch(/less than half of the historical/);
  });

  it("DECAYING when scorecard drift exceeds the policy ceiling", () => {
    const health = computeAlphaHealth(base({ shadowDrift: 0.9 }));
    expect(health.status).toBe("DECAYING");
    expect(health.reasons[0]).toMatch(/drift 0.90/);
  });

  it("EXECUTION_LIMITED when paper loses the edge to measured costs while the signal survives", () => {
    const health = computeAlphaHealth(
      base({
        paper: {
          meanNetPerTrade: 0.001, // < half of shadow's 0.0035
          closedPositions: 10,
          executedIntents: 12,
          rejectedIntents: 2,
          rejectReasons: {},
          feeReturnDrag: 0.0015,
          entrySlippageReturn: 0.0009, // fees+slippage 0.0024 > shadow edge / 2
        },
      }),
    );
    expect(health.status).toBe("EXECUTION_LIMITED");
    expect(health.reasons[0]).toMatch(/the signal survives; the execution does not/);
  });

  it("decay ratios refuse a non-positive baseline instead of fabricating a sign", () => {
    const health = computeAlphaHealth(base({ historicalMeanNet: -0.002 }));
    expect(health.decay.shadowVsHistorical).toBeNull();
  });

  it("the missed-trade cost is labelled ESTIMATED with its method and pinned assumption", () => {
    const health = computeAlphaHealth(base());
    expect(health.tca.estimated.missedTradeCostReturn).toBeCloseTo(3 * 0.0035, 10);
    expect(health.tca.estimated.method).toMatch(/ESTIMATED/);
    expect(health.assumptions.map((entry) => entry.id)).toContain("missed_trade_cost_proxy");
  });

  it("unmeasurable components are named as unmeasured with reasons — impact, timing, capacity, regime", () => {
    const health = computeAlphaHealth(base());
    for (const key of ["marketImpact", "timingCost", "capacity", "regimeStability"]) {
      expect(health.tca.unmeasured[key]).toMatch(/no |not |cannot/);
    }
    // And precisely BECAUSE capacity/regime are unmeasured, those statuses cannot fire today.
    expect(["CAPACITY_LIMITED", "REGIME_BROKEN"]).not.toContain(health.status);
  });
});
