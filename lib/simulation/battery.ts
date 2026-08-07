import { createRandom, mean, monteCarlo, profitFactor } from "@/lib/strategy/statistics";

/**
 * Investment-mode simulation battery.
 *
 * Five independent attacks on one return series. They are deliberately not variations of the
 * same idea: each can pass while another fails, and that disagreement is the useful signal.
 *
 *   monte_carlo      — does the result survive resampling trades independently?
 *   block_bootstrap  — does it survive resampling that *preserves* autocorrelation?
 *   walk_forward     — is the edge spread across time, or carried by one lucky stretch?
 *   permutation      — is the mean distinguishable from a symmetric-noise null?
 *   cost_stress      — does it survive costs being worse than modelled?
 *
 * Every function here is deterministic given its seed. A simulation whose verdict moves
 * between runs cannot be used as evidence, because the next run is a new trial.
 *
 * What this is NOT: none of these can tell you a strategy will make money. They can only
 * remove strategies that were never distinguishable from luck. Survivors are candidates for
 * forward paper evidence, not conclusions.
 */

export type SimulationKind =
  | "monte_carlo"
  | "block_bootstrap"
  | "walk_forward"
  | "permutation"
  | "cost_stress";

export type SimulationVerdict = "pass" | "fail" | "inconclusive";

export interface SimulationResult {
  kind: SimulationKind;
  verdict: SimulationVerdict;
  /** Plain-language statement of what was measured and why it passed or failed. */
  reason: string;
  metrics: Record<string, number>;
}

export interface BatteryReport {
  results: SimulationResult[];
  /** `pass` only when every simulation passes. One inconclusive makes the whole battery so. */
  verdict: SimulationVerdict;
  summary: string;
  trades: number;
}

export const SIMULATION_GATES = Object.freeze({
  /** Below this the sample cannot support any of these tests. */
  minTrades: 30,
  maxProbabilityOfLoss: 0.35,
  /** Share of time-slices that must be profitable for the edge to count as distributed. */
  minProfitableFolds: 0.6,
  maxPermutationPValue: 0.05,
  minStressedProfitFactor: 1.0,
  iterations: 2_000,
  seed: 42,
});

function insufficient(kind: SimulationKind, trades: number): SimulationResult {
  return {
    kind,
    verdict: "inconclusive",
    reason: `${trades} trades is below the ${SIMULATION_GATES.minTrades} needed for this test to mean anything.`,
    metrics: { trades, required: SIMULATION_GATES.minTrades },
  };
}

/**
 * Lag-1 autocorrelation. Reported alongside the bootstraps because it is the whole reason
 * they can disagree: when it is near zero the two are measuring the same thing, and when it
 * is not, the IID result is the optimistic one.
 */
