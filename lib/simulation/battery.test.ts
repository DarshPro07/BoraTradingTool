import { describe, expect, it } from "vitest";
import {
  blockBootstrapSimulation,
  costStressSimulation,
  lag1Autocorrelation,
  monteCarloSimulation,
  permutationSimulation,
  runSimulationBattery,
  walkForwardSimulation,
} from "./battery";

/** A steady edge: four wins to one loss, comfortably positive. */
function edged(count = 60): number[] {
  return Array.from({ length: count }, (_, index) => (index % 5 === 0 ? -0.01 : 0.014));
}

/**
 * The same edge as `edged`, but with every magnitude distinct.
 *
 * A two-valued series makes profit factor discrete — it can only be 1.4 × wins/losses — so its
 * 5th percentile lands on the same rung for any seed, and a seed-sensitivity assertion against
 * it fails for a reason that has nothing to do with the seed.
 */
function varied(count = 60): number[] {
  return Array.from({ length: count }, (_, index) =>
    index % 5 === 0 ? -0.01 - index * 1e-5 : 0.014 + index * 1e-5,
  );
}

/** Symmetric noise with no edge at all. */
function noise(count = 60): number[] {
  return Array.from({ length: count }, (_, index) => (index % 2 === 0 ? 0.01 : -0.01));
}

/** Flat for most of the record, then one exceptional stretch carries everything. */
function oneLuckyStretch(count = 60): number[] {
  return Array.from({ length: count }, (_, index) => (index >= count - 12 ? 0.05 : -0.001));
}

describe("determinism", () => {
  it("returns identical results for the same seed", () => {
    expect(runSimulationBattery(edged())).toEqual(runSimulationBattery(edged()));
  });

  it("is sensitive to the seed, so the seed is genuinely doing work", () => {
    const a = blockBootstrapSimulation(varied(), 500, 1).metrics;
    const b = blockBootstrapSimulation(varied(), 500, 2).metrics;
    // Either quantile moving is enough. Pinning one exact order statistic is what made this
    // brittle in the first place.
    expect([a.p05ProfitFactor, a.medianProfitFactor]).not.toEqual([
      b.p05ProfitFactor,
      b.medianProfitFactor,
    ]);
  });
});

describe("sample adequacy", () => {
  it("refuses every simulation below the minimum trade count", () => {
    const report = runSimulationBattery(edged(12));
    expect(report.verdict).toBe("inconclusive");
    expect(report.results.every((result) => result.verdict === "inconclusive")).toBe(true);
  });

  it("says how many trades it needed rather than just failing", () => {
    const [first] = runSimulationBattery(edged(12)).results;
    expect(first.metrics.required).toBe(30);
    expect(first.reason).toMatch(/below the 30/);
  });
});

describe("walk-forward slices calendar when it can, and says which it did", () => {
  const DAY = 86_400;
  const START = 1_760_000_000;

  it("slices by trade count when no timestamps are supplied, and labels it", () => {
    const result = walkForwardSimulation(edged(60), 5);
    expect(result.metrics.slicedByTime).toBe(0);
    expect(result.reason).toMatch(/equal-count slice/);
  });

  it("slices by calendar when timestamps are supplied", () => {
    const times = Array.from({ length: 60 }, (_, index) => START + index * DAY);
    const result = walkForwardSimulation(edged(60), 5, times);
    expect(result.metrics.slicedByTime).toBe(1);
    expect(result.reason).toMatch(/time slice/);
  });

  it("does not let a burst of trading in one month stand in for the whole period", () => {
    // 50 trades in the first fortnight, 10 spread across the following year. Slicing by count
    // puts four of five slices inside the fortnight; slicing by calendar does not.
    const times = Array.from({ length: 60 }, (_, index) =>
      index < 50 ? START + index * 3600 : START + (index - 49) * 30 * DAY,
    );
    const byCount = walkForwardSimulation(edged(60), 5);
    const byTime = walkForwardSimulation(edged(60), 5, times);
    expect(byCount.metrics.slicedByTime).toBe(0);
    expect(byTime.metrics.slicedByTime).toBe(1);
    // The two are answering different questions, so their fold counts need not agree.
    expect(byTime.metrics.folds).toBeGreaterThanOrEqual(2);
  });

  it("ignores a timestamp array that does not line up with the returns", () => {
    // A misaligned array would attach each return to the wrong instant. Refusing to use it is
    // safer than silently pairing them by position.
    const result = walkForwardSimulation(edged(60), 5, [START, START + DAY]);
    expect(result.metrics.slicedByTime).toBe(0);
  });

  it("falls back to counting when every trade shares one instant", () => {
    const times = Array.from({ length: 60 }, () => START);
    expect(walkForwardSimulation(edged(60), 5, times).metrics.slicedByTime).toBe(0);
  });

  it("never reports more profitable folds than folds evaluated", () => {
    const times = Array.from({ length: 60 }, (_, index) => START + index * DAY);
    const result = walkForwardSimulation(edged(60), 5, times);
    expect(result.metrics.profitableFolds).toBeLessThanOrEqual(result.metrics.folds);
    expect(result.metrics.profitableShare).toBeLessThanOrEqual(1);
  });
});

