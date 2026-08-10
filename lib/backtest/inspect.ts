import type { Candle } from "@/lib/providers/types";
import { CostModelError, roundTripCost } from "@/lib/paper/cost-model";
import { marketOf, type Condition, type StrategyDsl } from "@/lib/strategy/dsl";
import { buildFeaturePanel, isDerivable, type FeatureVector } from "./features";
import { runPortfolioBacktest, type PortfolioTrade } from "./portfolio";
import type { ExecutionAssumption } from "./engine";

/**
 * Per-trade inspection: why did this trade exist, what happened, and where did the money go?
 *
 * A backtest that reports only aggregates is unauditable — a wrong entry rule, a fee mispricing
 * and a deadline violation all hide equally well inside a summary Sharpe. This module re-derives,
 * for every trade, the three answers a human needs to check the machine:
 *
 *   1. **Why it existed** — the feature values on the signal bar, and each entry clause's own
 *      verdict against them. The signal bar is `entryIndex - 1`: decisions are made on the close
 *      of the bar before the fill, and inspecting the fill bar would show the trader information
 *      they did not have.
 *   2. **What happened** — entry, exit, reason, and the path between them: MFE (the best the trade
 *      ever looked) and MAE (the worst), from the bars actually held.
 *   3. **Where the money went** — gross vs net, decomposed by the same fee engine the backtest
 *      charged, at an explicit one-share quantity. The decomposition is statutory / flat DP /
 *      total, which is what the engine actually models — it is NOT itemised into STT/GST/stamp
 *      lines, because inventing a finer split than the model computes would be fabricated
 *      precision wearing an audit's clothes.
 */

export interface ClauseVerdict {
  /** The clause as written, e.g. "gap_pct gte 3". */
  clause: string;
  /** The feature's value on the signal bar, or null when it was not derivable there. */
  observed: number | null;
  passed: boolean | null;
}

export interface TradeInspection {
  index: number;
  instrumentId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
  /** Per-unit returns, as the engine graded them. */
  grossReturn: number;
  netReturn: number;
  /** Signal-bar evidence: every feature the entry references, valued. */
  signal: { feature: string; value: number | null }[];
  clauses: ClauseVerdict[];
  /** Best and worst excursion over the held bars, as fractions of entry price. */
  mfe: number | null;
  mae: number | null;
  /**
   * Economics at quantity 1 — stated, not implied. Null when no verified fee schedule covers the
   * trade's date: a 2023 trade priced with 2026 rates would be a confident wrong number, and a
   * crash (which is what this was — the owner's dev log showed the 500) hides every OTHER trade's
   * evidence behind one unpriceable one. The trade is still shown; only its costing abstains.
   */
  economics: {
    quantityAssumed: 1;
    notional: number;
    grossPnl: number;
    statutoryFees: number;
    dpCharge: number;
    totalFees: number;
    netPnl: number;
    feeScheduleId: string;
  } | null;
  /** Why economics is null, when it is. */
  economicsUnavailable?: string;
}

export interface InspectionReport {
  ok: true;
  specName: string;
  trades: TradeInspection[];
  execution: ExecutionAssumption | null;
  summary: string;
}

export interface InspectionRefusal {
  ok: false;
  code: string;
  message: string;
}

/** Leaf clauses of a condition tree, with the text a human reads. Shared with the forward evaluator. */
export function conditionLeaves(
  condition: Condition,
): { clause: string; feature: string; evaluate: (v: FeatureVector) => boolean | null }[] {
  return leaves(condition);
}

function leaves(condition: Condition): { clause: string; feature: string; evaluate: (v: FeatureVector) => boolean | null }[] {
  if ("feature" in condition) {
    return [
      {
        clause: `${condition.feature} ${condition.op} ${condition.value}`,
        feature: condition.feature,
        evaluate: (vector) => {
          const value = vector[condition.feature as keyof FeatureVector];
          if (value === undefined) return null;
          switch (condition.op) {
            case "gt": return value > condition.value;
            case "gte": return value >= condition.value;
            case "lt": return value < condition.value;
            case "lte": return value <= condition.value;
          }
        },
      },
    ];
  }
  if ("compare" in condition) {
    return [
      {
        clause: `${condition.compare[0]} ${condition.op} ${condition.compare[1]}`,
        feature: condition.compare[0],
        evaluate: (vector) => {
          const left = vector[condition.compare[0] as keyof FeatureVector];
          const right = vector[condition.compare[1] as keyof FeatureVector];
          if (left === undefined || right === undefined) return null;
          switch (condition.op) {
            case "gt": return left > right;
            case "gte": return left >= right;
            case "lt": return left < right;
            case "lte": return left <= right;
          }
        },
      },
    ];
  }
  if ("crossover" in condition || "crossunder" in condition) {
    const pair = "crossover" in condition ? condition.crossover : condition.crossunder;
    const kind = "crossover" in condition ? "crossover" : "crossunder";
    // A crossing is between two bars; a single-bar verdict would be wrong, so it is reported
    // as informational (null) rather than faked.
    return [{ clause: `${kind}(${pair[0]}, ${pair[1]})`, feature: pair[0], evaluate: () => null }];
  }
  if ("not" in condition) return leaves(condition.not);
  const children = "all" in condition ? condition.all : condition.any;
  return children.flatMap(leaves);
}

