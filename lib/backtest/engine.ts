import type { Candle } from "@/lib/providers/types";
import type { Condition, StrategyDsl } from "@/lib/strategy/dsl";
import { roundTripCostBps } from "@/lib/strategy/dsl";
import type { GauntletEvidence } from "@/lib/strategy/gauntlet";
import { UNAVAILABLE_FEATURES, buildFeaturePanel, isDerivable, type FeaturePanel, type FeatureVector } from "./features";

/**
 * Deterministic bar-close backtester.
 *
 * This closes the circuit the validation stack was missing: the gauntlet knows how to judge a
 * return series, the DSL knows how to describe a strategy, and nothing connected the two — so
 * every statistic was previously computed over numbers supplied by hand.
 *
 * Two rules are enforced rather than documented:
 *
 *   1. A decision made on the close of bar `i` fills at the open of bar `i+1`. Filling at the
 *      close you just used to decide is the most common way a backtest invents an edge.
 *   2. A feature the panel cannot derive is a refusal, not a zero. Substituting a neutral
 *      value would let a strategy referencing sector strength "pass" on price data alone.
 */

export type ExitReason = "stop_loss" | "take_profit" | "time_limit" | "condition" | "end_of_data";

export interface Trade {
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  /** Price change over the holding period, before costs. */
  grossReturn: number;
  /** Gross return less the modelled round-trip cost. This is what the gauntlet grades. */
  netReturn: number;
  exitReason: ExitReason;
}

export type RefusalCode =
  | "FEATURE_NOT_AVAILABLE"
  | "INSUFFICIENT_BARS"
  | "UNORDERED_BARS";

export interface BacktestRefusal {
  ok: false;
  code: RefusalCode;
  message: string;
}

export interface BacktestRun {
  ok: true;
  trades: Trade[];
  evidence: GauntletEvidence;
  barsEvaluated: number;
  /** Bars where the entry condition could not be evaluated because a feature was warming up. */
  warmingUp: number;
}

export type BacktestResult = BacktestRun | BacktestRefusal;

export interface BacktestOptions {
  /** Share of trades treated as in-sample. The remainder is out-of-sample. Default 0.5. */
  inSampleFraction?: number;
  datasetFingerprint?: string;
}

/** Minimum bars before any strategy can be evaluated, regardless of its features. */
const MIN_BARS = 30;

export function collectFeatures(condition: Condition, into: Set<string>): void {
  if ("feature" in condition) {
    into.add(condition.feature);
    return;
  }
  if ("compare" in condition) {
    into.add(condition.compare[0]);
    into.add(condition.compare[1]);
    return;
  }
  if ("crossover" in condition) {
    into.add(condition.crossover[0]);
    into.add(condition.crossover[1]);
    return;
  }
  if ("crossunder" in condition) {
    into.add(condition.crossunder[0]);
    into.add(condition.crossunder[1]);
    return;
  }
  if ("not" in condition) {
    collectFeatures(condition.not, into);
    return;
  }
  for (const child of "all" in condition ? condition.all : condition.any) {
    collectFeatures(child, into);
  }
}

function compare(op: "gt" | "gte" | "lt" | "lte", left: number, right: number): boolean {
  switch (op) {
    case "gt": return left > right;
    case "gte": return left >= right;
    case "lt": return left < right;
    case "lte": return left <= right;
  }
}

/**
 * Evaluates a condition against one bar's features.
 * Returns undefined when any referenced feature is still warming up — the caller abstains
 * rather than treating "unknown" as false, which would silently suppress early signals.
 *
 * `previous` is the prior bar's vector; crossover/crossunder are events between two
 * consecutive bars and are unknowable without it (first bar, or warm-up on either side).
 */
export function evaluate(
  condition: Condition,
  vector: FeatureVector,
  previous?: FeatureVector,
): boolean | undefined {
  if ("feature" in condition) {
    const value = isDerivable(condition.feature) ? vector[condition.feature] : undefined;
    return value === undefined ? undefined : compare(condition.op, value, condition.value);
  }
  if ("compare" in condition) {
    const [leftKey, rightKey] = condition.compare;
    const left = isDerivable(leftKey) ? vector[leftKey] : undefined;
    const right = isDerivable(rightKey) ? vector[rightKey] : undefined;
    if (left === undefined || right === undefined) return undefined;
    return compare(condition.op, left, right);
  }
  if ("crossover" in condition || "crossunder" in condition) {
    const [leftKey, rightKey] = "crossover" in condition ? condition.crossover : condition.crossunder;
    if (!previous) return undefined;
    if (!isDerivable(leftKey) || !isDerivable(rightKey)) return undefined;
    const left = vector[leftKey];
    const right = vector[rightKey];
    const prevLeft = previous[leftKey];
    const prevRight = previous[rightKey];
    if (left === undefined || right === undefined || prevLeft === undefined || prevRight === undefined) {
      return undefined;
    }
    return "crossover" in condition
      ? prevLeft <= prevRight && left > right
      : prevLeft >= prevRight && left < right;
  }
  if ("not" in condition) {
    const inner = evaluate(condition.not, vector, previous);
    return inner === undefined ? undefined : !inner;
  }
  if ("all" in condition) {
    let unknown = false;
    for (const child of condition.all) {
      const result = evaluate(child, vector, previous);
      if (result === false) return false; // a definite false settles a conjunction
      if (result === undefined) unknown = true;
    }
    return unknown ? undefined : true;
  }
  let unknown = false;
  for (const child of condition.any) {
    const result = evaluate(child, vector, previous);
    if (result === true) return true; // a definite true settles a disjunction
    if (result === undefined) unknown = true;
  }
  return unknown ? undefined : false;
}