describe("monte carlo", () => {
  it("passes a steady edge", () => {
    expect(monteCarloSimulation(edged()).verdict).toBe("pass");
  });

  it("fails a series that loses money", () => {
    expect(monteCarloSimulation(Array.from({ length: 60 }, () => -0.005)).verdict).toBe("fail");
  });
});

describe("block bootstrap", () => {
  it("passes a steady edge and reports the block length it used", () => {
    const result = blockBootstrapSimulation(edged());
    expect(result.verdict).toBe("pass");
    // Mean block is the cube root of the sample: 60^(1/3) ≈ 3.9 → 4.
    expect(result.metrics.meanBlockLength).toBe(4);
  });

  it("reports the autocorrelation that justifies using it", () => {
    // The alternating series is strongly negatively autocorrelated — exactly the structure an
    // IID resample would erase.
    const result = blockBootstrapSimulation(noise());
    expect(result.metrics.lag1Autocorrelation).toBeLessThan(-0.5);
  });

  it("agrees with the measured autocorrelation of a known series", () => {
    expect(lag1Autocorrelation([1, -1, 1, -1, 1, -1, 1, -1])).toBeLessThan(-0.8);
    expect(lag1Autocorrelation([1, 1, 1, 1])).toBe(0); // no variance, no correlation
  });
});

describe("walk forward", () => {
  it("passes an edge spread evenly across the period", () => {
    const result = walkForwardSimulation(edged());
    expect(result.verdict).toBe("pass");
    expect(result.metrics.profitableFolds).toBe(result.metrics.folds);
  });

  it("fails when a single stretch carries the whole record", () => {
    const result = walkForwardSimulation(oneLuckyStretch());
    expect(result.verdict).toBe("fail");
    expect(result.metrics.profitableShare).toBeLessThan(0.6);
  });
});

describe("permutation", () => {
  it("passes an edge that the symmetric-noise null cannot reach", () => {
    const result = permutationSimulation(edged());
    expect(result.verdict).toBe("pass");
    expect(result.metrics.pValue).toBeLessThan(0.05);
  });

  it("fails symmetric noise", () => {
    const result = permutationSimulation(noise());
    expect(result.verdict).toBe("fail");
  });

  it("declines to test a negative mean rather than reporting a p-value for it", () => {
    const result = permutationSimulation(Array.from({ length: 60 }, () => -0.002));
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/no positive edge/);
  });
});

describe("cost stress", () => {
  it("passes an edge with room above its costs", () => {
    expect(costStressSimulation(edged(), 0.001).verdict).toBe("pass");
  });

  it("fails an edge thinner than the cost assumption", () => {
    const thin = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 0.0022 : -0.0012));
    expect(costStressSimulation(thin, 0.002).verdict).toBe("fail");
  });

  it("records a profit factor at every multiple it charged", () => {
    const result = costStressSimulation(edged(), 0.001, [1, 2, 3]);
    expect(result.metrics.profitFactorAt1x).toBeGreaterThan(result.metrics.profitFactorAt2x);
    expect(result.metrics.profitFactorAt2x).toBeGreaterThan(result.metrics.profitFactorAt3x);
  });
});

describe("battery verdict", () => {
  it("passes only when every simulation passes", () => {
    const report = runSimulationBattery(edged());
    expect(report.verdict).toBe("pass");
    expect(report.results).toHaveLength(5);
    expect(report.summary).toMatch(/not a conclusion/);
  });

  it("fails the whole battery when one simulation fails", () => {
    const report = runSimulationBattery(oneLuckyStretch());
    expect(report.verdict).toBe("fail");
    expect(report.summary).toMatch(/walk_forward/);
  });

  it("never reports a pass for pure noise", () => {
    expect(runSimulationBattery(noise()).verdict).toBe("fail");
  });
});
