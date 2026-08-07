import type { Candle } from "@/lib/providers/types";

/**
 * Market regime from realised volatility.
 *
 * The one contract resource with no equivalent anywhere in this repository — `universe`,
 * `trials` and `forwardOutcomes` all have tables behind them, but nothing here ever classified
 * the market's state. The Python quant core never delivered it either: `data/regime_state.json`
 * is marked *(requested)* in the contract and has always returned `RESOURCE_NOT_PROVIDED`.
 *
 * ## What it does and does not claim
 *
 * This is a **descriptive** classifier, not a predictive one. It says what volatility has been,
 * ranked against its own recent history. It does not forecast, and `calibration` says so — the
 * contract's example shows `"walk_forward"`, which would be a lie here because nothing about this
 * has been walk-forward validated. Writing that string to look legitimate is exactly the
 * fabrication the rest of the system refuses.
 *
 * Ranking against a trailing window rather than fixed volatility thresholds is deliberate. An
 * absolute cut like "20% annualised is high" is wrong in both directions across instruments and
 * across decades; a percentile is at least a statement about this series.
 */

export type RegimeState = "LOW_VOL" | "NORMAL" | "HIGH_VOL";

/** Bars in the realised-volatility measurement window. */
export const MEASUREMENT_BARS = 20;

/** Bars of history the measurement is ranked against. One trading year. */
export const RANKING_BARS = 252;

/**
 * Enough windows to rank against. Below this the percentile is computed from so few observations
 * that it carries no information — three prior windows make every reading either 0, 0.5 or 1.
 */
const MINIMUM_RANKING_WINDOWS = 30;

const LOW_THRESHOLD = 0.33;
const HIGH_THRESHOLD = 0.67;

/**
 * Percentile distance at which a classification is treated as unambiguous. A reading sitting on
 * a boundary is a coin toss between two labels and must not be reported as though it were not.
 */
const CONFIDENT_MARGIN = 0.15;

export interface RegimeReading {
  state: RegimeState;
  /** Where this window's volatility sits in the trailing distribution, 0–1. */
  percentile: number;
  /** Annualised realised volatility of the most recent window, as a fraction. */
  realisedVolatility: number;
  /**
   * How unambiguous the label is — **not** a probability that the regime is correct.
   * 1 means the reading is far from either boundary; 0 means it is sitting on one.
   */
  confidence: number;
  /** Bars actually used, so a short series is visible rather than silently accepted. */
  barsUsed: number;
  asOf: string;
}

function logReturns(candles: readonly Candle[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    // A non-positive close is bad data, not a -Infinity return. Skipping the pair keeps one
    // corrupt bar from poisoning the whole window.
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  return returns;
}

/** Sample standard deviation, annualised from daily bars. */
function annualisedVolatility(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Returns null when the series cannot support a ranking, rather than a default regime.
 *
 * `NORMAL` would be the tempting fallback and it is the dangerous one: it is a real classification
 * that a caller will act on, produced by a measurement that never happened. The absent file that
 * results from null is read by the contract as `RESOURCE_NOT_PROVIDED`, which is the truth.
 */
export function classifyRegime(candles: readonly Candle[]): RegimeReading | null {
  const required = MEASUREMENT_BARS + MINIMUM_RANKING_WINDOWS;
  if (candles.length < required) return null;

  const window = candles.slice(-RANKING_BARS - MEASUREMENT_BARS);
  const returns = logReturns(window);
  if (returns.length < required - 1) return null;

  // Every overlapping window in the trailing period, including the most recent one, so the
  // current reading is ranked against a distribution it belongs to.
  const volatilities: number[] = [];
  for (let end = MEASUREMENT_BARS; end <= returns.length; end += 1) {
    volatilities.push(annualisedVolatility(returns.slice(end - MEASUREMENT_BARS, end)));
  }
  if (volatilities.length < MINIMUM_RANKING_WINDOWS) return null;

  const current = volatilities[volatilities.length - 1];
  const belowOrEqual = volatilities.filter((value) => value <= current).length;
  const percentile = belowOrEqual / volatilities.length;

  const state: RegimeState =
    percentile < LOW_THRESHOLD ? "LOW_VOL" : percentile > HIGH_THRESHOLD ? "HIGH_VOL" : "NORMAL";

  const distance = Math.min(
    Math.abs(percentile - LOW_THRESHOLD),
    Math.abs(percentile - HIGH_THRESHOLD),
  );

  const lastBar = window[window.length - 1];
  return {
    state,
    percentile,
    realisedVolatility: current,
    confidence: Math.min(1, distance / CONFIDENT_MARGIN),
    barsUsed: window.length,
    // Stamped from the last bar, not from the clock. A regime read from data ending on Friday is
    // Friday's regime however long it sits on disk, and dating it "now" would make stale data
    // look fresh to the freshness budget.
    asOf: new Date(lastBar.time * 1_000).toISOString().slice(0, 10),
  };
}
