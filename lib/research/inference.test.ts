import { describe, expect, it } from "vitest";
import { bartlettLag, bootstrapSignProbability, hacMean, profitFactor } from "./inference";

/**
 * This module produces **every statistic the Foundry reports** — the HAC t-statistics, the
 * confidence intervals, the bootstrap sign probabilities, the profit factors behind M02's and X01's
 * verdicts. It shipped with no tests, which was noticed only when the session's own code was
 * audited: correct, and completely unguarded.
 *
 * Numbers here are checked against closed forms and against known statistical behaviour, not
 * against a previous run of this same code.
 */

/** Deterministic — a statistic that changes between runs is not evidence. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

/** The classical standard error of the mean, which HAC must reduce to under independence. */
function classicalSE(series: readonly number[]): number {
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(series.reduce((s, x) => s + (x - mean) ** 2, 0) / n / n);
}

describe("bartlettLag", () => {
  it("follows the n^(1/3) rule", () => {
    expect(bartlettLag(27)).toBe(3);
    // Perfect cubes are the values a reader checks by hand, and a bare floor gets them all wrong:
    // Math.pow(216, 1/3) is 5.999999999999999 and Math.pow(1000, 1/3) is 9.999999999999998.
    expect(bartlettLag(216)).toBe(6);
    expect(bartlettLag(1_000)).toBe(10);
    expect(bartlettLag(8_000)).toBe(20);
  });

  it("grows with the sample and never exceeds it", () => {
    let previous = 0;
    for (const n of [10, 100, 1_000, 10_000]) {
      const lag = bartlettLag(n);
      expect(lag).toBeGreaterThanOrEqual(previous);
      expect(lag).toBeLessThan(n);
      previous = lag;
    }
  });

  it("never returns 0, so adjacent dependence is always examined", () => {
    // A zero lag silently turns the HAC estimator back into the naive one.
    expect(bartlettLag(1)).toBeGreaterThanOrEqual(1);
    expect(bartlettLag(2)).toBeGreaterThanOrEqual(1);
  });
});

describe("hacMean", () => {
  it("reports the arithmetic mean unchanged", () => {
    const result = hacMean([1, 2, 3, 4, 5]);
    expect(result.mean).toBeCloseTo(3, 12);
    expect(result.n).toBe(5);
  });

  it("approximates the classical standard error on independent data", () => {
    // Under independence the autocovariance terms average to ~0, so HAC should land close to the
    // classical SE. Far from it in either direction would mean the kernel is wrong.
    const random = rng(12_345);
    const iid = Array.from({ length: 500 }, () => random() - 0.5);
    const hac = hacMean(iid);

    expect(hac.standardError / classicalSE(iid)).toBeGreaterThan(0.75);
    expect(hac.standardError / classicalSE(iid)).toBeLessThan(1.3);
  });

  it("INFLATES the standard error under positive autocorrelation", () => {
    // The entire reason this estimator exists. Overlapping positions and shared decisions make
    // returns positively autocorrelated, and a naive SE would then overstate significance.
    const random = rng(999);
    const ar: number[] = [0];
    for (let i = 1; i < 500; i += 1) ar.push(0.8 * ar[i - 1]! + (random() - 0.5));
    const hac = hacMean(ar);

    expect(hac.standardError).toBeGreaterThan(classicalSE(ar) * 1.5);
    expect(Math.abs(hac.tStatistic)).toBeLessThan(
      Math.abs(hacMean(ar).mean / classicalSE(ar)),
    );
  });

  it("puts the t-statistic and the confidence interval in agreement", () => {
    // A CI that excludes zero while |t| < 1.96 would mean one of the two is computed wrongly, and
    // a reader would believe whichever they looked at first.
    const random = rng(7);
    for (const shift of [0, 0.05, -0.05]) {
      const series = Array.from({ length: 200 }, () => random() - 0.5 + shift);
      const hac = hacMean(series);
      const excludesZero = hac.ci95[0] > 0 || hac.ci95[1] < 0;
      expect(excludesZero).toBe(Math.abs(hac.tStatistic) > 1.96);
    }
  });

  it("returns finite values on degenerate input instead of NaN", () => {
    // NaN compares false against every threshold, so it would silently read as "not significant"
    // for the wrong reason.
    for (const series of [[], [1], [1, 2]]) {
      const hac = hacMean(series);
      expect(Number.isFinite(hac.tStatistic)).toBe(true);
      expect(Number.isFinite(hac.standardError)).toBe(true);
    }
  });

  it("gives a zero standard error, not a NaN, for a constant series", () => {
    const hac = hacMean([0.01, 0.01, 0.01, 0.01, 0.01]);
    expect(hac.mean).toBeCloseTo(0.01, 12);
    expect(hac.standardError).toBe(0);
    expect(hac.tStatistic).toBe(0);
  });
});

describe("bootstrapSignProbability", () => {
  it("is 1 when every observation is positive and 0 when every one is negative", () => {
    expect(bootstrapSignProbability(Array(200).fill(0.01))).toBe(1);
    expect(bootstrapSignProbability(Array(200).fill(-0.01))).toBe(0);
  });

  it("is about a half for a symmetric series", () => {
    const symmetric = Array.from({ length: 400 }, (_unused, i) => (i % 2 === 0 ? 0.01 : -0.01));
    expect(bootstrapSignProbability(symmetric)).toBeGreaterThan(0.35);
    expect(bootstrapSignProbability(symmetric)).toBeLessThan(0.65);
  });

  it("is deterministic for a given seed", () => {
    const random = rng(31);
    const series = Array.from({ length: 300 }, () => random() - 0.45);
    expect(bootstrapSignProbability(series)).toBe(bootstrapSignProbability(series));
  });

  it("is NOT a p-value — it can sit far from 0.5 while HAC does not reject zero", () => {
    // The exact situation X01 produced: bootstrap 97%, HAC CI spanning zero. Naming the quantity
    // `P(mean > 0)` made those look contradictory. They are not — and in fact they agree exactly:
    // a one-sided sign fraction of ~97% IS a t of about 1.7, since 0.97 = Phi(1.88) and X01's HAC t
    // was 1.71. What fails is the inference a reader draws, because 97% sounds like significance
    // and t = 1.7 does not clear a two-sided 5% bar. Same number, two readings, one of them wrong.
    const random = rng(4_242);
    const series = Array.from({ length: 250 }, () => (random() - 0.5) * 0.12 + 0.0045);
    const hac = hacMean(series);
    const sign = bootstrapSignProbability(series);

    expect(sign).toBeGreaterThan(0.9);
    expect(Math.abs(hac.tStatistic), "HAC should not reject zero here").toBeLessThan(1.96);
    expect(hac.ci95[0]).toBeLessThan(0);
  });

  it("declines to guess on a series too short to resample", () => {
    expect(bootstrapSignProbability([0.5, 0.5])).toBe(0.5);
  });
});

describe("profitFactor", () => {
  it("matches its closed form", () => {
    expect(profitFactor([1, -1])).toBe(1);
    expect(profitFactor([2, -1])).toBe(2);
    expect(profitFactor([1, 2, -1])).toBe(3);
  });

  it("reports Infinity rather than capping when nothing was lost", () => {
    // A silently capped value would read as a merely-good result instead of an impossible one,
    // which is the shape of a fixture bug worth seeing.
    expect(profitFactor([1, 1])).toBe(Infinity);
    expect(profitFactor([])).toBe(0);
    expect(profitFactor([-1, -2])).toBe(0);
  });
});
