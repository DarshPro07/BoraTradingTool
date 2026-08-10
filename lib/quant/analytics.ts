import { kurtosis, mean, normalInverse, profitFactor, sharpeRatio, skewness, standardDeviation } from "@/lib/strategy/statistics";
import { assumptionFingerprint, type AssumptionFingerprint } from "./model-assumptions";

/**
 * The risk-metric thresholds are POLICY, versioned and stated — not mathematical truth. Basel's
 * market-risk framework, for contrast, uses 97.5% ES over ~250-day windows; this deployment's
 * choices are its own and carried on every result so research can later compare estimators.
 */
export const RISK_METRIC_POLICY = Object.freeze({
  policyVersion: "rmp-2026-08-10.1",
  minTailObservations: 100,
  confidenceLevel: 0.95,
  tailMethod: "historical-simulation" as const,
  reason:
    "Below ~100 observations a 5% tail quantile is estimated from ≤5 points — noise dressed as a " +
    "risk number. A policy choice of this deployment, versioned so it can be revisited with evidence.",
});

/**
 * The Risk & Performance Analytics engine (quant mission WS2) — ONE authoritative set of metric
 * definitions, each carrying the assumption record it stands on.
 *
 * Discipline inherited from the rest of the system:
 * - Missing is not zero: a metric that cannot be computed is null WITH a stated reason.
 * - Naive √t Sharpe annualization assumes i.i.d. returns (Lo 2002); when serial correlation is
 *   measurable, the adjusted figure is computed BESIDE the naive one — never silently instead.
 * - Normal-parametric VaR is a labelled baseline beside historical VaR, never the only number.
 */

export interface ReturnAnalytics {
  observations: number;
  totalReturn: number | null;
  /** Per-period mean and volatility, and their annualized forms when periodsPerYear is given. */
  meanReturn: number | null;
  volatility: number | null;
  annualizedReturn: number | null;
  annualizedVolatility: number | null;
  /** Naive √t annualization — carries assumption `naive_sharpe_annualization`. */
  sharpeAnnualizedNaive: number | null;
  /**
   * Lo (2002) time-aggregation with EMPIRICAL autocorrelations up to `serialAdjustment.lagsUsed`
   * lags — the general form, not an AR(1) shortcut. Carries assumption `serial_adjusted_sharpe`.
   */
  sharpeAnnualizedSerialAdjusted: number | null;
  /** Estimator provenance for the adjusted figure — visible, never implied. */
  serialAdjustment: {
    estimator: "lo2002_empirical_autocovariance";
    estimatorVersion: string;
    lagsUsed: number;
    autocorrelations: number[];
  } | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdown: number | null;
  maxDrawdownDurationPeriods: number | null;
  /** Historical 95% — assumption `historical_var`. Null below MIN_TAIL_SAMPLE. */
  var95Historical: number | null;
  /** Normal-parametric 95% — assumption `normal_var`. A labelled baseline, never the only number. */
  var95Normal: number | null;
  /** Historical 95% Expected Shortfall — assumption `expected_shortfall`. */
  expectedShortfall95: number | null;
  skewness: number | null;
  kurtosis: number | null;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  /** Why any of the above is null, keyed by metric name. */
  unavailable: Record<string, string>;
  /** The versioned policy the tail metrics were computed under. */
  riskPolicy: typeof RISK_METRIC_POLICY;
  /** Pinned assumption records (id+version+hash) — evidence, not a lookup that can drift. */
  assumptions: readonly AssumptionFingerprint[];
}