export function runBacktest(
  dsl: StrategyDsl,
  bars: readonly Candle[],
  options: BacktestOptions = {},
): BacktestResult {
  if (bars.length < MIN_BARS) {
    return {
      ok: false,
      code: "INSUFFICIENT_BARS",
      message: `${bars.length} bars supplied; ${MIN_BARS} is the minimum before any conclusion is meaningful.`,
    };
  }

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].time <= bars[i - 1].time) {
      return {
        ok: false,
        code: "UNORDERED_BARS",
        message:
          `Bars are not strictly increasing in time at index ${i}. Re-sorting here would hide ` +
          "a provider defect, so the run is refused instead.",
      };
    }
  }

  const required = new Set<string>();
  collectFeatures(dsl.entry, required);
  if (dsl.exit.condition) collectFeatures(dsl.exit.condition, required);

  const unavailable = [...required].filter((feature) => !isDerivable(feature));
  if (unavailable.length > 0) {
    return {
      ok: false,
      code: "FEATURE_NOT_AVAILABLE",
      message:
        `This engine cannot derive ${unavailable.join(", ")} from price data. ` +
        `Unsupported features: ${UNAVAILABLE_FEATURES.join(", ")}. ` +
        "They are refused rather than defaulted, because a fabricated zero would let the " +
        "strategy appear to have been tested on evidence that was never present.",
    };
  }

  const panel: FeaturePanel = buildFeaturePanel(bars);
  const roundTripCost = roundTripCostBps(dsl, 1) / 10_000;
  const stopLoss = dsl.exit.stopLossPct !== undefined ? dsl.exit.stopLossPct / 100 : undefined;
  const takeProfit = dsl.exit.takeProfitPct !== undefined ? dsl.exit.takeProfitPct / 100 : undefined;

  const trades: Trade[] = [];
  let warmingUp = 0;
  let barsEvaluated = 0;

  let position: { entryIndex: number; entryPrice: number } | null = null;

  // The final bar can only ever close a position: an entry signalled there has no bar to
  // fill against, and pretending otherwise would fill at a price that did not exist yet.
  for (let i = 0; i < bars.length - 1; i += 1) {
    barsEvaluated += 1;
    const vector = panel.at(i);
    const previous = i > 0 ? panel.at(i - 1) : undefined;

    if (position) {
      const held = i - position.entryIndex;
      const bar = bars[i];
      let exit: { price: number; reason: ExitReason } | null = null;

      // Stop is checked before target. From OHLC alone the intrabar path is unknown, so the
      // adverse outcome is assumed — the alternative flatters every strategy with both.
      if (stopLoss !== undefined && bar.low <= position.entryPrice * (1 - stopLoss)) {
        exit = { price: position.entryPrice * (1 - stopLoss), reason: "stop_loss" };
      } else if (takeProfit !== undefined && bar.high >= position.entryPrice * (1 + takeProfit)) {
        exit = { price: position.entryPrice * (1 + takeProfit), reason: "take_profit" };
      } else if (dsl.exit.afterDays !== undefined && held >= dsl.exit.afterDays) {
        exit = { price: bar.close, reason: "time_limit" };
      } else if (dsl.exit.condition && evaluate(dsl.exit.condition, vector, previous) === true) {
        exit = { price: bar.close, reason: "condition" };
      }

      if (exit) {
        trades.push(closeTrade(position, i, bars, exit, roundTripCost));
        position = null;
      }
      continue;
    }

    const signal = evaluate(dsl.entry, vector, previous);
    if (signal === undefined) {
      warmingUp += 1;
      continue;
    }
    if (signal) {
      // Decided on this close, filled on the next open.
      position = { entryIndex: i + 1, entryPrice: bars[i + 1].open };
    }
  }

  if (position) {
    const last = bars.length - 1;
    trades.push(
      closeTrade(position, last, bars, { price: bars[last].close, reason: "end_of_data" }, roundTripCost),
    );
  }

  const fraction = options.inSampleFraction ?? 0.5;
  const split = Math.floor(trades.length * fraction);
  const inSampleReturns = trades.slice(0, split).map((trade) => trade.netReturn);
  const outOfSampleReturns = trades.slice(split).map((trade) => trade.netReturn);

  return {
    ok: true,
    trades,
    barsEvaluated,
    warmingUp,
    evidence: {
      inSampleReturns,
      outOfSampleReturns,
      // Staying in cash earns nothing. The series is generated here so it is guaranteed to
      // align one-for-one with the out-of-sample trades rather than being supplied loose.
      noTradeReturns: outOfSampleReturns.map(() => 0),
      datasetFingerprint: options.datasetFingerprint,
    },
  };
}

function closeTrade(
  position: { entryIndex: number; entryPrice: number },
  exitIndex: number,
  bars: readonly Candle[],
  exit: { price: number; reason: ExitReason },
  roundTripCost: number,
): Trade {
  const grossReturn = (exit.price - position.entryPrice) / position.entryPrice;
  return {
    entryIndex: position.entryIndex,
    entryTime: bars[position.entryIndex].time,
    entryPrice: position.entryPrice,
    exitIndex,
    exitTime: bars[exitIndex].time,
    exitPrice: exit.price,
    grossReturn,
    netReturn: grossReturn - roundTripCost,
    exitReason: exit.reason,
  };
}
