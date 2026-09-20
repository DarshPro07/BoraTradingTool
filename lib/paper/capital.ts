import type { Market } from "@/lib/market/types";
import { CostModelError, roundTripCost, type Viability } from "./cost-model";
import type { IndiaProduct } from "./fees";

/**
 * The owner's capital, and what it implies about how strategies may be shaped.
 *
 * ## Why the factory needed this
 *
 * `lib/factory/breed.ts` bred every candidate with `{ commissionBps: 3, slippageBps: 7 }` — a
 * 20 bps round trip — alongside `maxPositions: 10`. Both numbers are reasonable defaults for a
 * large account and neither was ever checked against the account that actually exists.
 *
 * At ₹1,000 split ten ways, each position is ₹100. The DP charge alone is ₹15.93 — **16% of the
 * position**, against an assumed 0.20%. Every candidate ever screened was optimised against a
 * cost that was wrong by up to eighty-fold, and no strategy is good enough to survive that gap.
 *
 * The fix is not a better strategy. It is admitting that position size is a precondition for
 * trading at all, and refusing to breed configurations the capital cannot carry.
 *
 * ## Slippage stays separate
 *
 * Statutory cost is measurable — published rates, arithmetic. Market impact is an estimate.
 * `costsForCapital` puts the measured part in `commissionBps` and leaves `slippageBps` as a
 * stated assumption, so a reader can always see which half of the number is a fact.
 */

/**
 * What the owner has said they are trading with.
 *
 * A constant rather than a settings table, deliberately: one figure, changed by editing one
 * line, is harder to leave stale than a form nobody revisits. It carries `statedOn` because the
 * owner has said this figure grows — a capital number without a date silently becomes a lie.
 */
export const OWNER_CAPITAL = Object.freeze({
  amount: 5_000,
  market: "IN" as Market,
  product: "DELIVERY" as IndiaProduct,
  statedOn: "2026-09-20",
  note:
    "Owner, 2026-09-20: \"let it first train on 25 or 50k and later once trained then we would give it the actual 5k\". " +
    "This is the REAL money figure and gates anything live. Training runs on TRAINING_CAPITAL. " +
    "Was ₹1,000 from 2026-08-08. Update the amount and the date together.",
});

/**
 * What the lab may breed and validate against while everything is paper.
 *
 * Separate from `OWNER_CAPITAL` on purpose. At ₹5,000 nothing can be held overnight — delivery
 * needs about ₹23,000 because of the flat DP charge — so every daily strategy was refused before
 * it could ever be judged, and the trials switch the owner turned on could never fire. Training at
 * the paper book's size lets a daily rule be measured; it does NOT make it tradable for real.
 *
 * A strategy validated here carries that basis in its record: going live additionally requires it
 * to be tradable at `OWNER_CAPITAL`, and that is the owner's decision, never the system's.
 */
export const TRAINING_CAPITAL = Object.freeze({
  amount: 25_000,
  market: "IN" as Market,
  product: "DELIVERY" as IndiaProduct,
  statedOn: "2026-09-20",
  note: "Paper-only training basis, matching the INR paper book. Owner may raise it to ₹50,000.",
});

/** Per-side market-impact assumption, in basis points. Not measured — stated. */
export const ASSUMED_SLIPPAGE_BPS = 7;

/**
 * Below this, a round trip costs more than half a percent and the position is too small to
 * carry a realistic edge. `costDrag` calls that MARGINAL; for *breeding* it is a refusal,
 * because a candidate optimised at the edge of viability has no room left for being wrong.
 */
const VIABLE: ReadonlySet<Viability> = new Set<Viability>(["WORKABLE", "COMFORTABLE"]);

/** Concurrent positions a portfolio may hold, however large the account. */
const MAX_POSITIONS = 20;

/**
 * The DSL caps a single position at 25% of the book (`lib/strategy/dsl.ts:188`), which is a risk
 * rule: no one name may sink the account. It has an arithmetic consequence nobody had drawn —
 * a compliant portfolio holds **at least four** positions.
 *
 * That collides with the cost structure. Cost pushes toward fewer, larger positions; the risk cap
 * pushes toward at least four. Both are right, and at small capital they are jointly unsatisfiable:
 * four positions each large enough to trade economically is the real floor for this market.
 */
export const MAX_POSITION_PCT = 25;
const MIN_POSITIONS = Math.ceil(100 / MAX_POSITION_PCT);

/**
 * Smallest position worth opening, in rupees. **Stated, not derived** — unlike everything else
 * here, which falls out of published rates.
 *
 * Intraday charges no flat fee, so cost alone would approve twenty ₹50 positions on a ₹1,000
 * account. Shares are indivisible: a ₹50 position cannot buy one share of most of the liquid NSE
 * universe, and a cost model that approves an unexecutable trade is worse than one that is merely
 * expensive. ₹500 buys at least one share across a usable slice of the market.
 *
 * Raise it if the traded universe is large-cap only; it is a granularity floor, not a risk rule.
 */
export const MIN_POSITION_VALUE = 500;

