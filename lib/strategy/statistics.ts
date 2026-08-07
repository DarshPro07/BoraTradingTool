/**
 * Statistics for multiple-testing control.
 *
 * The central problem in strategy research is that testing many variants guarantees some
 * will look good by luck. A raw Sharpe ratio from the best of N trials is not evidence.
 * These functions correct for that.
 */

const EULER_MASCHERONI = 0.5772156649015329;

/** Abramowitz & Stegun 7.1.26 — sufficient for gate decisions. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absolute);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absolute * absolute);
  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Acklam's inverse normal CDF approximation. */
export function normalInverse(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const low = 0.02425;
  const high = 1 - low;

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function skewness(values: readonly number[]): number {
  const n = values.length;
  const deviation = standardDeviation(values);
  if (n < 3 || deviation === 0) return 0;
  const average = mean(values);
  return values.reduce((total, value) => total + ((value - average) / deviation) ** 3, 0) / n;
}

/** Non-excess kurtosis: 3 for a normal distribution. */
export function kurtosis(values: readonly number[]): number {
  const n = values.length;
  const deviation = standardDeviation(values);
  if (n < 4 || deviation === 0) return 3;
  const average = mean(values);
  return values.reduce((total, value) => total + ((value - average) / deviation) ** 4, 0) / n;
}

export function sharpeRatio(returns: readonly number[]): number {
  const deviation = standardDeviation(returns);
  return deviation === 0 ? 0 : mean(returns) / deviation;
}

export function profitFactor(returns: readonly number[]): number {
  let gains = 0;
  let losses = 0;
  for (const value of returns) {
    if (value > 0) gains += value;
    else losses -= value;
  }
  if (losses === 0) return gains > 0 ? Number.POSITIVE_INFINITY : 0;
  return gains / losses;
}

/**
 * Expected maximum Sharpe ratio under the null hypothesis of no skill, given `trials`
 * independent attempts. This is the bar a candidate must clear — not zero.
 * Bailey & López de Prado (2014), "The Deflated Sharpe Ratio".
 */
export function expectedMaxSharpe(trials: number, sharpeVariance = 1): number {
  const n = Math.max(2, Math.trunc(trials));
  const deviation = Math.sqrt(sharpeVariance);
  return (
    deviation *
    ((1 - EULER_MASCHERONI) * normalInverse(1 - 1 / n) + EULER_MASCHERONI * normalInverse(1 - 1 / (n * Math.E)))
  );
}

export interface DeflatedSharpeInput {
  returns: readonly number[];
  /** Every attempt made, including the ones that failed. Understating this inflates the result. */
  trials: number;
  sharpeVariance?: number;
}

export interface DeflatedSharpeResult {
  sharpe: number;
  threshold: number;
  deflatedSharpe: number;
  observations: number;
  skew: number;
  kurtosis: number;
}

/**
 * Probability that the observed Sharpe exceeds what the best of `trials` random strategies
 * would have produced, adjusted for non-normal returns. Values below ~0.95 are not evidence.
 */
export function deflatedSharpeRatio(input: DeflatedSharpeInput): DeflatedSharpeResult {
  const { returns, trials } = input;
  const n = returns.length;
  const observed = sharpeRatio(returns);
  const threshold = expectedMaxSharpe(trials, input.sharpeVariance ?? 1 / Math.max(1, n - 1));
  const skew = skewness(returns);
  const kurt = kurtosis(returns);

  if (n < 4) {
    return { sharpe: observed, threshold, deflatedSharpe: 0, observations: n, skew, kurtosis: kurt };
  }

  const denominator = Math.sqrt(Math.max(1e-12, 1 - skew * observed + ((kurt - 1) / 4) * observed ** 2));
  const statistic = ((observed - threshold) * Math.sqrt(n - 1)) / denominator;

  return {
    sharpe: observed,
    threshold,
    deflatedSharpe: normalCdf(statistic),
    observations: n,
    skew,
    kurtosis: kurt,
  };
}

/** Deterministic PRNG so every Monte Carlo run is reproducible from its seed. */
export function createRandom(seed: number): () => number {
  let state = (seed || 1) >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export interface MonteCarloResult {
  iterations: number;
  medianProfitFactor: number;
  p05ProfitFactor: number;
  p95ProfitFactor: number;
  probabilityOfLoss: number;
  worstDrawdown: number;
}

/**
 * Bootstrap resampling of the trade sequence. Answers "how much of this result depends on
 * the particular order and selection of trades?".
 */
export function monteCarlo(returns: readonly number[], iterations = 1_000, seed = 42): MonteCarloResult {
  if (returns.length === 0) {
    return {
      iterations: 0,
      medianProfitFactor: 0,
      p05ProfitFactor: 0,
      p95ProfitFactor: 0,
      probabilityOfLoss: 1,
      worstDrawdown: 0,
    };
  }

  const random = createRandom(seed);
  const factors: number[] = [];
  let losingRuns = 0;
  let worstDrawdown = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: number[] = [];
    for (let index = 0; index < returns.length; index += 1) {
      sample.push(returns[Math.floor(random() * returns.length)]);
    }

    const factor = profitFactor(sample);
    factors.push(Number.isFinite(factor) ? factor : 10);

    let equity = 0;
    let peak = 0;
    let drawdown = 0;
    let total = 0;
    for (const value of sample) {
      total += value;
      equity += value;
      peak = Math.max(peak, equity);
      drawdown = Math.min(drawdown, equity - peak);
    }
    if (total < 0) losingRuns += 1;
    worstDrawdown = Math.min(worstDrawdown, drawdown);
  }

  factors.sort((a, b) => a - b);
  const quantile = (q: number) => factors[Math.min(factors.length - 1, Math.floor(q * factors.length))];

  return {
    iterations,
    medianProfitFactor: quantile(0.5),
    p05ProfitFactor: quantile(0.05),
    p95ProfitFactor: quantile(0.95),
    probabilityOfLoss: losingRuns / iterations,
    worstDrawdown,
  };
}

export interface PairedEdgeResult {
  /** Mean of the per-trade differences (strategy − benchmark). */
  edge: number;
  /** Bootstrap probability that resampling the same trades yields no positive edge. */
  pValue: number;
  iterations: number;
}

/**
 * Paired bootstrap on per-trade differences between a strategy and an aligned benchmark.
 *
 * A bare comparison of means passes on any positive difference, however small and however
 * noisy. This asks the sharper question: across resamplings of the same paired trades, how
 * often would the mean edge have been zero or negative? Deterministic given the seed.
 */
export function pairedBootstrapEdge(
  strategy: readonly number[],
  benchmark: readonly number[],
  iterations = 2_000,
  seed = 42,
): PairedEdgeResult {
  if (strategy.length !== benchmark.length) {
    throw new RangeError(
      `Paired test requires aligned series; got ${strategy.length} strategy vs ${benchmark.length} benchmark returns.`,
    );
  }
  const differences = strategy.map((value, index) => value - benchmark[index]);
  if (differences.length === 0) return { edge: 0, pValue: 1, iterations: 0 };

  const random = createRandom(seed);
  let notPositive = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < differences.length; index += 1) {
      total += differences[Math.floor(random() * differences.length)];
    }
    if (total <= 0) notPositive += 1;
  }

  return { edge: mean(differences), pValue: notPositive / iterations, iterations };
}

