import type { Candle } from "@/lib/providers/types";
import type { BacktestRefusal, ExitReason, Trade } from "./engine";

/**
 * Cross-sectional strategies — the ones that RANK a universe.
 *
 * ## Why this is a separate representation and not another DSL feature
 *
 * `fam_qc001_xsec_momentum` declares: "rank the eligible universe by lookback return (skipping the
 * most recent days to avoid short-term reversal) → hold the top N → rotate on a fixed cadence."
 *
 * The DSL cannot express that, and no feature would fix it. Its conditions are per-instrument
 * booleans — "is close above sma200?" — evaluated one symbol at a time. Ranking is a statement
 * about a symbol's position *relative to every other symbol at the same instant*, which no
 * per-symbol predicate can carry. Approximating a rank with an absolute threshold
 * (`momentum_60d > 15`) is a materially different and much looser strategy: it selects everything
 * above a line rather than the best N, so its position count varies with the market's mood instead
 * of being the fixed, capacity-bounded portfolio the family declares.
 *
 * So this is a small typed IR for one shape of strategy, deliberately NOT a general language.
 * Every field below corresponds to a dimension the pinned family already declares; there is no
 * knob here the contract does not name.
 *
 * ## Point-in-time by construction
 *
 * The score at a rebalance date reads bars strictly BEFORE that date, and `skipRecentDays` drops
 * the most recent ones on top of that — the family's own device for avoiding short-term reversal.
 * Positions are entered at the NEXT bar's open, the same decide-on-close/fill-on-next-open rule
 * both other engines follow, so a rank computed on a close can never be traded at that close.
 */

export type RankingMethod = "RAW_RETURN" | "VOL_SCALED_RETURN";

export interface CrossSectionalStrategy {
  name: string;
  description?: string;
  universe: { market: "US" | "NSE" | "BSE"; resolution: "D" };
  /** Trading days the ranking return is measured over. Family declares 20-120. */
  lookbackDays: number;
  /** Most recent days excluded from the measurement. Family declares 0-5. */
  skipRecentDays: number;
  ranking: RankingMethod;
  /** Hold the best (TOP) or the worst (BOTTOM) ranked names. */
  direction: "TOP" | "BOTTOM";
  /** How many names to hold. Family declares 5-20. */
  topN: number;
  /** Trading days between rotations. Family declares 5-10. */
  rebalanceDays: number;
  sizing: { maxPositionPct: number };
  costs: { commissionBps: number; slippageBps: number; assumedSpreadBps?: number };
}

export interface CrossSectionalTrade extends Trade {
  instrumentId: string;
  /** 1 = best ranked at the rebalance that opened this position. */
  rank: number;
  score: number;
}

export interface CrossSectionalRun {
  ok: true;
  trades: CrossSectionalTrade[];
  /** Instruments that carried enough history to be ranked at least once. */
  instrumentsRanked: number;
  /** Rotations actually performed. */
  rebalances: number;
  /**
   * Rebalances where FEWER than `topN` names could be ranked, so the portfolio was thinner than
   * declared. Reported because a "top 10" that was really a top 3 is a different strategy.
   */
  underfilledRebalances: number;
}

export type CrossSectionalResult = CrossSectionalRun | BacktestRefusal;

/** Enough names to make a ranking meaningful at all. Ranking 2 instruments is not a cross-section. */
export const MIN_UNIVERSE = 10;

function roundTripCost(strategy: CrossSectionalStrategy): number {
  const spread = strategy.costs.assumedSpreadBps ?? 0;
  return (2 * (strategy.costs.commissionBps + strategy.costs.slippageBps) + spread) / 10_000;
}