export function analyzeReturns(returns: readonly number[], periodsPerYear?: number): ReturnAnalytics {
  const unavailable: Record<string, string> = {};
  const n = returns.length;

  if (n === 0) {
    const reason = "No returns supplied. Nothing is reported as zero.";
    return emptyAnalytics(reason);
  }

  const meanReturn = mean(returns);
  const volatility = n > 1 ? standardDeviation(returns) : null;
  if (volatility === null) unavailable.volatility = "Needs at least 2 observations.";

  const totalReturn = returns.reduce((acc, value) => acc * (1 + value), 1) - 1;

  let annualizedReturn: number | null = null;
  let annualizedVolatility: number | null = null;
  let sharpeAnnualizedNaive: number | null = null;
  let sharpeAnnualizedSerialAdjusted: number | null = null;
  let serialAdjustment: ReturnAnalytics["serialAdjustment"] = null;

  if (periodsPerYear === undefined) {
    unavailable.annualizedReturn = "periodsPerYear not stated; annualization is never assumed.";
  } else if (volatility !== null) {
    annualizedReturn = (1 + meanReturn) ** periodsPerYear - 1;
    annualizedVolatility = volatility * Math.sqrt(periodsPerYear);
    const perPeriodSharpe = sharpeRatio(returns);
    sharpeAnnualizedNaive = perPeriodSharpe * Math.sqrt(periodsPerYear);

    // Lo (2002), general aggregation: SR_q = SR · q / sqrt(q + 2·Σ_{k=1}^{q−1}(q−k)·ρ_k), with
    // EMPIRICAL ρ_k at each lag — not an AR(1) extrapolation of ρ_1. Lags are capped at the
    // point where the sample can still estimate them (n/4) and at q−1 where aggregation stops
    // caring; the lags actually used are part of the result's provenance.
    const q = periodsPerYear;
    const maxLags = Math.min(q - 1, Math.floor(n / 4), 60);
    if (maxLags < 1) {
      unavailable.sharpeAnnualizedSerialAdjusted = "Sample too short to estimate any autocorrelation lag.";
    } else {
      const autocorrelations = empiricalAutocorrelations(returns, maxLags);
      let dependence = 0;
      for (let k = 1; k <= maxLags; k += 1) {
        dependence += (q - k) * autocorrelations[k - 1];
      }
      const denominator = Math.sqrt(q + 2 * dependence);
      if (denominator > 0 && Number.isFinite(denominator)) {
        sharpeAnnualizedSerialAdjusted = perPeriodSharpe * (q / denominator);
        serialAdjustment = {
          estimator: "lo2002_empirical_autocovariance",
          estimatorVersion: "1.1",
          lagsUsed: maxLags,
          autocorrelations,
        };
      } else {
        unavailable.sharpeAnnualizedSerialAdjusted =
          "Estimated serial dependence is so negative the aggregation variance is non-positive — reported as unavailable rather than as a fabricated ratio.";
      }
    }
  }

  // Sortino: downside deviation over the same per-period basis.
  const downside = returns.filter((value) => value < 0);
  let sortino: number | null = null;
  if (downside.length === 0) {
    unavailable.sortino = "No losing period in the sample — downside deviation is zero, and a ratio over zero is not a measurement.";
  } else {
    const downsideDeviation = Math.sqrt(downside.reduce((acc, value) => acc + value * value, 0) / n);
    sortino = downsideDeviation > 0 ? meanReturn / downsideDeviation : null;
  }

  // Drawdown on the compounded curve.
  let peak = 1;
  let equity = 1;
  let maxDrawdown = 0;
  let drawdownStart = 0;
  let maxDuration = 0;
  let currentDuration = 0;
  for (let index = 0; index < n; index += 1) {
    equity *= 1 + returns[index];
    if (equity >= peak) {
      peak = equity;
      drawdownStart = index;
      currentDuration = 0;
    } else {
      currentDuration = index - drawdownStart;
      maxDuration = Math.max(maxDuration, currentDuration);
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
  }

  const calmar =
    annualizedReturn !== null && maxDrawdown > 0 ? annualizedReturn / maxDrawdown : null;
  if (calmar === null && annualizedReturn !== null) {
    unavailable.calmar = "No drawdown in the sample — the ratio's denominator does not exist yet.";
  }

  // Tails: historical quantiles only with a real sample; the normal figure is a labelled baseline.
  let var95Historical: number | null = null;
  let expectedShortfall95: number | null = null;
  if (n < RISK_METRIC_POLICY.minTailObservations) {
    unavailable.var95Historical = `Tail quantiles need ≥ ${RISK_METRIC_POLICY.minTailObservations} observations (${RISK_METRIC_POLICY.policyVersion}, a stated policy of this deployment — not a law of statistics); ${n} supplied.`;
    unavailable.expectedShortfall95 = unavailable.var95Historical;
  } else {
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor(0.05 * n);
    var95Historical = -sorted[index];
    const tail = sorted.slice(0, Math.max(1, index));
    expectedShortfall95 = -mean(tail);
  }
  const var95Normal =
    volatility !== null ? -(meanReturn + normalInverse(0.05) * volatility) : null;

  const wins = returns.filter((value) => value > 0).length;

  return {
    observations: n,
    totalReturn,
    meanReturn,
    volatility,
    annualizedReturn,
    annualizedVolatility,
    sharpeAnnualizedNaive,
    sharpeAnnualizedSerialAdjusted,
    serialAdjustment,
    sortino,
    calmar,
    maxDrawdown: maxDrawdown > 0 ? maxDrawdown : n > 1 ? 0 : null,
    maxDrawdownDurationPeriods: n > 1 ? maxDuration : null,
    var95Historical,
    var95Normal,
    expectedShortfall95,
    skewness: n >= 3 ? skewness(returns) : null,
    kurtosis: n >= 4 ? kurtosis(returns) : null,
    winRate: wins / n,
    expectancy: meanReturn,
    profitFactor: profitFactor(returns),
    unavailable,
    riskPolicy: RISK_METRIC_POLICY,
    assumptions: ["naive_sharpe_annualization", "serial_adjusted_sharpe", "normal_var", "historical_var", "expected_shortfall"].map(
      assumptionFingerprint,
    ),
  };
}

/** Empirical autocorrelations ρ_1..ρ_maxLags (biased denominator, standard for this use). */
function empiricalAutocorrelations(values: readonly number[], maxLags: number): number[] {
  const n = values.length;
  const center = mean(values);
  let variance = 0;
  for (const value of values) variance += (value - center) ** 2;
  if (variance === 0) return new Array<number>(maxLags).fill(0);
  const out: number[] = [];
  for (let lag = 1; lag <= maxLags; lag += 1) {
    let covariance = 0;
    for (let index = lag; index < n; index += 1) {
      covariance += (values[index] - center) * (values[index - lag] - center);
    }
    out.push(covariance / variance);
  }
  return out;
}

function emptyAnalytics(reason: string): ReturnAnalytics {
  return {
    observations: 0,
    totalReturn: null,
    meanReturn: null,
    volatility: null,
    annualizedReturn: null,
    annualizedVolatility: null,
    sharpeAnnualizedNaive: null,
    sharpeAnnualizedSerialAdjusted: null,
    serialAdjustment: null,
    sortino: null,
    calmar: null,
    maxDrawdown: null,
    maxDrawdownDurationPeriods: null,
    var95Historical: null,
    var95Normal: null,
    expectedShortfall95: null,
    skewness: null,
    kurtosis: null,
    winRate: null,
    expectancy: null,
    profitFactor: null,
    unavailable: { all: reason },
    riskPolicy: RISK_METRIC_POLICY,
    assumptions: [],
  };
}
