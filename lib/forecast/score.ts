import { pairedBootstrapEdge, type PairedEdgeResult } from "@/lib/strategy/statistics";

/**
 * Scoring a forecast against the only baseline that matters first: doing nothing.
 *
 * The persistence baseline — "the next close equals this close" — is embarrassingly hard to
 * beat on financial series, and it is the check a headline accuracy number never survives.
 * A model can post an excellent MAE on a quiet series while being strictly worse than
 * persistence, because most of the error it avoided was error persistence never made.
 *
 * So every forecast is scored *paired*, bar by bar, against persistence on the same bars, and
 * the difference is put through the same bootstrap the gauntlet uses. "Lower MAE" is not a
 * result. "Lower MAE than persistence, by more than resampling explains" is a result.
 */

export interface ScoredBar {
  time: number;
  close: number;
}

export const FORECAST_GATES = Object.freeze({
  /** Below this, directional accuracy is a coin-flip estimate with a huge standard error. */
  minScoredBars: 30,
  maxPValue: 0.05,
  iterations: 2_000,
  seed: 42,
});

export interface ForecastScore {
  ok: true;
  scoredBars: number;
  /** Share of bars where the model got the direction of the move right. */
  directionalAccuracy: number;
  mae: number;
  rmse: number;
  baseline: { mae: number; rmse: number; directionalAccuracy: number };
  /** Positive when the model's mean absolute error is lower than persistence's. */
  maeImprovement: number;
  significance: PairedEdgeResult;
  verdict: "better_than_persistence" | "no_better_than_persistence" | "inconclusive";
  reason: string;
}

export interface ForecastRefusal {
  ok: false;
  scoredBars: number;
  reason: string;
}

export type ForecastScoreResult = ForecastScore | ForecastRefusal;

/**
 * @param forecast Predicted bars plus the instant the model ran.
 * @param actual Realised bars. Must include at least one bar before the first scored bar,
 *   because the persistence baseline is that bar's close.
 *
 * Bars at or before `generatedAt` are dropped. A forecast file regenerated over history and
 * scored as though it had been available at each bar is lookahead of the purest kind, and it
 * is the single easiest way to make a forecaster look prophetic.
 */
export function scoreForecast(
  forecast: { generatedAt: string; bars: readonly ScoredBar[] },
  actual: readonly ScoredBar[],
): ForecastScoreResult {
  const generatedMs = Date.parse(forecast.generatedAt);
  if (Number.isNaN(generatedMs)) {
    return { ok: false, scoredBars: 0, reason: `"${forecast.generatedAt}" is not a parseable timestamp.` };
  }

  const ordered = [...actual].sort((a, b) => a.time - b.time);
  const previousClose = new Map<number, number>();
  for (let index = 1; index < ordered.length; index += 1) {
    previousClose.set(ordered[index].time, ordered[index - 1].close);
  }
  const actualClose = new Map(ordered.map((bar) => [bar.time, bar.close]));

  const modelErrors: number[] = [];
  const baselineErrors: number[] = [];
  let modelRight = 0;
  let baselineRight = 0;
  let droppedForLookahead = 0;

  for (const predicted of forecast.bars) {
    if (predicted.time * 1000 <= generatedMs) {
      droppedForLookahead += 1;
      continue;
    }
    const realised = actualClose.get(predicted.time);
    const prior = previousClose.get(predicted.time);
    if (realised === undefined || prior === undefined) continue;

    modelErrors.push(Math.abs(predicted.close - realised));
    baselineErrors.push(Math.abs(prior - realised));
    if (Math.sign(predicted.close - prior) === Math.sign(realised - prior)) modelRight += 1;
    // Persistence predicts no change, so it is "right" only on a bar that did not move.
    if (Math.sign(realised - prior) === 0) baselineRight += 1;
  }

  const scoredBars = modelErrors.length;
  if (scoredBars < FORECAST_GATES.minScoredBars) {
    return {
      ok: false,
      scoredBars,
      reason:
        `${scoredBars} scorable bar(s) is below the ${FORECAST_GATES.minScoredBars} needed for this comparison to mean anything` +
        (droppedForLookahead > 0
          ? `; ${droppedForLookahead} predicted bar(s) were at or before the forecast's own generation time and were dropped.`
          : "."),
    };
  }

  // Positive difference = the baseline erred more than the model, i.e. the model was better.
  const significance = pairedBootstrapEdge(
    baselineErrors,
    modelErrors,
    FORECAST_GATES.iterations,
    FORECAST_GATES.seed,
  );

  const mae = mean(modelErrors);
  const baselineMae = mean(baselineErrors);
  const improvement = baselineMae - mae;
  const better = improvement > 0 && significance.pValue <= FORECAST_GATES.maxPValue;

  return {
    ok: true,
    scoredBars,
    directionalAccuracy: modelRight / scoredBars,
    mae,
    rmse: rootMeanSquare(modelErrors),
    baseline: {
      mae: baselineMae,
      rmse: rootMeanSquare(baselineErrors),
      directionalAccuracy: baselineRight / scoredBars,
    },
    maeImprovement: improvement,
    significance,
    verdict: better ? "better_than_persistence" : "no_better_than_persistence",
    reason: better
      ? `Mean absolute error ${mae.toFixed(4)} against persistence's ${baselineMae.toFixed(4)} over ${scoredBars} bars (p=${significance.pValue.toFixed(4)}). Still historical, still not forward evidence.`
      : improvement <= 0
        ? `Mean absolute error ${mae.toFixed(4)} is no better than persistence's ${baselineMae.toFixed(4)}. The model is not beating "assume no change".`
        : `Mean absolute error is lower than persistence's, but resampling reaches the same gap too often to call it real (p=${significance.pValue.toFixed(4)} > ${FORECAST_GATES.maxPValue}).`,
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rootMeanSquare(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}
