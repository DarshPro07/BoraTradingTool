/**
 * Dependence-aware inference on a series of decision-unit returns.
 *
 * ## Why the naive number is wrong
 *
 * A trade-level t-statistic treats trades as independent draws. They are not: a cross-sectional
 * strategy takes many stock-positions from ONE ranking decision, so those positions share a
 * decision, a date and a market factor. Counting them separately inflates the sample and shrinks
 * the standard error, which is how 589 trades were once reported where there had been 67
 * experiments (`docs/plans/rehearsal-funnel/05-gross-vs-cost.md`).
 *
 * The remedy is to aggregate to the decision unit first — one observation per rebalance — and then
 * correct what remains for serial dependence with a Newey-West HAC estimator.
 */

/** Bartlett kernel lag, by the usual T^(1/3) rule. At least 1, so adjacent dependence is seen. */
export function bartlettLag(n: number): number {
  return Math.max(1, Math.floor(Math.pow(n, 1 / 3)));
}

export interface HacResult {
  n: number;
  mean: number;
  /** Newey-West standard error of the mean. */
  standardError: number;
  tStatistic: number;
  lag: number;
  ci95: [number, number];
}

/**
 * Mean, HAC standard error and t-statistic of a decision-unit return series.
 *
 * Returns a zero-t result rather than throwing on a degenerate series: a probe with two rebalances
 * has no inference to report, and `NaN` propagating into a comparison would read as "not
 * significant" for the wrong reason.
 */
export function hacMean(series: readonly number[]): HacResult {
  const n = series.length;
  if (n < 3) {
    return { n, mean: n ? series.reduce((a, b) => a + b, 0) / n : 0, standardError: 0, tStatistic: 0, lag: 0, ci95: [0, 0] };
  }

  const mean = series.reduce((a, b) => a + b, 0) / n;
  const dev = series.map((x) => x - mean);
  const lag = bartlettLag(n);

  // gamma_0 plus Bartlett-weighted autocovariances.
  let variance = dev.reduce((sum, d) => sum + d * d, 0) / n;
  for (let k = 1; k <= lag; k += 1) {
    let cov = 0;
    for (let i = k; i < n; i += 1) cov += dev[i]! * dev[i - k]!;
    cov /= n;
    variance += 2 * (1 - k / (lag + 1)) * cov;
  }
  // A Bartlett kernel guarantees non-negativity in theory; floating point can still land slightly
  // below zero on a tiny sample, and a negative variance must not become a NaN standard error.
  const standardError = Math.sqrt(Math.max(variance, 0) / n);
  const tStatistic = standardError === 0 ? 0 : mean / standardError;

  return {
    n,
    mean,
    standardError,
    tStatistic,
    lag,
    ci95: [mean - 1.96 * standardError, mean + 1.96 * standardError],
  };
}

/**
 * Stationary block bootstrap: P(mean > 0) without assuming normality.
 *
 * Blocks rather than individual draws, so serial dependence survives resampling. Deterministic by
 * seed — a probability that changes between runs is not evidence.
 */
export function blockBootstrapPositive(
  series: readonly number[],
  { blockSize = 5, draws = 4_000, seed = 20260817 } = {},
): number {
  const n = series.length;
  if (n < 3) return 0.5;

  let state = seed >>> 0;
  const next = () => {
    // xorshift32 — small, deterministic, and adequate for resampling indices.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };

  let positive = 0;
  for (let d = 0; d < draws; d += 1) {
    let total = 0;
    let taken = 0;
    while (taken < n) {
      const start = Math.floor(next() * n);
      for (let b = 0; b < blockSize && taken < n; b += 1) {
        total += series[(start + b) % n]!;
        taken += 1;
      }
    }
    if (total / n > 0) positive += 1;
  }
  return positive / draws;
}

/** Gross profit over gross loss. Infinite when nothing lost — reported, not silently capped. */
export function profitFactor(series: readonly number[]): number {
  let gain = 0;
  let loss = 0;
  for (const x of series) {
    if (x > 0) gain += x;
    else loss -= x;
  }
  return loss === 0 ? (gain > 0 ? Infinity : 0) : gain / loss;
}
