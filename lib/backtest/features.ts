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
