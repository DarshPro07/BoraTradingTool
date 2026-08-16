import type { Candle } from "@/lib/providers/types";
import { sessionOpenMinute, sessionStamps } from "@/lib/market/calendar";
import type { Market } from "@/lib/market/types";
import {
  OPENING_RANGE_MINUTES,
  POINT_IN_TIME_FEATURES,
  isIntradayResolution,
  type PointInTimeFeature,
} from "@/lib/strategy/dsl";

/**
 * Point-in-time feature panel.
 *
 * Every series here is computed so that the value at index `i` depends only on bars `0..i`.
 * That property is the whole reason this file exists separately from the engine: lookahead
 * is easy to introduce accidentally in a loop that has the full array in scope, and almost
 * impossible to spot afterwards in a return series that merely looks good.
 *
 * Features that cannot be derived from OHLCV alone are reported as *unavailable* rather than
 * defaulted to zero. A strategy referencing one is refused before it runs, because a zero
 * sector-relative-strength is not "neutral" — it is a fabricated observation.
 */

/** Features this panel can derive from bars alone. */
export const DERIVABLE_FEATURES = [
  "close", "open", "high", "low", "volume",
  "sma20", "sma50", "sma200", "ema12", "ema26",
  "rsi14", "atr14", "rvol", "gap_pct",
  "momentum_20d", "momentum_60d",
  "distance_from_52w_high", "distance_from_52w_low",
  "adv_20d",
  // Derivable, but only when the panel is told which market's clock the bars run on and that the
  // resolution is intraday. `compileStrategy` refuses these at daily resolution, so a panel that
  // reaches them without session context is a wiring bug rather than a user error.
  "minutes_since_open", "opening_range_high", "opening_range_low",
  // Added 2026-08-16 so the campaign's PINNED family contracts become expressible. Each is a
  // composite the DSL grammar cannot build for itself — it has comparisons but no arithmetic —
  // and each corresponds to a quantity a declared mechanism names in words. Deriving them here
  // keeps the language small, which is the alternative to growing one.
  "high_20d", "low_20d",
  "prior_session_high", "prior_session_low",
  "atr_stretch_sma20",
  "return_5d", "return_5d_in_vol",
  "rsi2",
] as const satisfies readonly PointInTimeFeature[];

export type DerivableFeature = (typeof DERIVABLE_FEATURES)[number];

/** Features the DSL permits but this panel cannot supply from price data. */
export const UNAVAILABLE_FEATURES: readonly PointInTimeFeature[] = POINT_IN_TIME_FEATURES.filter(
  (feature) => !(DERIVABLE_FEATURES as readonly string[]).includes(feature),
);

const derivableSet = new Set<string>(DERIVABLE_FEATURES);

export function isDerivable(feature: string): feature is DerivableFeature {
  return derivableSet.has(feature);
}

/** A bar's features, or null where the warm-up window has not been satisfied. */
export type FeatureVector = Partial<Record<DerivableFeature, number>>;

/**
 * How many bars each derivable feature needs before it leaves its warm-up window.
 *
 * This makes warm-up a COUNTABLE data condition — barsHeld vs barsNeeded — rather than an opaque
 * "still warming up" string, so a refusal can be resolved (ingest more history) with a knowable
 * resume, and composed with the market-state/time prerequisites for a strategy like ORB.
 *
 * Each value is the index at which the feature first becomes defined, plus one (see
 * `buildFeaturePanel`: `sma20` needs 20 bars, `rsi14`/`atr14` are defined at index 14 → 15 bars,
 * `rvol`/`momentum_20d`/`adv_20d` need index ≥ 20 → 21, `gap_pct` needs a prior bar → 2). Pinned
 * against the real panel by `features.warmup.test.ts`, so it cannot drift from the computation.
 *
 * Raw OHLCV, the 52-week-distance features, and `minutes_since_open` are known from the first bar
 * (or the first session stamp), so they warm up in one bar. The opening-range features
 * (`opening_range_high/low`) are TIME-gated: their window closes a fixed number of minutes after
 * the open, which is more than one bar at sub-15-minute resolution. They are deliberately absent
 * here — a bar count would misrepresent a session-clock gate. Callers detect that case as
 * "enough bars held but not ready" and treat it as a TIME condition (see `WarmupRefusal.timeGated`).
 */