/** C(12, 6) = 924 partitions; beyond this the combination count grows explosively. */
const MAX_PBO_SLICES = 12;

/**
 * Probability of Backtest Overfitting via combinatorially symmetric cross-validation.
 * Splits performance into S slices, and for every half/half partition asks whether the
 * in-sample best configuration underperforms the median out of sample.
 */
export function probabilityOfBacktestOverfitting(
  performanceByConfig: readonly (readonly number[])[],
  slices = 8,
): number {
  const configs = performanceByConfig.length;
  if (configs < 2) return 0;

  // The slice count is caller-controlled; without a ceiling, a large value materialises a
  // combinatorial number of partitions and stalls the process.
  const usableSlices = Math.min(Math.trunc(slices), MAX_PBO_SLICES, performanceByConfig[0].length);
  if (!Number.isFinite(usableSlices) || usableSlices < 2) return 0;

  const half = Math.floor(usableSlices / 2);
  const indices = Array.from({ length: usableSlices }, (_, index) => index);
  const combinations: number[][] = [];

  const build = (start: number, chosen: number[]): void => {
    if (chosen.length === half) {
      combinations.push([...chosen]);
      return;
    }
    for (let index = start; index < indices.length; index += 1) {
      chosen.push(indices[index]);
      build(index + 1, chosen);
      chosen.pop();
    }
  };
  build(0, []);

  let overfitCount = 0;
  for (const inSample of combinations) {
    const inSampleSet = new Set(inSample);
    const outSample = indices.filter((index) => !inSampleSet.has(index));

    const inSampleScores = performanceByConfig.map((series) => mean(inSample.map((index) => series[index] ?? 0)));
    const bestConfig = inSampleScores.indexOf(Math.max(...inSampleScores));

    const outSampleScores = performanceByConfig.map((series) => mean(outSample.map((index) => series[index] ?? 0)));
    const sorted = [...outSampleScores].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (outSampleScores[bestConfig] < median) overfitCount += 1;
  }

  return combinations.length === 0 ? 0 : overfitCount / combinations.length;
}
