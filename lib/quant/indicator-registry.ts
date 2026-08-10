/**
 * The IndicatorRegistry (quant mission WS1): one indicator definition — one formula, one
 * version — declared once and consumed by charts, DSL, research and backtesting alike.
 *
 * Contract rules:
 * - Warmup is declared, and every output index inside warmup is null. NEVER zero — a zero is a
 *   value, and a fabricated value is how a warmup artifact becomes a trading signal.
 * - Deterministic pure functions over arrays; no market data access, no clock, no provider.
 * - `lib/backtest/features.ts` remains the engine's bar-panel (session features live there);
 *   consolidating it onto this registry is queued work, recorded — not silently duplicated
 *   authority. Where both compute a formula (SMA/EMA/RSI/ATR), reference tests in BOTH suites
 *   pin the same numbers so the two cannot drift apart unnoticed.
 */

export interface IndicatorSpec {
  id: string;
  version: string;
  /**
   * Exact computation conventions where more than one exists in the wild (EWMA parameterization,
   * seeding, adjusted-vs-recursive). Reference fixtures prove each stated convention.
   */
  conventions?: Readonly<Record<string, string>>;
  inputs: readonly ("close" | "open" | "high" | "low" | "volume" | "typical")[];
  parameters: Record<string, number>;
  outputs: readonly string[];
  /** Indices before this are null in every output series. */
  warmup: number;
  missingData: "null-until-warmup";
  /** "any" | "intraday-only" — VWAP resets per session and is not meaningful on daily bars here. */
  applicability: "any" | "intraday-only";
  /** Extra inputs beyond one instrument's bars; callers MUST supply them or the compute refuses. */
  requiresContext?: readonly ("pair" | "sessionStarts")[];
  compute: (
    bars: IndicatorBars,
    parameters?: Record<string, number>,
    context?: { pair?: readonly number[]; sessionStarts?: readonly boolean[] },
  ) => Record<string, (number | null)[]>;
}

export interface IndicatorBars {
  open: readonly number[];
  high: readonly number[];
  low: readonly number[];
  close: readonly number[];
  volume: readonly number[];
}

function nulls(length: number): (number | null)[] {
  return new Array<number | null>(length).fill(null);
}

export function sma(values: readonly number[], period: number): (number | null)[] {
  const out = nulls(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) out[index] = sum / period;
  }
  return out;
}

export function ema(values: readonly number[], period: number): (number | null)[] {
  const out = nulls(values.length);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  // Seeded with the SMA of the first `period` values — the standard convention, stated.
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index];
  let current = seed / period;
  out[period - 1] = current;
  for (let index = period; index < values.length; index += 1) {
    current = alpha * values[index] + (1 - alpha) * current;
    out[index] = current;
  }
  return out;
}

/** EWMA with an explicit decay λ (RiskMetrics-style), distinct from period-EMA on purpose. */
export function ewma(values: readonly number[], lambda: number): (number | null)[] {
  const out = nulls(values.length);
  if (values.length === 0) return out;
  let current = values[0];
  out[0] = current;
  for (let index = 1; index < values.length; index += 1) {
    current = lambda * current + (1 - lambda) * values[index];
    out[index] = current;
  }
  return out;
}

