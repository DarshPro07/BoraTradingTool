/**
 * Pairwise correlation between strategies — the Star Map.
 *
 * `evaluateGate` has a `maxPairwiseCorrelation` rule and a `commonDays` input, and until now
 * nothing produced either. This module is that source.
 *
 * Two rules govern it, and both are cases of "missing is not zero":
 *
 *   - Series are aligned **by timestamp**, never by index. Zipping two strategies positionally
 *     correlates Monday's return of one against Thursday's of the other whenever their trade
 *     dates differ, which is most of the time. The number that comes out looks like a
 *     correlation and is not one.
 *   - A correlation that cannot be computed is `null`, never `0`. A constant series has no
 *     correlation with anything — undefined, not independent — and too little overlap gives an
 *     estimate too noisy to act on. Reporting either as zero tells the risk gate the positions
 *     are safely uncorrelated, which is the exact opposite of what is known.
 */

export interface ReturnPoint {
  /** Seconds since epoch, one per settled period. */
  time: number;
  /** Return for that period, net of costs. */
  value: number;
}

export interface PairCorrelation {
  a: string;
  b: string;
  /** Pearson correlation over the overlapping periods, or null if it cannot be computed. */
  correlation: number | null;
  /** Periods both series covered. The gate refuses below its own minimum. */
  commonDays: number;
  reason?: "INSUFFICIENT_OVERLAP" | "ZERO_VARIANCE";
}

export interface BookExposure {
  /** Highest absolute pairwise correlation found, or null if none could be computed. */
  maxPairwiseCorrelation: number | null;
  /** Overlap behind that specific pair — what the gate should refuse on, not the average. */
  commonDays: number | null;
  /** The pair responsible, for the audit trail. */
  pair: [string, string] | null;
  /** Every pair evaluated, including the ones that could not be computed. */
  pairs: PairCorrelation[];
}

/** Overlapping periods below which a correlation estimate is not worth acting on. */
export const MIN_COMMON_PERIODS = 20;

function align(a: readonly ReturnPoint[], b: readonly ReturnPoint[]): { x: number[]; y: number[] } {
  const byTime = new Map<number, number>();
  for (const point of b) {
    if (Number.isFinite(point.time) && Number.isFinite(point.value)) byTime.set(point.time, point.value);
  }

  const x: number[] = [];
  const y: number[] = [];
  // Sorted so the result does not depend on input ordering.
  for (const point of [...a].sort((p, q) => p.time - q.time)) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
    const other = byTime.get(point.time);
    if (other === undefined) continue;
    x.push(point.value);
    y.push(other);
  }
  return { x, y };
}

/**
 * Whether a series is constant for practical purposes.
 *
 * Testing `variance <= 0` does not work: summing sixty copies of 0.001 and subtracting the
 * mean leaves floating-point residue around 1e-19, so a flat series has a strictly positive
 * variance and Pearson happily returns something like -1.2e-16. That reads as "uncorrelated",
 * which is the most dangerous possible answer — the series has no correlation with anything,
 * and reporting near-zero tells the risk gate the position is safe to add.
 *
 * Compared against the series' own RMS magnitude so the test holds at any scale, and against
 * RMS rather than the mean so a genuine mean-zero series is not mistaken for a constant one.
 */
function isConstant(values: readonly number[], variance: number): boolean {
  const n = values.length;
  const rms = Math.sqrt(values.reduce((total, value) => total + value * value, 0) / n);
  const deviation = Math.sqrt(variance / Math.max(1, n - 1));
  return deviation <= 1e-9 * rms;
}

function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 2) return null;

  const meanX = x.reduce((total, value) => total + value, 0) / n;
  const meanY = y.reduce((total, value) => total + value, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  if (isConstant(x, varianceX) || isConstant(y, varianceY)) return null;
  const value = covariance / Math.sqrt(varianceX * varianceY);
  // Guard the floating-point edge so a perfectly correlated pair cannot report 1.0000000002.
  return Math.max(-1, Math.min(1, value));
}

export function correlate(
  a: readonly ReturnPoint[],
  b: readonly ReturnPoint[],
  minCommonPeriods = MIN_COMMON_PERIODS,
): Omit<PairCorrelation, "a" | "b"> {
  const { x, y } = align(a, b);
  const commonDays = x.length;

  if (commonDays < minCommonPeriods) {
    return { correlation: null, commonDays, reason: "INSUFFICIENT_OVERLAP" };
  }
  const correlation = pearson(x, y);
  if (correlation === null) {
    return { correlation: null, commonDays, reason: "ZERO_VARIANCE" };
  }
  return { correlation, commonDays };
}

/**
 * The worst pair in a book, which is what a concentration limit is actually about — an average
 * correlation of 0.2 across fifty pairs is no comfort if one pair sits at 0.95.
 *
 * Pairs whose correlation could not be computed are reported but cannot become the maximum:
 * they are unknowns for the gate to refuse on, not evidence of independence.
 */
export function bookExposure(
  series: Readonly<Record<string, readonly ReturnPoint[]>>,
  minCommonPeriods = MIN_COMMON_PERIODS,
): BookExposure {
  const ids = Object.keys(series).sort();
  const pairs: PairCorrelation[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push({ a: ids[i], b: ids[j], ...correlate(series[ids[i]], series[ids[j]], minCommonPeriods) });
    }
  }

  let worst: PairCorrelation | null = null;
  for (const pair of pairs) {
    if (pair.correlation === null) continue;
    if (worst === null || Math.abs(pair.correlation) > Math.abs(worst.correlation as number)) worst = pair;
  }

  return {
    maxPairwiseCorrelation: worst?.correlation ?? null,
    commonDays: worst?.commonDays ?? null,
    pair: worst ? [worst.a, worst.b] : null,
    pairs,
  };
}