export const FEATURE_WARMUP_BARS: Partial<Record<DerivableFeature, number>> = Object.freeze({
  sma20: 20,
  sma50: 50,
  sma200: 200,
  ema12: 12,
  ema26: 26,
  rsi14: 15,
  atr14: 15,
  rsi2: 3,
  high_20d: 21,
  low_20d: 21,
  return_5d: 6,
  // Needs the 5-day return AND a 20-bar volatility estimate under it.
  return_5d_in_vol: 21,
  // sma20 (20) and atr14 (15) both, so the deeper one binds.
  atr_stretch_sma20: 20,
  rvol: 21,
  gap_pct: 2,
  momentum_20d: 21,
  momentum_60d: 61,
  adv_20d: 21,
});

/**
 * The bars a strategy needs before every required feature is out of warm-up — the max over its
 * required derivable features. Session-gated and raw features contribute 1 (they warm up in a
 * bar); an unknown feature is treated conservatively as 1. Returns at least 1.
 */
export function warmupBarsFor(required: readonly string[]): number {
  let needed = 1;
  for (const feature of required) {
    const featureNeed = (FEATURE_WARMUP_BARS as Record<string, number | undefined>)[feature] ?? 1;
    if (featureNeed > needed) needed = featureNeed;
  }
  return needed;
}

export interface FeaturePanel {
  readonly length: number;
  /** Features knowable at the close of bar `index`. */
  at(index: number): FeatureVector;
  /** True once every feature the strategy needs has left its warm-up window. */
  ready(index: number, required: readonly string[]): boolean;
}

function rollingMean(values: readonly number[], index: number, window: number): number | undefined {
  if (index + 1 < window) return undefined;
  let total = 0;
  for (let i = index - window + 1; i <= index; i += 1) total += values[i];
  return total / window;
}