/** Standard deviation of consecutive returns across `bars[from..to]`, or null when undefined. */
function volatility(closes: readonly number[], from: number, to: number): number | null {
  const returns: number[] = [];
  for (let i = from + 1; i <= to; i += 1) {
    if (closes[i - 1] <= 0) return null;
    returns.push(closes[i] / closes[i - 1] - 1);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? sd : null;
}

interface Series {
  instrumentId: string;
  bars: readonly Candle[];
  indexByTime: Map<number, number>;
}

export function runCrossSectionalBacktest(
  strategy: CrossSectionalStrategy,
  dataset: Readonly<Record<string, readonly Candle[]>>,
): CrossSectionalResult {
  const warmup = strategy.lookbackDays + strategy.skipRecentDays + 1;

  const series: Series[] = [];
  for (const [instrumentId, bars] of Object.entries(dataset)) {
    if (bars.length < warmup) continue;
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
    bars.forEach((bar, index) => indexByTime.set(bar.time, index));
    series.push({ instrumentId, bars, indexByTime });
  }

  if (series.length < MIN_UNIVERSE) {
    return {
      ok: false,
      code: "INSUFFICIENT_BARS",
      message:
        `Only ${series.length} instrument(s) hold the ${warmup} bars this ranking needs; ` +
        `${MIN_UNIVERSE} is the minimum. A rank over a handful of names measures the handful, ` +
        "not the cross-section — widening the universe is an ingestion task, not a reason to " +
        "lower the bar.",
    };
  }

  // Deterministic order, and a single merged calendar so every name is ranked on the same dates.
  series.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
  const calendar = [...new Set(series.flatMap((item) => item.bars.map((bar) => bar.time)))].sort(
    (a, b) => a - b,
  );

  const cost = roundTripCost(strategy);
  const trades: CrossSectionalTrade[] = [];
  const ranked = new Set<string>();
  let rebalances = 0;
  let underfilled = 0;

  for (let day = warmup; day < calendar.length - 1; day += strategy.rebalanceDays) {
    const decisionTime = calendar[day];
    const entryTime = calendar[day + 1];
    const exitDay = Math.min(day + strategy.rebalanceDays, calendar.length - 1);
    const exitTime = calendar[exitDay];
    if (exitTime <= entryTime) break;

    const scored: { item: Series; score: number; entryIndex: number }[] = [];
    for (const item of series) {
      const decisionIndex = item.indexByTime.get(decisionTime);
      const entryIndex = item.indexByTime.get(entryTime);
      // A name that did not trade on the decision date or the entry date is simply not rankable
      // this rotation. Interpolating a price for it would invent a fill.
      if (decisionIndex === undefined || entryIndex === undefined) continue;

      // The window ENDS `skipRecentDays` before the decision bar: the family's own guard against
      // short-term reversal contaminating a momentum rank.
      const end = decisionIndex - strategy.skipRecentDays;
      const start = end - strategy.lookbackDays;
      if (start < 0) continue;

      const closes = item.bars.map((bar) => bar.close);
      if (closes[start] <= 0) continue;
      const rawReturn = closes[end] / closes[start] - 1;

      let score = rawReturn;
      if (strategy.ranking === "VOL_SCALED_RETURN") {
        const sd = volatility(closes, start, end);
        if (sd === null) continue;
        score = rawReturn / sd;
      }
      if (!Number.isFinite(score)) continue;
      scored.push({ item, score, entryIndex });
      ranked.add(item.instrumentId);
    }

    if (scored.length === 0) continue;
    rebalances += 1;

    scored.sort((a, b) =>
      strategy.direction === "TOP" ? b.score - a.score : a.score - b.score,
    );
    const held = scored.slice(0, strategy.topN);
    if (held.length < strategy.topN) underfilled += 1;

    held.forEach((holding, position) => {
      const { item, entryIndex } = holding;
      const exitIndex = item.indexByTime.get(exitTime);
      if (exitIndex === undefined || exitIndex <= entryIndex) return;

      // Fill on the NEXT bar's open, never the close the rank was computed on.
      const entryPrice = item.bars[entryIndex].open;
      const exitPrice = item.bars[exitIndex].close;
      if (entryPrice <= 0) return;

      const grossReturn = exitPrice / entryPrice - 1;
      const reason: ExitReason = "time_limit";
      trades.push({
        instrumentId: item.instrumentId,
        rank: position + 1,
        score: holding.score,
        entryIndex,
        entryTime,
        entryPrice,
        exitIndex,
        exitTime,
        exitPrice,
        grossReturn,
        netReturn: grossReturn - cost,
        exitReason: reason,
      });
    });
  }

  return {
    ok: true,
    trades,
    instrumentsRanked: ranked.size,
    rebalances,
    underfilledRebalances: underfilled,
  };
}
