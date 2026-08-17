/**
 * Detecting a price series whose dates are displaced.
 *
 * ## Why a calendar cannot find this
 *
 * `RELIANCE`, `TCS` and `HDFCBANK` each held a daily series stamped one calendar day early. That
 * one was catchable because a −1 shift puts a bar on every Sunday, and Sundays are arithmetic.
 *
 * The general case is not. Shift a series from Monday to the preceding Friday and **both dates are
 * legitimate sessions** — every bar passes the session calendar, the OHLC coherence guard and every
 * range check, while the series still delivers tomorrow's price under today's date. In a
 * cross-sectional strategy that is a full day of lookahead, and nothing structural reveals it.
 *
 * ## What does reveal it
 *
 * Equity returns are contemporaneously correlated with the market. A correctly aligned series peaks
 * at lag 0 against a market factor; a displaced one peaks at ±1 instead, because its "day t" return
 * really belongs to day t±1. That signature does not depend on knowing the true prices — only on
 * the series being an equity that moves with its market — so it works on any instrument, from any
 * source, with no reference series of its own and no network call.
 *
 * The reference factor must be built from series **known** to be aligned, or the test compares two
 * displacements and finds nothing.
 *
 * ## What this proves, and what it does not
 *
 * This is a **relative** alignment invariant, not an absolute timestamp authority. It establishes
 * that no instrument is displaced with respect to the market consensus it is measured against. It
 * cannot detect a displacement shared by the whole consensus — if an entire source generation were
 * shifted together, every series would agree with every other and the test would report a clean
 * universe.
 *
 * That residual risk is bounded elsewhere, not here: by the session calendar (a shift puts bars on
 * impossible dates) and by cross-source comparison against an independently dated provider. Neither
 * of those lives in this module, and a reader who takes "0 SUSPECTED" as proof of correct
 * timestamps has read more than the number carries.
 */

export interface AlignmentVerdict {
  instrumentId: string;
  /** The lag, in trading sessions, at which correlation with the market factor peaks. */
  bestLag: number;
  correlationAtZero: number;
  correlationAtBest: number;
  observations: number;
  status: "ALIGNED" | "DATE_ALIGNMENT_SUSPECTED" | "INSUFFICIENT_DATA" | "UNCORRELATED";
}

/**
 * Below this many overlapping returns, a lag correlation is noise wearing a number.
 *
 * `INSUFFICIENT_DATA` is a distinct outcome from `ALIGNED` on purpose: "we could not tell" and "we
 * checked and it is fine" are different claims, and collapsing them is how a thin series gets a
 * clean bill of health it never earned.
 */
export const MIN_OBSERVATIONS = 100;

/**
 * A series must beat its lag-0 correlation by this much at another lag before it is suspected.
 *
 * Set well above sampling noise: a genuinely displaced series does not edge past zero-lag, it
 * replaces it — RELIANCE matched 429 of 436 closes at +1 day and essentially none at 0.
 */
export const SUSPICION_MARGIN = 0.15;

/**
 * Below this peak correlation, the instrument does not track the market closely enough for the test
 * to say anything. Reported as `UNCORRELATED` rather than passed as `ALIGNED`.
 */
export const MIN_MARKET_CORRELATION = 0.15;

export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i]! - ma;
    const xb = b[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/** Simple returns from a close series. */
export function returnsOf(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]!;
    out.push(prev === 0 ? 0 : closes[i]! / prev - 1);
  }
  return out;
}

/**
 * Compare one instrument's returns against a market factor at several lags.
 *
 * `series` and `factor` are date-keyed so only genuinely shared sessions are compared — pairing by
 * array position would silently align different calendars, which is the very fault being hunted.
 */
export function assessAlignment(
  instrumentId: string,
  series: ReadonlyMap<string, number>,
  factor: ReadonlyMap<string, number>,
  lags: readonly number[] = [-1, 0, 1],
): AlignmentVerdict {
  const dates = [...series.keys()].filter((d) => factor.has(d)).sort();
  if (dates.length < MIN_OBSERVATIONS + 1) {
    return {
      instrumentId,
      bestLag: 0,
      correlationAtZero: 0,
      correlationAtBest: 0,
      observations: Math.max(0, dates.length - 1),
      status: "INSUFFICIENT_DATA",
    };
  }

  // Returns are indexed against the SHARED date list, so a lag is a shift within one calendar
  // rather than a shift between two different ones.
  const instrumentReturns = returnsOf(dates.map((d) => series.get(d)!));
  const factorReturns = dates.slice(1).map((d) => factor.get(d));

  const scored = lags.map((lag) => {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < instrumentReturns.length; i += 1) {
      const j = i + lag;
      const f = factorReturns[j];
      if (f === undefined) continue;
      a.push(instrumentReturns[i]!);
      b.push(f);
    }
    return { lag, correlation: pearson(a, b), n: a.length };
  });

  const atZero = scored.find((s) => s.lag === 0)?.correlation ?? 0;
  const best = scored.reduce((acc, s) => (s.correlation > acc.correlation ? s : acc), scored[0]!);

  let status: AlignmentVerdict["status"] = "ALIGNED";
  if (best.correlation < MIN_MARKET_CORRELATION) status = "UNCORRELATED";
  else if (best.lag !== 0 && best.correlation - atZero > SUSPICION_MARGIN) {
    status = "DATE_ALIGNMENT_SUSPECTED";
  }

  return {
    instrumentId,
    bestLag: best.lag,
    correlationAtZero: atZero,
    correlationAtBest: best.correlation,
    observations: best.n,
    status,
  };
}

/**
 * An equal-weight market **return** factor: the cross-sectional mean return per date.
 *
 * Returns rather than the mean close, deliberately. Averaging levels would let a ₹3,000 stock
 * dominate a ₹30 one, and — worse — would jump whenever the set of instruments reporting on a date
 * changed, manufacturing a "market move" out of a listing or a data gap. A mean of returns is
 * invariant to both.
 */
export function marketReturnFactor(
  reference: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const series of reference.values()) {
    const dates = [...series.keys()].sort();
    for (let i = 1; i < dates.length; i += 1) {
      const prev = series.get(dates[i - 1]!)!;
      if (prev === 0) continue;
      const date = dates[i]!;
      const entry = sums.get(date) ?? { total: 0, count: 0 };
      entry.total += series.get(date)! / prev - 1;
      entry.count += 1;
      sums.set(date, entry);
    }
  }
  const factor = new Map<string, number>();
  // A date backed by too few instruments is not a market observation.
  for (const [date, { total, count }] of sums) if (count >= 5) factor.set(date, total / count);
  return factor;
}
