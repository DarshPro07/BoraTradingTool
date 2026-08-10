import {
  executionProfileFor,
  OWNER_BROKER,
  type BrokerId,
  type ProductTypeId,
} from "@/lib/broker/execution-profile";
import type { Market } from "@/lib/market/types";
import { roundTripCost, CostModelError } from "./cost-model";
import type { IndiaProduct } from "./fees";

/**
 * Can this capital actually trade this instrument, with this broker, on this product, today?
 *
 * ## What this replaces
 *
 * `lib/paper/capital.ts` answers at the *capital* level with a Rs 500 "smallest sensible position"
 * proxy for "can it buy one share". That proxy is blind to the instrument: Rs 500 buys one share
 * of ITC (~Rs 400) and none of RELIANCE (~Rs 2,985). And leverage appears nowhere at all — a grep
 * for margin/VaR/ELM across lib/paper returned nothing — so the system could not even express the
 * question a margin-funded intraday account actually faces.
 *
 * ## What "honest about leverage" means
 *
 * SEBI's peak-margin regime caps intraday leverage at 5x, and the *actual* margin for a given
 * stock is VaR+ELM, which varies per instrument and is not held in this system. So:
 *
 *   - the **tradable verdict is cash-based** — it never assumes leverage that may not exist for
 *     this stock;
 *   - the leveraged share count is reported as an **upper bound**, labelled with the assumption
 *     it rests on, and never feeds the verdict.
 *
 * Missing is not zero, and it is not 5x either.
 */

export interface FeasibilityInput {
  market: Market;
  product: IndiaProduct;
  /** The instrument's current share price. The caller supplies it; this module has no feed. */
  sharePrice: number;
  /** Cash available for this position. */
  capital: number;
  at?: Date;
  broker?: BrokerId;
  /** Optional: assess a specific quantity instead of the maximum affordable. */
  quantity?: number;
}

export interface Measure {
  value: number | null;
  note?: string;
}

export interface FeasibilityVerdict {
  tradable: boolean;
  reason: string;
  /** Cash to buy the assessed quantity outright. */
  cashRequired: Measure;
  /** Margin the broker would demand. Null: per-stock VaR+ELM is not held here. */
  marginRequired: Measure;
  sharesPossibleCashOnly: number;
  /** Upper bound at the policy's max leverage. Never used for the verdict. */
  sharesPossibleAtMaxLeverage: { value: number | null; assumption: string };
  estimatedRoundTrip: { rupees: number; pctOfNotional: number } | null;
  /**
   * Smallest quantity whose round-trip cost stays at or under 0.5% of notional — the WORKABLE
   * line from the cost model. Null when no affordable quantity clears it.
   */
  minimumViableQuantity: number | null;
  /** What a broker-forced square-off would add, where the profile documents one. */
  autoSquareOffChargeIfForced: number | null;
  /** Every assumption this verdict rests on, stated. */
  assumptions: string[];
}

function productType(product: IndiaProduct): ProductTypeId {
  return product === "INTRADAY" ? "MIS" : "CNC";
}