function emaSeries(values: readonly number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder-smoothed RSI, seeded from the first `period` changes. */
function rsiSeries(closes: readonly number[], period = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  if (closes.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  // No movement at all is neutral, not maximally overbought.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder-smoothed Average True Range. */
function atrSeries(bars: readonly Candle[], period = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(bars.length).fill(undefined);
  if (bars.length <= period) return out;

  const trueRanges: number[] = [0];
  for (let i = 1; i < bars.length; i += 1) {
    trueRanges.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      ),
    );
  }

  let atr = trueRanges.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period + 1; i < bars.length; i += 1) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Standard deviation of the last `window` bar-to-bar returns, in percent.
 *
 * The denominator that makes a drop threshold portable. "Fell 8%" means something different for a
 * utility and for a microcap; "fell two standard deviations" means the same thing for both, which
 * is exactly why the swing mean-reversion contract declares its trigger in volatility units.
 *
 * Sample standard deviation (n−1): with a 20-bar window the population form is biased low, and a
 * volatility estimate that reads small makes an ordinary drop look extreme.
 */
function realizedVolatility(
  closes: readonly number[],
  index: number,
  window: number,
): number | undefined {
  if (index < window) return undefined;
  const returns: number[] = [];
  for (let i = index - window + 1; i <= index; i += 1) {
    const previous = closes[i - 1];
    if (previous <= 0) return undefined;
    returns.push((closes[i] / previous - 1) * 100);
  }
  if (returns.length < 2) return undefined;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

function rollingExtreme(
  values: readonly number[],
  index: number,
  window: number,
  pick: "max" | "min",
): number | undefined {
  if (index + 1 < window) return undefined;
  let best = values[index];
  for (let i = index - window + 1; i <= index; i += 1) {
    if (pick === "max" ? values[i] > best : values[i] < best) best = values[i];
  }
  return best;
}

/**
 * Builds the panel. Bars must be ordered oldest-to-newest and already validated; this
 * function trusts the ordering it is given and says so rather than silently re-sorting,
 * because a silent re-sort hides an upstream provider bug.
 */
/**
 * Session context for the intraday features. Absent for a daily panel, where they mean nothing.
 */
export interface PanelOptions {
  market?: Market;
  /** The DSL resolution. Anything other than `"D"` turns the session features on. */
  resolution?: string;
}

export function buildFeaturePanel(bars: readonly Candle[], options: PanelOptions = {}): FeaturePanel {
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  // Hoisted out of `at()`. Rebuilding these per call made a single lookup O(bars) rather than
  // O(window), which turned every backtest walk quadratic — and the engines now read two
  // vectors per bar to evaluate crossing events, which would have doubled it again.
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const dollarVolumes = bars.map((bar) => bar.close * bar.volume);

  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const rsi14 = rsiSeries(closes, 14);
  const rsi2 = rsiSeries(closes, 2);
  const atr14 = atrSeries(bars, 14);

  // Session position, and the opening range of each session, computed once for the whole series.
  //
  // The opening range is the extreme of the first `OPENING_RANGE_MINUTES` of *that bar's own*
  // session. It is deliberately keyed by local session date rather than by a bar count: a session
  // that opens late, or whose first bars are missing from the feed, must not borrow the previous
  // day's range and call it today's.
  //
  // Point-in-time by construction. The range is only served to bars at or after the end of the
  // range window, so every bar it was built from is already history when it is read.
  const intraday = isIntradayResolution(options.resolution);
  const market = options.market;
  const stamps = intraday && market ? sessionStamps(bars.map((bar) => bar.time), market) : null;
  const openMinute = market ? sessionOpenMinute(market) : 0;
  const rangeEndsAt = openMinute + OPENING_RANGE_MINUTES;

  /**
   * The previous session's high and low, which the relative-volume family names as its reference
   * level ("prior-day high/low or N-bar extreme"). Keyed by session date and served only to bars
   * of a LATER session, so it is complete history by the time it is read.
   */
  const sessionExtremes = new Map<string, { high: number; low: number }>();
  const priorSessionDate = new Map<string, string>();
  if (stamps) {
    let seen: string | null = null;
    for (let i = 0; i < bars.length; i += 1) {
      const date = stamps[i].date;
      if (date !== seen) {
        if (seen !== null) priorSessionDate.set(date, seen);
        seen = date;
      }
      const held = sessionExtremes.get(date);
      if (held === undefined) sessionExtremes.set(date, { high: bars[i].high, low: bars[i].low });
      else {
        if (bars[i].high > held.high) held.high = bars[i].high;
        if (bars[i].low < held.low) held.low = bars[i].low;
      }
    }
  }

  const openingRange = new Map<string, { high: number; low: number }>();
  if (stamps) {
    for (let i = 0; i < bars.length; i += 1) {
      const stamp = stamps[i];
      if (stamp.minute >= rangeEndsAt) continue;
      const held = openingRange.get(stamp.date);
      if (held === undefined) {
        openingRange.set(stamp.date, { high: bars[i].high, low: bars[i].low });
        continue;
      }
      if (bars[i].high > held.high) held.high = bars[i].high;
      if (bars[i].low < held.low) held.low = bars[i].low;
    }
  }

  const at = (index: number): FeatureVector => {
    const bar = bars[index];
    const vector: FeatureVector = {
      close: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
    };

    const assign = (key: DerivableFeature, value: number | undefined) => {
      if (value !== undefined && Number.isFinite(value)) vector[key] = value;
    };

    assign("sma20", rollingMean(closes, index, 20));
    assign("sma50", rollingMean(closes, index, 50));
    assign("sma200", rollingMean(closes, index, 200));
    assign("ema12", ema12[index]);
    assign("ema26", ema26[index]);
    assign("rsi14", rsi14[index]);
    assign("atr14", atr14[index]);

    // Relative volume compares against the *preceding* 20 bars, excluding today — including
    // today would damp the very spike the feature exists to detect.
    if (index >= 20) {
      const priorMean = rollingMean(volumes, index - 1, 20);
      if (priorMean !== undefined && priorMean > 0) assign("rvol", bar.volume / priorMean);
    }

    if (index >= 1 && closes[index - 1] > 0) {
      assign("gap_pct", ((bar.open - closes[index - 1]) / closes[index - 1]) * 100);
    }
    if (index >= 20 && closes[index - 20] > 0) {
      assign("momentum_20d", (bar.close / closes[index - 20] - 1) * 100);
    }
    if (index >= 60 && closes[index - 60] > 0) {
      assign("momentum_60d", (bar.close / closes[index - 60] - 1) * 100);
    }

    assign("rsi2", rsi2[index]);

    // The N-bar extreme EXCLUDING the current bar: a breakout is a move beyond what came before,
    // and including today would make the comparison tautological on the bar that sets the high.
    if (index >= 20) {
      assign("high_20d", rollingExtreme(highs, index - 1, 20, "max"));
      assign("low_20d", rollingExtreme(lows, index - 1, 20, "min"));
    }

    // Distance from the short mean IN ATR UNITS — the intraday mean-reversion family declares its
    // stretch as "1.5-3.0 ATR(14) from VWAP/SMA", and the grammar cannot divide.
    const mean20 = rollingMean(closes, index, 20);
    const trueRange = atr14[index];
    if (mean20 !== undefined && trueRange !== undefined && trueRange > 0) {
      assign("atr_stretch_sma20", (bar.close - mean20) / trueRange);
    }

    if (index >= 5 && closes[index - 5] > 0) {
      const return5 = (bar.close / closes[index - 5] - 1) * 100;
      assign("return_5d", return5);
      // ...and the same return expressed in units of the instrument's own volatility, because the
      // swing family declares its trigger as a return "below -(1.5-3.0) x 20-day volatility".
      // Scaling by volatility is what makes one threshold mean the same thing across a quiet
      // large-cap and a violent small-cap.
      const vol = realizedVolatility(closes, index, 20);
      if (vol !== undefined && vol > 0) assign("return_5d_in_vol", return5 / vol);
    }

    if (stamps) {
      const previous = priorSessionDate.get(stamps[index].date);
      const extremes = previous === undefined ? undefined : sessionExtremes.get(previous);
      if (extremes !== undefined) {
        assign("prior_session_high", extremes.high);
        assign("prior_session_low", extremes.low);
      }
    }

    const window = Math.min(252, index + 1);
    const high52 = rollingExtreme(highs, index, window, "max");
    const low52 = rollingExtreme(lows, index, window, "min");
    if (high52 !== undefined && high52 > 0) {
      assign("distance_from_52w_high", ((bar.close - high52) / high52) * 100);
    }
    if (low52 !== undefined && low52 > 0) {
      assign("distance_from_52w_low", ((bar.close - low52) / low52) * 100);
    }

    if (index >= 20) {
      assign("adv_20d", rollingMean(dollarVolumes, index, 20));
    }

    if (stamps) {
      const stamp = stamps[index];
      assign("minutes_since_open", stamp.minute - openMinute);
      // Withheld until the range window has closed. Serving a partial range would let a breakout
      // fire against a level that was still moving — the level and the signal computed from the
      // same bar.
      if (stamp.minute >= rangeEndsAt) {
        const range = openingRange.get(stamp.date);
        if (range !== undefined) {
          assign("opening_range_high", range.high);
          assign("opening_range_low", range.low);
        }
      }
    }

    return vector;
  };

  return {
    length: bars.length,
    at,
    ready(index: number, required: readonly string[]): boolean {
      const vector = at(index);
      return required.every((feature) => isDerivable(feature) && vector[feature] !== undefined);
    },
  };
}