export interface CapitalInput {
  capital: number;
  positions: number;
  market: Market;
  product?: IndiaProduct;
  at?: Date;
}

export interface DslCosts {
  commissionBps: number;
  slippageBps: number;
}

/**
 * The DSL cost block implied by trading `capital` split across `positions`.
 *
 * `roundTripCostBps` computes `(commission + slippage) × 2`, treating both as per-side. The
 * measured statutory figure is already a full round trip, so it is halved to land back on a
 * per-side number that the engine's doubling restores.
 */
export function costsForCapital(input: CapitalInput): DslCosts {
  const positionSize = input.capital / Math.max(1, input.positions);
  const trip = roundTripCost({
    market: input.market,
    notional: positionSize,
    product: input.product,
    at: input.at,
  });

  return {
    commissionBps: Math.round((trip.pctOfNotional * 10_000) / 2),
    slippageBps: ASSUMED_SLIPPAGE_BPS,
  };
}

/**
 * The most positions this capital can carry while each one still trades economically.
 *
 * Throws when even a single undivided position is uneconomic. That is not a defensive edge
 * case — it is the answer at ₹1,000, and returning 0 or 1 instead would let the factory breed
 * against an account that cannot trade, which is how a system reports profitable strategies it
 * could never have executed.
 */
export function maxViablePositions(
  capital: number,
  options: { market: Market; product?: IndiaProduct; at?: Date },
): number {
  let best = 0;
  for (let positions = 1; positions <= MAX_POSITIONS; positions += 1) {
    const size = capital / positions;
    // Granularity before cost. Intraday's cost ratio is flat, so without this the loop would run
    // to the cap and approve positions too small to buy a single share.
    if (size < MIN_POSITION_VALUE) break;

    const trip = roundTripCost({
      market: options.market,
      notional: size,
      product: options.product,
      at: options.at,
    });
    if (VIABLE.has(classify(trip.pctOfNotional))) best = positions;
    else break;
  }

  if (best === 0) {
    const whole = roundTripCost({
      market: options.market,
      notional: capital,
      product: options.product,
      at: options.at,
    });
    throw new CostModelError(
      "POSITION_TOO_SMALL",
      `${Math.round(capital)} committed to a single position still costs ` +
        `${(whole.pctOfNotional * 100).toFixed(2)}% a round trip, so no split of it trades economically. ` +
        "This is a capital problem, not a strategy problem: no rule has an edge large enough to " +
        "clear that, and breeding against it would produce candidates that cannot be executed.",
    );
  }
  return best;
}

export interface ViableConfiguration {
  product: IndiaProduct;
  positions: number;
  positionSize: number;
  costPerRoundTripPct: number;
  reason: string;
}

/**
 * The product and position count this capital can actually trade.
 *
 * Delivery first, because it is the lower-risk product — an intraday position is squared off by
 * the broker at a time the market chooses, which converts a temporary drawdown into a realised
 * loss. Intraday is the fallback that makes a small account tradable at all, not the preference.
 *
 * The ordering matters: recommending intraday to an account that can afford delivery would be
 * pushing the owner into the riskier product to save a charge they can comfortably pay.
 */
export function viableConfiguration(capital: number, market: Market, at?: Date): ViableConfiguration {
  const products: IndiaProduct[] = ["DELIVERY", "INTRADAY"];

  for (const product of products) {
    let positions: number;
    try {
      positions = maxViablePositions(capital, { market, product, at });
    } catch {
      continue;
    }
    if (positions < MIN_POSITIONS) continue;

    const positionSize = capital / positions;
    return {
      product,
      positions,
      positionSize,
      costPerRoundTripPct: roundTripCost({ market, notional: positionSize, product, at }).pctOfNotional,
      reason:
        `${Math.round(capital)} supports ${positions} ${product.toLowerCase()} position(s) of ` +
        `${Math.round(positionSize)} each, costing ` +
        `${(roundTripCost({ market, notional: positionSize, product, at }).pctOfNotional * 100).toFixed(3)}% a round trip.`,
    };
  }

  const deliveryFloor = safeFloor(market, "DELIVERY", at);
  const intradayFloor = safeFloor(market, "INTRADAY", at);
  throw new CostModelError(
    "POSITION_TOO_SMALL",
    `${Math.round(capital)} cannot fund ${MIN_POSITIONS} positions of at least ${MIN_POSITION_VALUE} each — ` +
      `the ${MAX_POSITION_PCT}% concentration cap requires ${MIN_POSITIONS} positions, and a position below ` +
      `${MIN_POSITION_VALUE} cannot buy a share. Intraday becomes tradable at ` +
      `${intradayFloor === null ? "an unreachable figure" : intradayFloor.toLocaleString("en-IN")}, ` +
      `delivery at ${deliveryFloor === null ? "an unreachable figure" : deliveryFloor.toLocaleString("en-IN")}.`,
  );
}

function safeFloor(market: Market, product: IndiaProduct, at?: Date): number | null {
  try {
    return minimumTradableCapital({ market, product, at });
  } catch {
    return null;
  }
}