export function assessFeasibility(input: FeasibilityInput): FeasibilityVerdict {
  const at = input.at ?? new Date();
  const broker = input.broker ?? OWNER_BROKER;
  const assumptions: string[] = [];

  if (!(input.sharePrice > 0) || !(input.capital > 0)) {
    return refusal("Share price and capital must both be positive to assess anything.", assumptions);
  }

  // The execution profile carries the margin policy and the forced-close charge. Its absence is a
  // verdict, not an exception: an instrument cannot be declared tradable under a broker/product
  // this system holds no rules for.
  const resolved =
    input.market === "IN"
      ? executionProfileFor({ broker, exchange: "NSE", segment: "EQ", product: productType(input.product), at })
      : executionProfileFor({ broker: "US_EXCHANGE_ONLY", exchange: "XNAS", segment: "EQ", product: "CASH", at });

  if (!resolved.available) {
    return refusal(
      `No execution profile covers this query, so no feasibility claim can be made. ${resolved.reason}`,
      assumptions,
    );
  }
  const profile = resolved.profile;
  assumptions.push(...profile.assumptions);

  const sharesCash = Math.floor(input.capital / input.sharePrice);
  const maxLeverage = profile.marginPolicy.maxLeverage;
  const sharesLeveraged =
    maxLeverage > 1 ? Math.floor((input.capital * maxLeverage) / input.sharePrice) : null;
  const leverageAssumption =
    maxLeverage > 1
      ? `Upper bound at the ${maxLeverage}x policy ceiling (${profile.marginPolicy.reference}). ` +
        "Actual per-stock MIS margin is VaR+ELM and is not held here, so this figure must not be " +
        "treated as available buying power."
      : "This product is fully funded; no leverage exists to bound.";

  const quantity = input.quantity ?? sharesCash;

  if (quantity < 1) {
    return {
      tradable: false,
      reason:
        `${money(input.capital)} cannot buy one share at ${money(input.sharePrice)}. ` +
        (sharesLeveraged !== null && sharesLeveraged >= 1
          ? `At ${maxLeverage}x leverage it could reach ${sharesLeveraged} share(s), but the verdict is ` +
            "cash-based because per-stock margin is unknown — leverage is reported, never assumed."
          : "Shares are indivisible; no configuration of this capital trades this instrument."),
      cashRequired: { value: round2(input.sharePrice), note: "for a single share" },
      marginRequired: { value: null, note: "Per-stock VaR+ELM margin is not held in this system." },
      sharesPossibleCashOnly: sharesCash,
      sharesPossibleAtMaxLeverage: { value: sharesLeveraged, assumption: leverageAssumption },
      estimatedRoundTrip: null,
      minimumViableQuantity: null,
      autoSquareOffChargeIfForced: forcedCharge(profile.autoSquareOffCharge),
      assumptions,
    };
  }

  const notional = quantity * input.sharePrice;
  let trip;
  try {
    trip = roundTripCost({ market: input.market, notional, product: input.product, at, broker: input.broker });
  } catch (caught) {
    if (caught instanceof CostModelError) {
      return refusal(`The fee engine refused this query: ${caught.message}`, assumptions);
    }
    throw caught;
  }

  // The smallest affordable quantity whose round trip stays at or under the 0.5% WORKABLE line.
  // Walked upward because the cost function is piecewise (caps and flat charges); a closed form
  // would be wrong at the joins.
  let minimumViableQuantity: number | null = null;
  for (let q = 1; q <= sharesCash; q += 1) {
    const candidate = roundTripCost({
      market: input.market,
      notional: q * input.sharePrice,
      product: input.product,
      at,
      broker: input.broker,
    });
    if (candidate.pctOfNotional <= 0.005) {
      minimumViableQuantity = q;
      break;
    }
  }

  const workable = trip.pctOfNotional <= 0.005;
  return {
    tradable: workable,
    reason: workable
      ? `${quantity} share(s) at ${money(input.sharePrice)} (${money(notional)}) costs ` +
        `${(trip.pctOfNotional * 100).toFixed(3)}% a round trip under ${profile.broker} ${profile.product} — ` +
        "within the 0.5% workable line. Verdict is cash-based; leverage is reported separately as a bound."
      : `${quantity} share(s) at ${money(input.sharePrice)} costs ${(trip.pctOfNotional * 100).toFixed(3)}% a ` +
        `round trip under ${profile.broker} ${profile.product}, above the 0.5% workable line. ` +
        (minimumViableQuantity !== null
          ? `It becomes workable at ${minimumViableQuantity} share(s).`
          : "No affordable quantity clears the line for this instrument."),
    cashRequired: { value: round2(notional) },
    marginRequired: { value: null, note: "Per-stock VaR+ELM margin is not held in this system." },
    sharesPossibleCashOnly: sharesCash,
    sharesPossibleAtMaxLeverage: { value: sharesLeveraged, assumption: leverageAssumption },
    estimatedRoundTrip: { rupees: trip.total, pctOfNotional: trip.pctOfNotional },
    minimumViableQuantity,
    autoSquareOffChargeIfForced: forcedCharge(profile.autoSquareOffCharge),
    assumptions,
  };
}

function refusal(reason: string, assumptions: string[]): FeasibilityVerdict {
  return {
    tradable: false,
    reason,
    cashRequired: { value: null, note: "Not assessed." },
    marginRequired: { value: null, note: "Not assessed." },
    sharesPossibleCashOnly: 0,
    sharesPossibleAtMaxLeverage: { value: null, assumption: "Not assessed." },
    estimatedRoundTrip: null,
    minimumViableQuantity: null,
    autoSquareOffChargeIfForced: null,
    assumptions,
  };
}

function forcedCharge(charge: { amount: number; gstRate: number } | null): number | null {
  return charge === null ? null : round2(charge.amount * (1 + charge.gstRate));
}

function money(value: number): string {
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
