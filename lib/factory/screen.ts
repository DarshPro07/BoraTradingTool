import { runBacktest } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/providers/types";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { profitFactor, sharpeRatio } from "@/lib/strategy/statistics";

/**
 * The Factory's cheap pre-filter: breed many, keep few.
 *
 * A screen exists because the gauntlet is expensive and, more importantly, *costly* — every
 * gauntlet run permanently raises the statistical bar for that strategy family. So candidates
 * are ranked here first and only the survivors are put forward.
 *
 * The trap this module exists to avoid: screening two hundred candidates and gauntleting the
 * best one is not one trial, it is two hundred. The selection happened at the screen. A system
 * that breeds a large population, buries most of it, and then deflates the winner's Sharpe
 * against a denominator of 1 has not controlled for multiple testing at all — it has merely
 * moved the search somewhere the accounting could not see it.
 *
 * `selectionCost` is that missing number, and `runGauntlet` requires it back.
 */

export interface Candidate {
  id: string;
  dsl: StrategyDsl;
  /**
   * The spec this was mutated or crossed from, when it descends from one.
   *
   * Carried so `runFactoryGeneration` can place the survivor in its parent's research family. A
   * bred candidate with no family cannot be validated — `runGauntlet` refuses it — so a factory
   * that discarded parentage would breed strategies that could never be tested.
   */
  parentSpecId?: string;
  /** `mut` | `cross` | `gen`. `gen` descends from nothing and is a genuinely new idea. */
  lineage?: string;
}

export interface ScreenScore {
  id: string;
  trades: number;
  profitFactor: number;
  sharpe: number;
  totalNetReturn: number;
}

export interface ScreenRefusal {
  id: string;
  code: string;
  message: string;
}

export interface ScreenReport {
  /** Ranked best first, capped at `keep` and filtered by the minimum bars. */
  survivors: ScreenScore[];
  /** Every candidate that produced a comparable number, ranked. Survivors are a prefix. */
  scored: ScreenScore[];
  /** Candidates that could not be evaluated at all. */
  refused: ScreenRefusal[];
  /**
   * How many evaluations this selection was made from — the multiple-testing denominator to
   * carry into the gauntlet.
   *
   * Refusals are excluded deliberately. A candidate that produced no statistic could not have
   * been chosen on the strength of one, so counting it would inflate the bar without cause.
   */
  selectionCost: number;
}

export interface ScreenOptions {
  /** How many survivors to carry forward. Default 5. */
  keep?: number;
  /** Minimum trades before a candidate's numbers mean anything. Default 30, matching GATES. */
  minTrades?: number;
  /** Minimum profit factor to survive. Default 1, i.e. it must at least not lose money. */
  minProfitFactor?: number;
}

function score(id: string, returns: number[]): ScreenScore {
  return {
    id,
    trades: returns.length,
    profitFactor: profitFactor(returns),
    sharpe: sharpeRatio(returns),
    totalNetReturn: returns.reduce((total, value) => total + value, 0),
  };
}

/**
 * Ranks a population against one instrument's bars. Deterministic: the same population and
 * bars always produce the same ranking, so a generation can be replayed exactly.
 */
export function screenPopulation(
  candidates: readonly Candidate[],
  bars: readonly Candle[],
  options: ScreenOptions = {},
): ScreenReport {
  const { keep = 5, minTrades = 30, minProfitFactor = 1 } = options;

  const scored: ScreenScore[] = [];
  const refused: ScreenRefusal[] = [];

  for (const candidate of candidates) {
    const result = runBacktest(candidate.dsl, bars);
    if (!result.ok) {
      refused.push({ id: candidate.id, code: result.code, message: result.message });
      continue;
    }
    scored.push(score(candidate.id, result.trades.map((trade) => trade.netReturn)));
  }

  // Sharpe, not total return: a screen that ranks on total return promotes whichever candidate
  // happened to trade most, which is a proxy for turnover rather than for edge. Ties break on
  // id so the ordering is stable rather than dependent on input order.
  scored.sort((a, b) => b.sharpe - a.sharpe || a.id.localeCompare(b.id));

  const survivors = scored
    .filter((entry) => entry.trades >= minTrades && entry.profitFactor >= minProfitFactor)
    .slice(0, keep);

  return { survivors, scored, refused, selectionCost: scored.length };
}