export function lag1Autocorrelation(values: readonly number[]): number {
  if (values.length < 3) return 0;
  const average = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    const centred = values[i] - average;
    denominator += centred * centred;
    if (i > 0) numerator += centred * (values[i - 1] - average);
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

// ── 1. Monte Carlo ──────────────────────────────────────────────────────────────────────

export function monteCarloSimulation(returns: readonly number[]): SimulationResult {
  if (returns.length < SIMULATION_GATES.minTrades) return insufficient("monte_carlo", returns.length);
  const result = monteCarlo(returns, SIMULATION_GATES.iterations, SIMULATION_GATES.seed);
  const passed = result.probabilityOfLoss <= SIMULATION_GATES.maxProbabilityOfLoss;
  return {
    kind: "monte_carlo",
    verdict: passed ? "pass" : "fail",
    reason: passed
      ? `${(result.probabilityOfLoss * 100).toFixed(0)}% of resampled runs lost money.`
      : `${(result.probabilityOfLoss * 100).toFixed(0)}% of resampled runs lost money, above the ${SIMULATION_GATES.maxProbabilityOfLoss * 100}% ceiling.`,
    metrics: {
      probabilityOfLoss: result.probabilityOfLoss,
      medianProfitFactor: result.medianProfitFactor,
      p05ProfitFactor: result.p05ProfitFactor,
      worstDrawdown: result.worstDrawdown,
    },
  };
}

// ── 2. Stationary block bootstrap (Politis & Romano) ────────────────────────────────────

/**
 * Resamples blocks of random geometric length rather than individual trades, so serial
 * dependence survives the resampling. Plain IID bootstrap destroys it by construction — it
 * produces a lag-1 autocorrelation of ~0 no matter what the original series looked like,
 * which quietly flatters any strategy whose losses arrive in clusters.
 *
 * Mean block length is n^(1/3), the standard choice for stationary data.
 */
export function blockBootstrapSimulation(
  returns: readonly number[],
  // Annotated, not inferred: `Object.freeze` on a literal preserves literal types, so an
  // unannotated default of SIMULATION_GATES.iterations types this parameter as exactly `2000`
  // and rejects every other iteration count.
  iterations: number = SIMULATION_GATES.iterations,
  seed: number = SIMULATION_GATES.seed,
): SimulationResult {
  const n = returns.length;
  if (n < SIMULATION_GATES.minTrades) return insufficient("block_bootstrap", n);

  const meanBlock = Math.max(2, Math.round(Math.cbrt(n)));
  const restartProbability = 1 / meanBlock;
  const random = createRandom(seed);

  let losingRuns = 0;
  const factors: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: number[] = [];
    let index = Math.floor(random() * n);
    for (let step = 0; step < n; step += 1) {
      // Start a fresh block, or continue the current one — wrapping keeps every observation
      // equally likely to appear, which is what makes the resample stationary.
      if (step > 0 && random() < restartProbability) index = Math.floor(random() * n);
      else if (step > 0) index = (index + 1) % n;
      sample.push(returns[index]);
    }
    const total = sample.reduce((sum, value) => sum + value, 0);
    if (total < 0) losingRuns += 1;
    const factor = profitFactor(sample);
    factors.push(Number.isFinite(factor) ? factor : 10);
  }

  factors.sort((a, b) => a - b);
  const probabilityOfLoss = losingRuns / iterations;
  const passed = probabilityOfLoss <= SIMULATION_GATES.maxProbabilityOfLoss;
  const autocorrelation = lag1Autocorrelation(returns);

  return {
    kind: "block_bootstrap",
    verdict: passed ? "pass" : "fail",
    reason: passed
      ? `${(probabilityOfLoss * 100).toFixed(0)}% of block-resampled runs lost money (mean block ${meanBlock} trades, lag-1 autocorrelation ${autocorrelation.toFixed(3)}).`
      : `${(probabilityOfLoss * 100).toFixed(0)}% of block-resampled runs lost money once serial dependence was preserved.`,
    metrics: {
      probabilityOfLoss,
      meanBlockLength: meanBlock,
      lag1Autocorrelation: autocorrelation,
      p05ProfitFactor: factors[Math.floor(0.05 * factors.length)],
      medianProfitFactor: factors[Math.floor(0.5 * factors.length)],
    },
  };
}

// ── 3. Walk-forward stability ───────────────────────────────────────────────────────────

/**
 * Splits the realised trades into contiguous slices and asks how many were profitable.
 *
 * Honest naming caveat: this is *stability*, not a refitting walk-forward. A true walk-forward
 * re-optimises parameters on each training window, which needs the strategy and the price data,
 * not a finished return series. What this catches is the common failure where one exceptional
 * stretch carries an otherwise flat record.
 *
 * Purging and embargo (López de Prado) are deliberately absent: they remove training rows whose
 * labels overlap a test fold, and nothing is trained here. They belong on any supervised path —
 * a Kronos feature/label pipeline, say — not on a post-hoc slice of realised returns.
 *
 * @param times Unix seconds per trade, aligned with `returns`. Supply them whenever they exist.
 *   Without timestamps the only possible split is by trade *count*, and equal counts are not
 *   equal periods: a strategy that traded forty times in January and five times over the rest
 *   of the year produces five slices that are nearly all January, and then gets graded on
 *   whether its edge was "distributed across the period".
 */