export function rsi(closes: readonly number[], period: number): (number | null)[] {
  const out = nulls(closes.length);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  out[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    out[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return out;
}

export function atr(bars: IndicatorBars, period: number): (number | null)[] {
  const out = nulls(bars.close.length);
  if (bars.close.length <= period) return out;
  const trueRanges: number[] = [];
  for (let index = 1; index < bars.close.length; index += 1) {
    trueRanges.push(
      Math.max(
        bars.high[index] - bars.low[index],
        Math.abs(bars.high[index] - bars.close[index - 1]),
        Math.abs(bars.low[index] - bars.close[index - 1]),
      ),
    );
  }
  let current = trueRanges.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
  out[period] = current;
  for (let index = period; index < trueRanges.length; index += 1) {
    current = (current * (period - 1) + trueRanges[index]) / period;
    out[index + 1] = current;
  }
  return out;
}

export function rollingStdDev(values: readonly number[], period: number): (number | null)[] {
  const out = nulls(values.length);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const windowMean = window.reduce((acc, value) => acc + value, 0) / period;
    const variance = window.reduce((acc, value) => acc + (value - windowMean) ** 2, 0) / (period - 1);
    out[index] = Math.sqrt(variance);
  }
  return out;
}

export function rollingZScore(values: readonly number[], period: number): (number | null)[] {
  const out = nulls(values.length);
  const means = sma(values, period);
  const deviations = rollingStdDev(values, period);
  for (let index = 0; index < values.length; index += 1) {
    const windowMean = means[index];
    const deviation = deviations[index];
    if (windowMean !== null && deviation !== null && deviation > 0) {
      out[index] = (values[index] - windowMean) / deviation;
    }
  }
  return out;
}

export function rollingCorrelation(a: readonly number[], b: readonly number[], period: number): (number | null)[] {
  const length = Math.min(a.length, b.length);
  const out = nulls(length);
  for (let index = period - 1; index < length; index += 1) {
    const windowA = a.slice(index - period + 1, index + 1);
    const windowB = b.slice(index - period + 1, index + 1);
    const meanA = windowA.reduce((acc, value) => acc + value, 0) / period;
    const meanB = windowB.reduce((acc, value) => acc + value, 0) / period;
    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;
    for (let k = 0; k < period; k += 1) {
      covariance += (windowA[k] - meanA) * (windowB[k] - meanB);
      varianceA += (windowA[k] - meanA) ** 2;
      varianceB += (windowB[k] - meanB) ** 2;
    }
    const denominator = Math.sqrt(varianceA * varianceB);
    out[index] = denominator > 0 ? covariance / denominator : null;
  }
  return out;
}

/** Session VWAP — resets when `sessionStarts[i]` is true. Intraday-only by declaration. */
export function sessionVwap(bars: IndicatorBars, sessionStarts: readonly boolean[]): (number | null)[] {
  const out = nulls(bars.close.length);
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  for (let index = 0; index < bars.close.length; index += 1) {
    if (sessionStarts[index]) {
      cumulativePV = 0;
      cumulativeVolume = 0;
    }
    const typical = (bars.high[index] + bars.low[index] + bars.close[index]) / 3;
    cumulativePV += typical * bars.volume[index];
    cumulativeVolume += bars.volume[index];
    out[index] = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : null;
  }
  return out;
}

export const INDICATOR_REGISTRY: readonly IndicatorSpec[] = Object.freeze<IndicatorSpec[]>([
  {
    id: "sma", version: "1.0", inputs: ["close"], parameters: { period: 20 }, outputs: ["sma"],
    warmup: 19, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => ({ sma: sma(bars.close, p?.period ?? 20) }),
  },
  {
    id: "ema", version: "1.1", inputs: ["close"], parameters: { period: 12 }, outputs: ["ema"],
    warmup: 11, missingData: "null-until-warmup", applicability: "any",
    conventions: {
      decay_parameter: "period: α = 2/(period+1)",
      initialization: "seeded with SMA of the first `period` values; null before that",
    },
    compute: (bars, p) => ({ ema: ema(bars.close, p?.period ?? 12) }),
  },
  {
    id: "ewma", version: "1.1", inputs: ["close"], parameters: { lambda: 0.94 }, outputs: ["ewma"],
    warmup: 0, missingData: "null-until-warmup", applicability: "any",
    conventions: {
      decay_parameter: "lambda (RiskMetrics): next = λ·prev + (1−λ)·value. NOT pandas alpha (α = 1−λ), span or halflife.",
      initialization: "first observation (recursive), adjust=false",
      missing_values: "not accepted — series must be dense; gaps are the ingestion layer's problem",
    },
    compute: (bars, p) => ({ ewma: ewma(bars.close, p?.lambda ?? 0.94) }),
  },
  {
    id: "rsi", version: "1.0", inputs: ["close"], parameters: { period: 14 }, outputs: ["rsi"],
    warmup: 14, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => ({ rsi: rsi(bars.close, p?.period ?? 14) }),
  },
  {
    id: "macd", version: "1.0", inputs: ["close"], parameters: { fast: 12, slow: 26, signal: 9 },
    outputs: ["macd", "signal", "histogram"], warmup: 33, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => {
      const fast = ema(bars.close, p?.fast ?? 12);
      const slow = ema(bars.close, p?.slow ?? 26);
      const macdLine = bars.close.map((_, index) =>
        fast[index] !== null && slow[index] !== null ? (fast[index] as number) - (slow[index] as number) : null,
      );
      const defined = macdLine.map((value) => value ?? 0);
      const firstDefined = macdLine.findIndex((value) => value !== null);
      const signalRaw = ema(defined.slice(firstDefined), p?.signal ?? 9);
      const signal = nulls(bars.close.length);
      for (let index = 0; index < signalRaw.length; index += 1) signal[firstDefined + index] = signalRaw[index];
      const histogram = macdLine.map((value, index) =>
        value !== null && signal[index] !== null ? value - (signal[index] as number) : null,
      );
      return { macd: macdLine, signal, histogram };
    },
  },
  {
    id: "atr", version: "1.0", inputs: ["high", "low", "close"], parameters: { period: 14 }, outputs: ["atr"],
    warmup: 14, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => ({ atr: atr(bars, p?.period ?? 14) }),
  },
  {
    id: "bollinger", version: "1.0", inputs: ["close"], parameters: { period: 20, width: 2 },
    outputs: ["middle", "upper", "lower"], warmup: 19, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => {
      const period = p?.period ?? 20;
      const width = p?.width ?? 2;
      const middle = sma(bars.close, period);
      const deviation = rollingStdDev(bars.close, period);
      return {
        middle,
        upper: middle.map((value, index) =>
          value !== null && deviation[index] !== null ? value + width * (deviation[index] as number) : null,
        ),
        lower: middle.map((value, index) =>
          value !== null && deviation[index] !== null ? value - width * (deviation[index] as number) : null,
        ),
      };
    },
  },
  {
    id: "rvol", version: "1.0", inputs: ["volume"], parameters: { period: 20 }, outputs: ["rvol"],
    warmup: 20, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => {
      const period = p?.period ?? 20;
      const averages = sma(bars.volume, period);
      // Prior-window average, matching the engine's convention: today's volume over the PRIOR mean.
      return {
        rvol: bars.volume.map((volume, index) => {
          const prior = index > 0 ? averages[index - 1] : null;
          return prior !== null && prior > 0 ? volume / prior : null;
        }),
      };
    },
  },
  {
    id: "rolling_volatility", version: "1.0", inputs: ["close"], parameters: { period: 20 }, outputs: ["volatility"],
    warmup: 20, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => {
      const period = p?.period ?? 20;
      const returns = bars.close.map((close, index) => (index > 0 ? close / bars.close[index - 1] - 1 : 0));
      const out = rollingStdDev(returns.slice(1), period);
      return { volatility: [null, ...out] };
    },
  },
  {
    id: "rolling_zscore", version: "1.0", inputs: ["close"], parameters: { period: 20 }, outputs: ["zscore"],
    warmup: 19, missingData: "null-until-warmup", applicability: "any",
    compute: (bars, p) => ({ zscore: rollingZScore(bars.close, p?.period ?? 20) }),
  },
  {
    id: "rolling_correlation", version: "1.0", inputs: ["close"], parameters: { period: 20 },
    outputs: ["correlation"], warmup: 19, missingData: "null-until-warmup", applicability: "any",
    requiresContext: ["pair"],
    conventions: { pair: "context.pair supplies the second close series; refuses without it" },
    compute: (bars, p, context) => {
      if (!context?.pair) {
        throw new Error("rolling_correlation requires context.pair (the second series). Refused rather than correlated against nothing.");
      }
      return { correlation: rollingCorrelation(bars.close, context.pair, p?.period ?? 20) };
    },
  },
  {
    id: "vwap", version: "1.0", inputs: ["high", "low", "close", "volume"], parameters: {},
    outputs: ["vwap"], warmup: 0, missingData: "null-until-warmup", applicability: "intraday-only",
    requiresContext: ["sessionStarts"],
    conventions: {
      price_basis: "typical price (H+L+C)/3",
      session_reset: "context.sessionStarts marks each session's first bar; refuses without it — a VWAP that never resets is a different (and usually wrong) quantity",
    },
    compute: (bars, _p, context) => {
      if (!context?.sessionStarts) {
        throw new Error("vwap requires context.sessionStarts. Refused rather than computed over an unbounded window.");
      }
      return { vwap: sessionVwap(bars, context.sessionStarts) };
    },
  },
]);

export function indicator(id: string): IndicatorSpec {
  const spec = INDICATOR_REGISTRY.find((entry) => entry.id === id);
  if (!spec) throw new Error(`No indicator "${id}" in the registry.`);
  return spec;
}

/**
 * NOT yet in the registry, deliberately: ADX (Wilder's smoothing needs its own reference
 * fixtures before we trust our arithmetic), rolling covariance matrices and PCA (the
 * QuantMathKernel's job, backed by a numerical library rather than hand-rolled linear algebra),
 * and session-aware VWAP registration (exported above; registry entry lands with the intraday
 * session map when charts consume it). Queued in docs/autonomous-build/WORK_QUEUE.md.
 */
export const DEFERRED_INDICATORS = Object.freeze(["adx", "rolling_covariance_matrix", "pca"] as const);
/**
 * ADX status 2026-08-10: TA-Lib was attempted as the parity oracle (`pip install ta-lib`) and the
 * wheel delivered no importable binary in this environment. Per policy it stays deferred until
 * MarketPulse-vs-TA-Lib-vs-hand-fixture parity can actually run — never registered on our
 * arithmetic alone.
 */