export interface BreedingBasis {
  capital: number;
  positions: number;
  /** The product the capital can actually trade — not necessarily the owner's preferred one. */
  product: IndiaProduct;
  /** True when the owner's stated capital cannot trade and a larger figure was assumed. */
  assumed: boolean;
  reason: string;
}

/**
 * The capital the strategy factory should breed against.
 *
 * At the owner's stated ₹1,000 nothing is viable, and the tempting response — refuse to breed —
 * is wrong. Research is not execution. A rule discovered now is still a rule when the account is
 * larger, and halting discovery until the capital arrives wastes the interval in which the
 * discovery could have been made.
 *
 * So it breeds at the smallest capital that actually trades, and says so. What it must never do
 * is breed at the owner's figure while quietly using someone else's cost assumption — that
 * produces candidates whose backtests are unreachable at the account they were bred for.
 */
export function breedingBasis(at?: Date): BreedingBasis {
  const options = { market: TRAINING_CAPITAL.market, product: TRAINING_CAPITAL.product, at };

  // Training capital, not the owner's real money (owner instruction 2026-09-20: train at 25k, fund
  // the real 5k later). Judging a daily rule at ₹5,000 refused it before it could be measured,
  // because delivery needs ~₹23,000. Whatever is validated here still has to clear OWNER_CAPITAL
  // before anything goes live — see `liveBasis`.
  try {
    const own = viableConfiguration(TRAINING_CAPITAL.amount, TRAINING_CAPITAL.market, at);
    return {
      capital: TRAINING_CAPITAL.amount,
      positions: own.positions,
      product: own.product,
      assumed: false,
      reason: `Training against ${TRAINING_CAPITAL.amount} (paper); the owner's real capital is ${OWNER_CAPITAL.amount}. ${own.reason}`,
    };
  } catch {
    // Not tradable at any product. Fall through and find the nearest figure that is.
  }

  // Doubling rather than solving: the viability function is piecewise (brokerage is capped, and
  // the granularity floor is a step), so a closed form would be wrong at the joins. Bounded,
  // because an unbounded search on a misconfigured market would spin.
  let capital = TRAINING_CAPITAL.amount;
  for (let step = 0; step < 40; step += 1) {
    capital *= 2;
    let found: ViableConfiguration;
    try {
      found = viableConfiguration(capital, TRAINING_CAPITAL.market, at);
    } catch {
      continue;
    }
    return {
      capital,
      positions: found.positions,
      product: found.product,
      assumed: true,
      reason:
        `The owner's stated capital of ${OWNER_CAPITAL.amount} cannot fund ${MIN_POSITIONS} positions of ` +
        `at least ${MIN_POSITION_VALUE}, which the ${MAX_POSITION_PCT}% concentration cap requires. ` +
        `Candidates are bred against ${capital} on ${found.product.toLowerCase()} instead. Their backtests ` +
        `are research, not a claim about what ${OWNER_CAPITAL.amount} would have earned.`,
    };
  }

  throw new CostModelError(
    "POSITION_TOO_SMALL",
    "No capital within forty doublings of the owner's figure trades economically. That indicates a " +
      "broken fee schedule rather than a small account.",
  );
}

/**
 * The smallest capital that satisfies the cost floor and the concentration cap together.
 *
 * This is the number the owner actually needs, and it is not a matter of opinion — it falls out
 * of the published fee schedule and this system's own risk rule.
 */
export function minimumTradableCapital(options: {
  market: Market;
  product?: IndiaProduct;
  at?: Date;
}): number {
  let capital = 1_000;
  for (let step = 0; step < 400; step += 1) {
    try {
      if (maxViablePositions(capital, options) >= MIN_POSITIONS) return capital;
    } catch {
      // Too small; keep climbing.
    }
    capital += 1_000;
  }
  throw new CostModelError(
    "POSITION_TOO_SMALL",
    "No capital up to 400,000 satisfies both the cost floor and the concentration cap.",
  );
}

/** Mirrors `costDrag`'s thresholds. Kept local so this module reads without following a call. */
function classify(costPerRoundTripPct: number): Viability {
  if (costPerRoundTripPct > 0.01) return "UNWORKABLE";
  if (costPerRoundTripPct > 0.005) return "MARGINAL";
  if (costPerRoundTripPct > 0.002) return "WORKABLE";
  return "COMFORTABLE";
}

/**
 * What the owner's REAL capital can trade — the basis any live proposal must clear.
 *
 * Training (`breedingBasis`) may validate a daily strategy at ₹25,000 of paper. Going live with it
 * is a different claim, and this is the figure that claim has to survive.
 */
export function liveBasis(at?: Date): { capital: number; product: IndiaProduct | null; reason: string } {
  try {
    const own = viableConfiguration(OWNER_CAPITAL.amount, OWNER_CAPITAL.market, at);
    return { capital: OWNER_CAPITAL.amount, product: own.product, reason: own.reason };
  } catch (caught) {
    return {
      capital: OWNER_CAPITAL.amount,
      product: null,
      reason: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