export function walkForwardSimulation(
  returns: readonly number[],
  folds = 5,
  times?: readonly number[],
): SimulationResult {
  const n = returns.length;
  if (n < SIMULATION_GATES.minTrades) return insufficient("walk_forward", n);

  const usableFolds = Math.max(2, Math.min(folds, Math.floor(n / 10)));
  // Attempted, then confirmed. `slicesByTime` returns null when the timestamps cannot support a
  // calendar split, and a flag that reported the attempt rather than the outcome would label a
  // count-sliced result as time-sliced.
  const timeSliced =
    times !== undefined && times.length === n && n > 0 ? slicesByTime(returns, times, usableFolds) : null;
  const byTime = timeSliced !== null;
  const foldMeans: number[] = timeSliced ?? slicesByCount(returns, usableFolds);

  // The count that actually came back, not the count requested: time slicing drops spans with
  // no trades in them, and dividing by the requested number would understate the share.
  const evaluatedFolds = foldMeans.length;
  const profitable = foldMeans.filter((value) => value > 0).length;
  const share = profitable / evaluatedFolds;
  const passed = share >= SIMULATION_GATES.minProfitableFolds;
  const best = Math.max(...foldMeans);
  const total = foldMeans.reduce((sum, value) => sum + value, 0);
  // How much of the whole record one slice is responsible for. Near 1 means a single stretch
  // is the strategy and the rest is noise around it.
  const concentration = total > 0 ? best / total : 0;

  // Named in the output, because "3 of 5 slices profitable" means something different when the
  // slices are equal stretches of calendar than when they are equal counts of trades.
  const unit = byTime ? "time slice" : "equal-count slice";

  return {
    kind: "walk_forward",
    verdict: passed ? "pass" : "fail",
    reason: passed
      ? `${profitable} of ${evaluatedFolds} ${unit}s profitable; best slice carries ${(concentration * 100).toFixed(0)}% of the total.`
      : `Only ${profitable} of ${evaluatedFolds} ${unit}s were profitable — the edge is not distributed${byTime ? " across the period" : " across the record"}.`,
    metrics: {
      folds: evaluatedFolds,
      profitableFolds: profitable,
      profitableShare: share,
      bestFoldConcentration: concentration,
      worstFoldMean: Math.min(...foldMeans),
      /** 1 when slices are equal spans of calendar, 0 when they are equal counts of trades. */
      slicedByTime: byTime ? 1 : 0,
    },
  };
}

function slicesByCount(returns: readonly number[], folds: number): number[] {
  const size = Math.floor(returns.length / folds);
  const means: number[] = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const start = fold * size;
    const end = fold === folds - 1 ? returns.length : start + size;
    means.push(mean(returns.slice(start, end)));
  }
  return means;
}

/**
 * Equal spans of calendar between the first and last trade, or null when the timestamps cannot
 * support one — every trade at the same instant, or fewer than two spans with any trades in them.
 *
 * A span containing no trades has no mean return. It is not a zero, and counting it as an
 * unprofitable slice would fail a strategy for the periods it correctly stayed out of. Empty
 * spans are dropped and the fold count shrinks accordingly.
 */
function slicesByTime(
  returns: readonly number[],
  times: readonly number[],
  folds: number,
): number[] | null {
  const first = Math.min(...times);
  const last = Math.max(...times);
  const span = last - first;
  if (!Number.isFinite(span) || span <= 0) return null;

  const buckets: number[][] = Array.from({ length: folds }, () => []);
  times.forEach((time, index) => {
    // The final trade sits exactly on `last` and would otherwise land one bucket past the end.
    const bucket = Math.min(folds - 1, Math.floor(((time - first) / span) * folds));
    buckets[bucket].push(returns[index]);
  });

  const populated = buckets.filter((bucket) => bucket.length > 0).map((bucket) => mean(bucket));
  return populated.length >= 2 ? populated : null;
}

// ── 4. Permutation (sign-flip) null ─────────────────────────────────────────────────────

/**
 * Under the null that trade outcomes are symmetric noise, the sign of each return is a coin
 * flip. Flipping signs at random many times builds the distribution of mean returns that luck
 * alone produces, and the observed mean is placed inside it.
 *
 * Sign-flipping rather than order-shuffling: reordering a return series leaves its mean
 * untouched, so an order permutation tests nothing about whether the edge exists.
 */
