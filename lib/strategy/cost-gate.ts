import { breedingBasis, costsForCapital, OWNER_CAPITAL } from "@/lib/paper/capital";
import type { IndiaProduct } from "@/lib/paper/fees";
import { roundTripCostBps, type StrategyDsl } from "./dsl";

/**
 * Does this strategy's backtest price the market the owner actually trades in?
 *
 * ## The gap nothing else covers
 *
 * `runBacktest` subtracts `roundTripCostBps(dsl)` from every trade, so a result is always net of
 * the cost its own DSL declares. That makes the arithmetic correct and the conclusion worthless
 * when the declared figure is wrong: a spec claiming 20 bps produces an honest profit curve for a
 * market that does not exist.
 *
 * The gauntlet cannot see this. It asks whether the edge survives resampling *given* the stated
 * cost; it has no view on whether the stated cost is real. Neither does the holdout, nor the
 * promotion ladder. So a candidate optimised against a fictional market could climb every rung
 * and arrive at owner review with five statistical tests behind it, all of them answering the
 * wrong question.
 *
 * Every strategy bred before `lib/paper/capital.ts` existed declares `{commissionBps: 3,
 * slippageBps: 7}` — 20 bps — against a real requirement several times that.
 *
 * ## Why understatement is the only direction that matters
 *
 * A strategy that overstates its costs understates its returns, and survives anyway. It is being
 * conservative, which is the direction this system prefers everywhere else. Only understatement
 * manufactures performance, so only understatement is refused.
 */

/** Tolerance in basis points. Rate schedules move; a strategy is not fiction for being 2 bps out. */
const TOLERANCE_BPS = 3;

export interface CostVerdict {
  declaredBps: number;
  requiredBps: number;
  understated: boolean;
  reason: string;
}

/**
 * The round-trip cost, in basis points, that a strategy must at least assume.
 *
 * Taken from the breeding basis rather than the owner's raw capital, because the basis is the
 * configuration that can actually be traded — and it is the same figure new candidates are bred
 * against, so a strategy is measured against the market its siblings were built for.
 */
export function requiredCostBps(product?: IndiaProduct): number {
  const basis = breedingBasis();
  // Priced at the strategy's OWN product when one is given. The basis carries a single product
  // (delivery at training capital), and pricing an intraday strategy as delivery made every honest
  // intraday spec look understated — the DP charge it will never pay (2026-09-20).
  const costs = costsForCapital({
    capital: basis.capital,
    positions: basis.positions,
    market: OWNER_CAPITAL.market,
    product: product ?? basis.product,
  });
  return roundTripCostBps({ costs } as StrategyDsl);
}

export function costStanding(dslJson: string, product?: IndiaProduct): CostVerdict {
  const required = requiredCostBps(product);

  let declared: number;
  try {
    const parsed = JSON.parse(dslJson) as { costs?: { commissionBps?: number; slippageBps?: number; assumedSpreadBps?: number } };
    const costs = parsed.costs;
    if (!costs || typeof costs.commissionBps !== "number" || typeof costs.slippageBps !== "number") {
      return {
        declaredBps: 0,
        requiredBps: required,
        understated: true,
        reason:
          "This spec declares no round-trip cost. Refused rather than treated as unknown: a missing " +
          `cost behaves exactly like a zero one, and produces the highest returns of any value. ` +
          `${required} bps is required at the owner's capital.`,
      };
    }
    declared = roundTripCostBps(parsed as StrategyDsl);
  } catch {
    return {
      declaredBps: 0,
      requiredBps: required,
      understated: true,
      reason:
        "This spec's DSL could not be parsed, so its declared cost cannot be read. Refused rather " +
        "than passed — defaulting to acceptance would let the one case nobody can inspect through.",
    };
  }

  const understated = declared + TOLERANCE_BPS < required;
  return {
    declaredBps: declared,
    requiredBps: required,
    understated,
    reason: understated
      ? `This strategy's backtest assumes ${declared} bps a round trip; the owner's capital costs ` +
        `${required} bps. Its returns are net of a market that does not exist, so its evidence does ` +
        `not describe anything tradable. Re-run it with honest costs rather than promoting it.`
      : `Assumes ${declared} bps a round trip against ${required} bps required — priced honestly or ` +
        `conservatively, so its evidence describes a market the owner can actually reach.`,
  };
}
