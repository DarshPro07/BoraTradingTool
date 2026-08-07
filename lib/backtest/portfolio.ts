import type { Candle } from "@/lib/providers/types";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { roundTripCostBps } from "@/lib/strategy/dsl";
import type { GauntletEvidence } from "@/lib/strategy/gauntlet";
import { collectFeatures, evaluate, type BacktestRefusal, type ExitReason, type Trade } from "./engine";
import {
  UNAVAILABLE_FEATURES,
  buildFeaturePanel,
  isDerivable,
  type FeaturePanel,
  type FeatureVector,
} from "./features";

/**
 * Multi-instrument backtest.
 *
 * The single-instrument engine cannot express `maxPositions` — with one symbol there is only
 * ever one slot, so a strategy that would have been starved of capacity in reality looks
 * unconstrained. Running the universe together is what makes the position cap, and therefore
 * the strategy's real capacity, observable.
 *
 * Instruments are walked on a merged timeline so a signal is only ever evaluated against bars
 * that had actually printed by that moment. Per-instrument index pointers preserve the
 * decide-on-close/fill-on-next-open rule even when symbols have different trading calendars.
 */

export interface PortfolioTrade extends Trade {
  instrumentId: string;
}

export interface PortfolioRun {
  ok: true;
  trades: PortfolioTrade[];
  evidence: GauntletEvidence;
  /** Instruments in the dataset that produced at least one bar. */
  instrumentsEvaluated: number;
  /**
   * Signals dropped because every position slot was occupied. A large number here means the
   * reported returns describe a strategy that could not actually have taken them all.
   */
  signalsRejectedForCapacity: number;
}

export type PortfolioResult = PortfolioRun | BacktestRefusal;

export interface PortfolioOptions {
  inSampleFraction?: number;
  datasetFingerprint?: string;
}

const MIN_BARS = 30;

/**
 * The bar preceding `index` in this instrument's *own* series — deliberately not the previous
 * entry on the merged timeline, which may belong to an instrument on a different trading
 * calendar. Crossing events compare consecutive bars of one symbol; on its first bar there is
 * nothing to compare against, so the event is unknowable rather than false.
 */
function priorVector(item: Series, index: number): FeatureVector | undefined {
  return index > 0 ? item.panel.at(index - 1) : undefined;
}

/**
 * Whether this bar closes the position, and at what price. Extracted so the entry bar can be
 * tested by the same rules as every later bar — see the same-bar exit note in the main loop.
 *
 * Stop is checked before target: from OHLC alone the intrabar path is unknown, so the adverse
 * outcome is assumed rather than the flattering one.
 */
function exitFor(
  item: Series,
  position: OpenPosition,
  index: number,
  dsl: StrategyDsl,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
): { price: number; reason: ExitReason } | null {
  const bar = item.bars[index];
  const held = index - position.entryIndex;
  if (held < 0) return null;

  if (stopLoss !== undefined && bar.low <= position.entryPrice * (1 - stopLoss)) {
    return { price: position.entryPrice * (1 - stopLoss), reason: "stop_loss" };
  }
  if (takeProfit !== undefined && bar.high >= position.entryPrice * (1 + takeProfit)) {
    return { price: position.entryPrice * (1 + takeProfit), reason: "take_profit" };
  }
  if (dsl.exit.afterDays !== undefined && held >= dsl.exit.afterDays) {
    return { price: bar.close, reason: "time_limit" };
  }
  if (dsl.exit.condition && evaluate(dsl.exit.condition, item.panel.at(index), priorVector(item, index)) === true) {
    return { price: bar.close, reason: "condition" };
  }
  return null;
}

interface Series {
  instrumentId: string;
  bars: readonly Candle[];
  panel: FeaturePanel;
  /** Bar index by timestamp, so the merged walk stays O(1) per instrument. */
  indexByTime: Map<number, number>;
}

interface OpenPosition {
  instrumentId: string;
  entryIndex: number;
  entryPrice: number;
}

