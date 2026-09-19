/**
 * Fund metrics and the frozen trust gates (PRD §6-7). Pure.
 *
 * Every number here is computed from ledger NAV rows, each of which cites the close it was marked
 * at — so a metric can always be traced back to a price.
 */
import type { MandateContract } from "./mandates";

export interface NavPoint {
  date: string;
  nav: number;
  /** Buy-and-hold of the same asset, from the same starting capital, at the same closes. */
  benchmark: number;
}

export function maxDrawdown(series: readonly number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of series) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.max(worst, 1 - value / peak);
  }
  return worst;
}

export function periodReturns(series: readonly number[]): number[] {
  return series.slice(1).map((value, i) => value / series[i]! - 1);
}

function moments(xs: readonly number[]) {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const skew = sd > 0 ? xs.reduce((s, x) => s + ((x - mean) / sd) ** 3, 0) / n : 0;
  const kurt = sd > 0 ? xs.reduce((s, x) => s + ((x - mean) / sd) ** 4, 0) / n : 3;
  return { mean, sd, skew, kurt };
}

/** Per-period Sharpe (no risk-free rate). Null below 2 observations or with zero variance. */
export function periodSharpe(returns: readonly number[]): number | null {
  if (returns.length < 2) return null;
  const { mean, sd } = moments(returns);
  return sd > 0 ? mean / sd : null;
}

/**
 * Minimum Track Record Length (Bailey & López de Prado 2012): periods of this return process
 * needed to reject Sharpe <= 0 at `confidence`, allowing for skew and fat tails.
 *
 *   MinTRL = 1 + (1 - skew*SR + (kurt - 1)/4 * SR^2) * (z / SR)^2
 *
 * Infinity when the observed Sharpe is not positive: no track record length proves a
 * non-positive Sharpe positive.
 */
export function minTrackRecordLength(returns: readonly number[], confidence = 0.95): number {
  const sr = periodSharpe(returns);
  if (sr === null || sr <= 0) return Number.POSITIVE_INFINITY;
  const { skew, kurt } = moments(returns);
  const z = confidence === 0.95 ? 1.6448536269514722 : 2.3263478740408408; // one-sided 95% / 99%
  return 1 + (1 - skew * sr + ((kurt - 1) / 4) * sr * sr) * (z / sr) ** 2;
}

export interface MandateMetrics {
  daysLive: number;
  navNow: number | null;
  totalReturn: number | null;
  benchmarkReturn: number | null;
  maxDrawdown: number;
  benchmarkMaxDrawdown: number;
  annualizedVolatility: number | null;
  annualizedSharpe: number | null;
  /** Periods of track record still needed for T3 at the current Sharpe; Infinity if unreachable. */
  periodsStillNeeded: number;
}

export function mandateMetrics(points: readonly NavPoint[], periodsPerYear: number): MandateMetrics {
  const navs = points.map((p) => p.nav);
  const bench = points.map((p) => p.benchmark);
  const returns = periodReturns(navs);
  const sharpe = periodSharpe(returns);
  const sd = returns.length >= 2 ? moments(returns).sd : null;
  const needed = minTrackRecordLength(returns);
  return {
    daysLive: points.length,
    navNow: navs.at(-1) ?? null,
    totalReturn: navs.length >= 2 ? navs.at(-1)! / navs[0]! - 1 : null,
    benchmarkReturn: bench.length >= 2 ? bench.at(-1)! / bench[0]! - 1 : null,
    maxDrawdown: maxDrawdown(navs),
    benchmarkMaxDrawdown: maxDrawdown(bench),
    annualizedVolatility: sd === null ? null : sd * Math.sqrt(periodsPerYear),
    annualizedSharpe: sharpe === null ? null : sharpe * Math.sqrt(periodsPerYear),
    periodsStillNeeded: Math.max(0, needed - returns.length),
  };
}

export interface GateFacts {
  /** Scheduled decision dates since start, and how many of them have a ledger row. */
  decisionDatesDue: number;
  decisionDatesRecorded: number;
  /** Failed executions with no recorded reason. */
  unexplainedFailures: number;
  decisionPoints: number;
}

export interface TrustGates {
  T1_OPERATIONAL: boolean;
  T2_BEHAVES_AS_DECLARED: boolean;
  T3_STATISTICAL: boolean;
  eligibleToProposeLive: boolean;
  reasons: string[];
}

/** PRD §7, frozen. The system reports these; it never acts on them toward real money. */
export function trustGates(mandate: MandateContract, metrics: MandateMetrics, facts: GateFacts): TrustGates {
  const reasons: string[] = [];
  const t1 =
    metrics.daysLive >= 30 && facts.decisionDatesRecorded >= facts.decisionDatesDue && facts.unexplainedFailures === 0;
  if (!t1) reasons.push(`T1 needs >= 30 days live with every decision recorded (${metrics.daysLive} days, ${facts.decisionDatesRecorded}/${facts.decisionDatesDue} decisions).`);

  const drawdownOk = metrics.maxDrawdown <= metrics.benchmarkMaxDrawdown;
  const returnOk =
    metrics.totalReturn !== null && metrics.benchmarkReturn !== null && metrics.totalReturn >= metrics.benchmarkReturn;
  const benefit = mandate.declaredBenefit === "DRAWDOWN" ? drawdownOk : drawdownOk && returnOk;
  const t2 = metrics.daysLive >= 90 && facts.decisionPoints >= 3 && benefit;
  if (!t2) reasons.push(`T2 needs >= 90 days, >= 3 decisions and the declared benefit (${mandate.declaredBenefit}) vs buy-and-hold.`);

  const t3 = metrics.periodsStillNeeded === 0;
  if (!t3 && metrics.annualizedSharpe === null) {
    reasons.push("T3 needs a return history before a Sharpe ratio exists.");
  } else if (!t3) {
    reasons.push(
      Number.isFinite(metrics.periodsStillNeeded)
        ? `T3 needs ~${Math.ceil(metrics.periodsStillNeeded)} more periods at the current Sharpe.`
        : "T3 unreachable at the current Sharpe (not positive).",
    );
  }
  return { T1_OPERATIONAL: t1, T2_BEHAVES_AS_DECLARED: t2, T3_STATISTICAL: t3, eligibleToProposeLive: t1 && t2 && t3, reasons };
}