export function permutationSimulation(
  returns: readonly number[],
  iterations: number = SIMULATION_GATES.iterations,
  seed: number = SIMULATION_GATES.seed,
): SimulationResult {
  const n = returns.length;
  if (n < SIMULATION_GATES.minTrades) return insufficient("permutation", n);

  const observed = mean(returns);
  const random = createRandom(seed);
  let atLeastAsExtreme = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (const value of returns) total += random() < 0.5 ? -value : value;
    if (total / n >= observed) atLeastAsExtreme += 1;
  }

  const pValue = atLeastAsExtreme / iterations;
  const passed = pValue <= SIMULATION_GATES.maxPermutationPValue && observed > 0;

  return {
    kind: "permutation",
    verdict: passed ? "pass" : "fail",
    reason: passed
      ? `Mean return ${observed.toFixed(5)} sits beyond the symmetric-noise null (p=${pValue.toFixed(4)}).`
      : observed <= 0
        ? `Mean return is ${observed.toFixed(5)}; there is no positive edge to test.`
        : `Mean return ${observed.toFixed(5)} is reachable by chance (p=${pValue.toFixed(4)} > ${SIMULATION_GATES.maxPermutationPValue}).`,
    metrics: { observedMean: observed, pValue, iterations },
  };
}

// ── 5. Cost stress ──────────────────────────────────────────────────────────────────────

/**
 * Charges progressively worse costs than were modelled. A strategy whose edge is thinner than
 * the uncertainty in its own cost assumptions is not an edge, it is an accounting artefact.
 */
export function costStressSimulation(
  returns: readonly number[],
  modelledRoundTripCost: number,
  multiples: readonly number[] = [1, 2, 3],
): SimulationResult {
  const n = returns.length;
  if (n < SIMULATION_GATES.minTrades) return insufficient("cost_stress", n);

  const metrics: Record<string, number> = { modelledRoundTripCost };
  let stressedAtDouble = Number.POSITIVE_INFINITY;

  for (const multiple of multiples) {
    const extra = modelledRoundTripCost * (multiple - 1);
    const factor = profitFactor(returns.map((value) => value - extra));
    metrics[`profitFactorAt${multiple}x`] = Number.isFinite(factor) ? factor : 10;
    if (multiple === 2) stressedAtDouble = factor;
  }

  const passed = stressedAtDouble >= SIMULATION_GATES.minStressedProfitFactor;
  return {
    kind: "cost_stress",
    verdict: passed ? "pass" : "fail",
    reason: passed
      ? `Profit factor holds at ${stressedAtDouble.toFixed(2)} when costs double.`
      : `Profit factor falls to ${stressedAtDouble.toFixed(2)} when costs double — the edge is inside the cost assumption.`,
    metrics,
  };
}

// ── Battery ─────────────────────────────────────────────────────────────────────────────

export interface BatteryOptions {
  /** Round-trip cost already embedded in the returns, as a fraction (e.g. 0.001 = 10bps). */
  modelledRoundTripCost?: number;
  folds?: number;
  iterations?: number;
  seed?: number;
  /**
   * Unix seconds per trade, aligned with `returns`. Supply them whenever the caller has them:
   * without timestamps the walk-forward can only slice by trade count, which is not the same
   * question as whether the edge held across the calendar.
   */
  times?: readonly number[];
}

export function runSimulationBattery(
  returns: readonly number[],
  options: BatteryOptions = {},
): BatteryReport {
  const iterations = options.iterations ?? SIMULATION_GATES.iterations;
  const seed = options.seed ?? SIMULATION_GATES.seed;

  const results: SimulationResult[] = [
    monteCarloSimulation(returns),
    blockBootstrapSimulation(returns, iterations, seed),
    walkForwardSimulation(returns, options.folds ?? 5, options.times),
    permutationSimulation(returns, iterations, seed),
    costStressSimulation(returns, options.modelledRoundTripCost ?? 0.001),
  ];

  const failed = results.filter((result) => result.verdict === "fail");
  const inconclusive = results.filter((result) => result.verdict === "inconclusive");
  const verdict: SimulationVerdict =
    failed.length > 0 ? "fail" : inconclusive.length > 0 ? "inconclusive" : "pass";

  return {
    results,
    verdict,
    trades: returns.length,
    summary:
      failed.length > 0
        ? `Failed ${failed.map((result) => result.kind).join(", ")}.`
        : inconclusive.length > 0
          ? `Inconclusive: ${inconclusive.map((result) => result.kind).join(", ")} lacked evidence.`
          : `Survived all ${results.length} simulations over ${returns.length} trades. This is a candidate for forward paper evidence, not a conclusion.`,
  };
}