export function runPortfolioBacktest(
  dsl: StrategyDsl,
  dataset: Readonly<Record<string, readonly Candle[]>>,
  options: PortfolioOptions = {},
): PortfolioResult {
  const entries = Object.entries(dataset).filter(([, bars]) => bars.length > 0);
  if (entries.length === 0) {
    return { ok: false, code: "INSUFFICIENT_BARS", message: "The dataset contains no instruments with bars." };
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
        `Unsupported features: ${UNAVAILABLE_FEATURES.join(", ")}.`,
    };
  }

  const series: Series[] = [];
  for (const [instrumentId, bars] of entries) {
    if (bars.length < MIN_BARS) {
      return {
        ok: false,
        code: "INSUFFICIENT_BARS",
        message: `${instrumentId} has ${bars.length} bars; ${MIN_BARS} is the minimum.`,
      };
    }
    for (let i = 1; i < bars.length; i += 1) {
      if (bars[i].time <= bars[i - 1].time) {
        return {
          ok: false,
          code: "UNORDERED_BARS",
          message: `${instrumentId} has bars out of order at index ${i}. Re-sorting would hide a provider defect.`,
        };
      }
    }
    const indexByTime = new Map<number, number>();
    bars.forEach((candle, index) => indexByTime.set(candle.time, index));
    series.push({ instrumentId, bars, panel: buildFeaturePanel(bars), indexByTime });
  }

  // Deterministic order for slot contention. Arbitrary, and deliberately so: ranking
  // candidates by conviction is a strategy decision the DSL cannot yet express, and inventing
  // one here would silently become part of every result.
  series.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));

  const timeline = [...new Set(series.flatMap((item) => item.bars.map((bar) => bar.time)))].sort((a, b) => a - b);

  const roundTripCost = roundTripCostBps(dsl, 1) / 10_000;
  const stopLoss = dsl.exit.stopLossPct !== undefined ? dsl.exit.stopLossPct / 100 : undefined;
  const takeProfit = dsl.exit.takeProfitPct !== undefined ? dsl.exit.takeProfitPct / 100 : undefined;
  const maxPositions = dsl.universe.maxPositions;

  const open = new Map<string, OpenPosition>();
  const pendingEntry = new Map<string, number>(); // instrumentId → bar index to fill at
  const trades: PortfolioTrade[] = [];
  let signalsRejectedForCapacity = 0;

  for (const time of timeline) {
    // Instruments that closed a position on this bar. They are skipped in step 3: acting on
    // the very close that just ejected you assumes an instant turnaround, and the
    // single-instrument engine declines to assume it. The two must agree, or the parity gate
    // is checking two different strategies.
    const exitedThisBar = new Set<string>();

    // 1. Exits first, so a slot freed today can be reused today.
    for (const item of series) {
      const position = open.get(item.instrumentId);
      if (!position) continue;
      const index = item.indexByTime.get(time);
      if (index === undefined) continue;

      const exit = exitFor(item, position, index, dsl, stopLoss, takeProfit);
      if (exit) {
        trades.push(buildTrade(item, position, index, exit, roundTripCost));
        open.delete(item.instrumentId);
        exitedThisBar.add(item.instrumentId);
      }
    }

    // 2. Fill entries queued on the previous bar, subject to capacity.
    for (const item of series) {
      const fillIndex = pendingEntry.get(item.instrumentId);
      if (fillIndex === undefined) continue;
      const index = item.indexByTime.get(time);
      if (index !== fillIndex) continue;

      pendingEntry.delete(item.instrumentId);
      if (open.size >= maxPositions) {
        signalsRejectedForCapacity += 1;
        continue;
      }
      const opened: OpenPosition = {
        instrumentId: item.instrumentId,
        entryIndex: index,
        entryPrice: item.bars[index].open,
      };
      open.set(item.instrumentId, opened);

      // The bar that filled us can also eject us. Exits run before fills above, so without
      // this a position was never tested against its own entry bar — and a portfolio immune
      // to losing on the bar it entered reports a gentler drawdown than the strategy has.
      // The single-instrument engine has always tested it; this is what keeps them equal.
      const immediate = exitFor(item, opened, index, dsl, stopLoss, takeProfit);
      if (immediate) {
        trades.push(buildTrade(item, opened, index, immediate, roundTripCost));
        open.delete(item.instrumentId);
        exitedThisBar.add(item.instrumentId);
      }
    }

    // 3. Evaluate new signals last, so they cannot fill on the bar that produced them.
    for (const item of series) {
      if (open.has(item.instrumentId) || pendingEntry.has(item.instrumentId)) continue;
      if (exitedThisBar.has(item.instrumentId)) continue;
      const index = item.indexByTime.get(time);
      if (index === undefined || index >= item.bars.length - 1) continue;
      if (evaluate(dsl.entry, item.panel.at(index), priorVector(item, index)) === true) {
        pendingEntry.set(item.instrumentId, index + 1);
      }
    }
  }

  // Close whatever is still open at the end of each instrument's own series.
  for (const item of series) {
    const position = open.get(item.instrumentId);
    if (!position) continue;
    const last = item.bars.length - 1;
    trades.push(
      buildTrade(item, position, last, { price: item.bars[last].close, reason: "end_of_data" }, roundTripCost),
    );
    open.delete(item.instrumentId);
  }

  trades.sort((a, b) => a.exitTime - b.exitTime || a.instrumentId.localeCompare(b.instrumentId));

  const fraction = options.inSampleFraction ?? 0.5;
  const split = Math.floor(trades.length * fraction);
  const outOfSampleReturns = trades.slice(split).map((trade) => trade.netReturn);

  return {
    ok: true,
    trades,
    instrumentsEvaluated: series.length,
    signalsRejectedForCapacity,
    evidence: {
      inSampleReturns: trades.slice(0, split).map((trade) => trade.netReturn),
      outOfSampleReturns,
      noTradeReturns: outOfSampleReturns.map(() => 0),
      datasetFingerprint: options.datasetFingerprint,
    },
  };
}

function buildTrade(
  item: Series,
  position: OpenPosition,
  exitIndex: number,
  exit: { price: number; reason: ExitReason },
  roundTripCost: number,
): PortfolioTrade {
  const grossReturn = (exit.price - position.entryPrice) / position.entryPrice;
  return {
    instrumentId: item.instrumentId,
    entryIndex: position.entryIndex,
    entryTime: item.bars[position.entryIndex].time,
    entryPrice: position.entryPrice,
    exitIndex,
    exitTime: item.bars[exitIndex].time,
    exitPrice: exit.price,
    grossReturn,
    netReturn: grossReturn - roundTripCost,
    exitReason: exit.reason,
  };
}