export function inspectTrades(
  specName: string,
  dsl: StrategyDsl,
  dataset: Readonly<Record<string, readonly Candle[]>>,
): InspectionReport | InspectionRefusal {
  const backtest = runPortfolioBacktest(dsl, dataset);
  if (!backtest.ok) return { ok: false, code: backtest.code, message: backtest.message };

  const entryLeaves = leaves(dsl.entry);
  const market = marketOf(dsl.universe.market);
  const panels = new Map<string, ReturnType<typeof buildFeaturePanel>>();
  const barsById = new Map<string, readonly Candle[]>(Object.entries(dataset));

  const trades: TradeInspection[] = backtest.trades.map((trade: PortfolioTrade, index) => {
    const bars = barsById.get(trade.instrumentId) ?? [];
    let panel = panels.get(trade.instrumentId);
    if (!panel && bars.length > 0) {
      panel = buildFeaturePanel(bars, { market, resolution: dsl.universe.resolution });
      panels.set(trade.instrumentId, panel);
    }

    // The signal bar: the decision was made on the close BEFORE the fill.
    const signalIndex = trade.entryIndex - 1;
    const vector = panel && signalIndex >= 0 ? panel.at(signalIndex) : ({} as FeatureVector);

    const signal = [...new Set(entryLeaves.map((leaf) => leaf.feature))]
      .filter((feature) => isDerivable(feature))
      .map((feature) => ({ feature, value: (vector[feature as keyof FeatureVector] as number | undefined) ?? null }));

    const clauses: ClauseVerdict[] = entryLeaves.map((leaf) => ({
      clause: leaf.clause,
      observed: (vector[leaf.feature as keyof FeatureVector] as number | undefined) ?? null,
      passed: leaf.evaluate(vector),
    }));

    // Excursions over the held window, entry bar to exit bar inclusive.
    let mfe: number | null = null;
    let mae: number | null = null;
    if (bars.length > 0 && trade.exitIndex >= trade.entryIndex) {
      let high = -Infinity;
      let low = Infinity;
      for (let i = trade.entryIndex; i <= Math.min(trade.exitIndex, bars.length - 1); i += 1) {
        if (bars[i].high > high) high = bars[i].high;
        if (bars[i].low < low) low = bars[i].low;
      }
      mfe = (high - trade.entryPrice) / trade.entryPrice;
      mae = (low - trade.entryPrice) / trade.entryPrice;
    }

    // Economics at an explicit quantity of one share — the engine grades per-unit returns, and a
    // quantity would be an invention. Stated on the object so nobody mistakes it for sizing.
    //
    // Priced at the trade's own date. When no verified schedule covers it (pre-2024 bars), the
    // refusal is caught PER TRADE: the inspection continues with economics abstaining, instead of
    // one unpriceable trade taking down the whole report as a 500.
    const notional = trade.entryPrice;
    let trip: ReturnType<typeof roundTripCost> | null = null;
    let economicsUnavailable: string | undefined;
    try {
      trip = roundTripCost({
        market,
        notional,
        product: dsl.universe.resolution === "D" ? "DELIVERY" : "INTRADAY",
        at: new Date(trade.entryTime * 1000),
      });
    } catch (caught) {
      if (caught instanceof CostModelError) economicsUnavailable = caught.message;
      else throw caught;
    }
    const grossPnl = (trade.exitPrice - trade.entryPrice) * 1;

    return {
      index,
      instrumentId: trade.instrumentId,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      exitReason: trade.exitReason,
      grossReturn: trade.grossReturn,
      netReturn: trade.netReturn,
      signal,
      clauses,
      mfe,
      mae,
      economics:
        trip === null
          ? null
          : {
              quantityAssumed: 1,
              notional,
              grossPnl: round2(grossPnl),
              statutoryFees: round2(trip.legs.buy.statutory + trip.legs.sell.statutory),
              dpCharge: round2(trip.legs.sell.dpCharge),
              totalFees: round2(trip.total),
              netPnl: round2(grossPnl - trip.total),
              feeScheduleId: trip.scheduleId,
            },
      economicsUnavailable,
    };
  });

  const wins = trades.filter((trade) => trade.netReturn > 0).length;
  return {
    ok: true,
    specName,
    trades,
    execution: backtest.execution,
    summary: `${trades.length} trade(s), ${wins} net-positive, across ${backtest.instrumentsEvaluated} instrument(s). Economics shown at quantity 1.`,
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
