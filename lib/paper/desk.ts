/**
 * The trading desk's Risk role — AutoHedge's shape, MarketPulse's numbers.
 *
 * AutoHedge (The-Swarm-Corporation, MIT) runs a Director that hands off to Sentiment, Quant, Risk
 * and Execution agents, each an LLM prompt. Its risk agent is asked for "a recommended position
 * size" with nothing to compute it from. Here the role is arithmetic over the paper account's real
 * cash, the paper engine's real position cap and the real cost model, so no amount of conviction
 * upstream can size a trade the numbers do not support. See docs/plans/autohedge-intake.
 *
 * Long only: a cash-market delivery account cannot short. The paper engine remains the final
 * authority and re-checks everything here; this exists so the desk refuses BEFORE it asks, with a
 * reason a human can act on.
 */
import { roundTripCost } from "./cost-model";
import type { IndiaProduct } from "./fees";

/** Share of starting cash one trade may lose if its stop is hit. */
export const RISK_PER_TRADE = 0.02;
/** Expected gross move must be at least this multiple of the round-trip cost — the Foundry's hurdle. */
export const MIN_REWARD_TO_COST = 2;

export type DeskVerdict = "SIZED" | "UNAFFORDABLE" | "COST_EXCEEDS_EDGE" | "BAD_LEVELS";

export interface DeskSizing {
  verdict: DeskVerdict;
  quantity: number;
  notional: number;
  costTotal: number;
  /** Round-trip cost as a fraction of notional. */
  costPct: number;
  /** Gross gain if the target is hit. */
  rewardAmount: number;
  /** Gross loss if the stop is hit. */
  riskAmount: number;
  reason: string;
}

export function sizeDeskTrade(input: {
  cash: number;
  startingCash: number;
  /** The paper engine's cap, as a percent of starting cash. */
  maxPositionPct: number;
  entry: number;
  stop: number;
  target: number;
  product?: IndiaProduct;
  at?: Date;
}): DeskSizing {
  const { entry, stop, target } = input;
  const empty = { quantity: 0, notional: 0, costTotal: 0, costPct: 0, rewardAmount: 0, riskAmount: 0 };
  if (!(stop > 0 && stop < entry && entry < target)) {
    return { verdict: "BAD_LEVELS", ...empty, reason: `A long needs stop < entry < target; got ${stop} / ${entry} / ${target}.` };
  }

  const cap = Math.min((input.startingCash * input.maxPositionPct) / 100, input.cash);
  const byCap = Math.floor(cap / entry);
  if (byCap < 1) {
    return {
      verdict: "UNAFFORDABLE",
      ...empty,
      reason: `One share costs ₹${entry}; the position cap is ₹${cap.toFixed(0)} (${input.maxPositionPct}% of ₹${input.startingCash}).`,
    };
  }
  const byRisk = Math.floor((input.startingCash * RISK_PER_TRADE) / (entry - stop));
  const quantity = Math.max(1, Math.min(byCap, byRisk));

  const notional = quantity * entry;
  const cost = roundTripCost({ market: "IN", notional, product: input.product ?? "DELIVERY", at: input.at, broker: "ZERODHA" });
  const sized = {
    quantity,
    notional,
    costTotal: cost.total,
    costPct: cost.pctOfNotional,
    rewardAmount: (target - entry) * quantity,
    riskAmount: (entry - stop) * quantity,
  };
  if (sized.rewardAmount < MIN_REWARD_TO_COST * cost.total) {
    return {
      verdict: "COST_EXCEEDS_EDGE",
      ...sized,
      reason:
        `Target pays ₹${sized.rewardAmount.toFixed(2)} gross; the round trip costs ₹${cost.total.toFixed(2)} ` +
        `(${(cost.pctOfNotional * 100).toFixed(1)}% of ₹${notional.toFixed(0)}). Needs ${MIN_REWARD_TO_COST}x.`,
    };
  }
  return {
    verdict: "SIZED",
    ...sized,
    reason: `${quantity} share(s), ₹${notional.toFixed(0)}; risk ₹${sized.riskAmount.toFixed(2)}, cost ₹${cost.total.toFixed(2)}.`,
  };
}
