import type { Market } from "@/lib/market/types";
import { OWNER_BROKER, type BrokerId } from "@/lib/broker/execution-profile";
import { PAPER_FEE_POLICIES, calculatePaperFees, type IndiaProduct } from "./fees";

/**
 * Effective-dated cost schedules, flat per-trade charges, and the capital-viability answer.
 *
 * ## Why this exists beside `fees.ts` rather than inside it
 *
 * `fees.ts` prices **one leg** and is consumed by the paper engine, which is part of the risk
 * kernel. Its per-leg contract is correct and its callers depend on it. What was missing is a
 * layer above it: the round trip, the flat charges that only make sense per settlement, the
 * schedule-by-date lookup, and the arithmetic that turns all of it into "can this earn at my
 * capital?". Those are questions about a *strategy*, not about a fill.
 *
 * ## The charge that changes the answer
 *
 * Every cost in `fees.ts` is percentage-based, so every one of them is size-neutral — which is
 * exactly why the omission below was invisible. Zerodha's **DP charge is flat**:
 * ₹13.50 + 18% GST ≈ ₹15.93 per scrip per day, on delivery sells only, split CDSL ₹3.50 /
 * broker ₹10.25, collected on settlement when shares leave the demat account.
 *
 * Flat charges do not scale down. On a ₹1,00,000 position it is 0.016% and irrelevant. On a
 * ₹1,000 position it is **1.6%**, which is an order of magnitude larger than the edge published
 * daily-equity strategies claim. Omitting it means every backtest in this repository has been
 * understating real cost — and understating cost is the one direction a cost model must never err.
 *
 * ## Conservative by construction
 *
 * DP is charged on *every* delivery sell leg. In reality it is per scrip per day, so selling the
 * same scrip twice in one day is charged once. Modelling that would need position-level state the
 * cost layer does not have, and the error runs expensive: a strategy that passes under this model
 * also passes under the real one. `fees.ts` makes the same choice for the same reason.
 */

export class CostModelError extends Error {
  constructor(
    readonly code: "NO_SCHEDULE_IN_FORCE" | "POSITION_TOO_SMALL",
    message: string,
  ) {
    super(message);
    this.name = "CostModelError";
  }
}

export interface FeeSchedule {
  id: string;
  label: string;
  /** Whose rate card this row is. The pre-broker rows were implicitly Zerodha; now it is stated. */
  broker: BrokerId;
  market: Market;
  product: IndiaProduct | null;
  /** ISO date this schedule takes effect. */
  effectiveFrom: string;
  /** ISO date it stops applying, or null while it is current. */
  effectiveTo: string | null;
  /** Flat charge per scrip per settlement, before GST. Zero where the concept does not apply. */
  dpChargePerScrip: number;
  gstRate: number;
  /**
   * This broker's own brokerage terms, where they differ from the Zerodha figures embedded in
   * `fees.ts`. Priced as a delta at round-trip time so the risk-kernel-adjacent per-leg pricer
   * stays untouched. Absent = the fees.ts figures are already this broker's.
   */
  brokerage?: { rate: number; cap: number };
  source: string;
}

/**
 * Rate history, keyed by the window it was in force.
 *
 * Deliberately shallow: only the currently verified schedule is listed. Back-filling a rate
 * history that has not been checked against exchange circulars would produce confident historical
 * costs that are wrong, which is worse than a refusal — see `feeSchedule` below. Add windows as
 * they are verified; the mechanism is here so that adding one is data, not code.
 */
/**
 * Identity of the fee model an experiment ran under (13b manifest field).
 *
 * Bump when a schedule is added, corrected or superseded — two experiments with different
 * FEE_MODEL_IDs priced the same trade differently and are not comparable.
 */
export const FEE_MODEL_ID = "fee-schedules-2026-08-09";

export const FEE_SCHEDULES: readonly FeeSchedule[] = Object.freeze([
  {
    id: PAPER_FEE_POLICIES.IN_EQUITY_DELIVERY_2026_01.id,
    label: PAPER_FEE_POLICIES.IN_EQUITY_DELIVERY_2026_01.label,
    broker: "ZERODHA",
    market: "IN",
    product: "DELIVERY",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    // One source for the number: the fee policy the paper engine also fills through.
    dpChargePerScrip: PAPER_FEE_POLICIES.IN_EQUITY_DELIVERY_2026_01.dpChargePerScrip,
    gstRate: PAPER_FEE_POLICIES.IN_EQUITY_DELIVERY_2026_01.gstRate,
    source: "Zerodha published charges, retrieved 2026-08-08",
  },
  {
    id: PAPER_FEE_POLICIES.IN_EQUITY_INTRADAY_2026_01.id,
    label: PAPER_FEE_POLICIES.IN_EQUITY_INTRADAY_2026_01.label,
    broker: "ZERODHA",
    market: "IN",
    product: "INTRADAY",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    // Nothing leaves the demat account on an intraday square-off, so no DP charge arises.
    dpChargePerScrip: 0,
    gstRate: PAPER_FEE_POLICIES.IN_EQUITY_INTRADAY_2026_01.gstRate,
    source: "Zerodha published charges, retrieved 2026-08-08",
  },
  {
    id: PAPER_FEE_POLICIES.US_EQUITY_2026_01.id,
    label: PAPER_FEE_POLICIES.US_EQUITY_2026_01.label,
    broker: "US_EXCHANGE_ONLY",
    market: "US",
    product: null,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    dpChargePerScrip: 0,
    gstRate: 0,
    source: "SEC Section 31 fee schedule",
  },
  {
    id: "UPSTOX_IN_EQUITY_INTRADAY_2026_08",
    label: "Upstox equity intraday",
    broker: "UPSTOX",
    market: "IN",
    product: "INTRADAY",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    dpChargePerScrip: 0,
    gstRate: PAPER_FEE_POLICIES.IN_EQUITY_INTRADAY_2026_01.gstRate,
    // Rs 20 or 0.1% per order, whichever lower - from the owner's 2026-08-09 review citing
    // upstox.com/brokerage-charges; not independently fetched. Statutory legs are identical to
    // Zerodha's (they are exchange and government levies); only brokerage differs, priced as a delta.
    brokerage: { rate: 0.001, cap: 20 },
    source: "Upstox published charges, cited in owner review 2026-08-09 (not independently fetched)",
  },
]);

/** The broker a market's costs default to when a caller does not say. */
function defaultBrokerFor(market: Market): BrokerId {
  return market === "IN" ? OWNER_BROKER : "US_EXCHANGE_ONLY";
}

/**
 * The schedule in force on a given date.
 *
 * Refuses rather than falling back to the current one. Applying 2026 rates to a 2015 trade
 * misprices every fill in the backtest and reports a number that looks entirely reasonable — the
 * failure mode this whole file exists to prevent.
 */
export function feeSchedule(
  market: Market,
  product: IndiaProduct | null,
  at: Date,
  broker: BrokerId = defaultBrokerFor(market),
  records: readonly FeeSchedule[] = FEE_SCHEDULES,
): FeeSchedule {
  const day = at.toISOString().slice(0, 10);
  const found = records.find(
    (schedule) =>
      schedule.broker === broker &&
      schedule.market === market &&
      (market !== "IN" || schedule.product === (product ?? "DELIVERY")) &&
      day >= schedule.effectiveFrom &&
      (schedule.effectiveTo === null || day <= schedule.effectiveTo),
  );
  if (found) return found;

  const known = records.filter((s) => s.market === market)
    .map((s) => `${s.id} (${s.broker}) from ${s.effectiveFrom}`)
    .join("; ");
  throw new CostModelError(
    "NO_SCHEDULE_IN_FORCE",
    `No ${market} fee schedule covers ${broker} on ${day}. Known: ${known || "none"}. Rates are not ` +
      "back-filled or borrowed across brokers without verification, because a confident wrong cost " +
      "is worse than a refusal.",
  );
}

export interface LegCost {
  statutory: number;
  dpCharge: number;
  total: number;
}

export interface RoundTripInput {
  market: Market;
  notional: number;
  product?: IndiaProduct;
  at?: Date;
  /** Defaults to the owner's broker for IN, the exchange stand-in for US. */
  broker?: BrokerId;
}

export interface RoundTripCost {
  legs: { buy: LegCost; sell: LegCost };
  total: number;
  pctOfNotional: number;
  scheduleId: string;
}

export function roundTripCost(input: RoundTripInput): RoundTripCost {
  const at = input.at ?? new Date();
  const product = input.market === "IN" ? (input.product ?? "DELIVERY") : null;
  const schedule = feeSchedule(input.market, product, at, input.broker);

  const dp = round(schedule.dpChargePerScrip * (1 + schedule.gstRate));

  // A non-Zerodha broker's brokerage, as a per-leg delta against the Zerodha terms already inside
  // `calculatePaperFees`. Statutory charges (STT, exchange, SEBI, stamp) are identical across
  // brokers - they are government and exchange levies - so only brokerage and its GST move.
  let brokerageDeltaPerLeg = 0;
  if (schedule.brokerage) {
    const policy = PAPER_FEE_POLICIES.IN_EQUITY_INTRADAY_2026_01;
    const base = Math.min(policy.brokerageRate * input.notional, policy.brokerageCap);
    const theirs = Math.min(schedule.brokerage.rate * input.notional, schedule.brokerage.cap);
    brokerageDeltaPerLeg = (theirs - base) * (1 + schedule.gstRate);
  }

  const buyStatutory = calculatePaperFees({
    market: input.market,
    currency: input.market === "IN" ? "INR" : "USD",
    side: "BUY",
    notional: input.notional,
    product: product ?? undefined,
    // DP is itemized as its own line below; charging it inside the statutory figure too would
    // count it twice.
    includeDpCharge: false,
  });
  const sellStatutory = calculatePaperFees({
    market: input.market,
    currency: input.market === "IN" ? "INR" : "USD",
    side: "SELL",
    notional: input.notional,
    product: product ?? undefined,
    // DP is itemized as its own line below; charging it inside the statutory figure too would
    // count it twice.
    includeDpCharge: false,
  });

  const buy: LegCost = { statutory: buyStatutory, dpCharge: 0, total: round(buyStatutory + brokerageDeltaPerLeg) };
  const sell: LegCost = { statutory: sellStatutory, dpCharge: dp, total: round(sellStatutory + dp + brokerageDeltaPerLeg) };
  const total = round(buy.total + sell.total);

  return {
    legs: { buy, sell },
    total,
    pctOfNotional: input.notional > 0 ? total / input.notional : 0,
    scheduleId: schedule.id,
  };
}

export type Viability = "UNWORKABLE" | "MARGINAL" | "WORKABLE" | "COMFORTABLE";

export interface CostDragInput {
  capital: number;
  /** Concurrent positions. Capital is split evenly across them. */
  positions: number;
  /** Completed round trips per position per year. */
  roundTripsPerYear: number;
  market: Market;
  product?: IndiaProduct;
  at?: Date;
}

export interface CostDrag {
  positionSize: number;
  costPerRoundTrip: number;
  /** Cost of one round trip as a fraction of the position. The number an edge must beat. */
  costPerRoundTripPct: number;
  /** Total annual cost as a fraction of capital. */
  annualCostPct: number;
  /** Edge per trade required to break even, before any profit. */
  breakEvenEdgePct: number;
  verdict: Viability;
  /** Capital at which this configuration stops being UNWORKABLE. */
  viableAtCapital: number;
  reason: string;
}

/**
 * Thresholds set against the per-round-trip cost rather than the annual figure, because that is
 * the number a strategy's edge is compared with directly. Published daily-equity edges sit in the
 * low tenths of a percent per trade, so a 1% round trip is not "expensive" — it is disqualifying.
 */
function classify(costPerRoundTripPct: number): Viability {
  if (costPerRoundTripPct > 0.01) return "UNWORKABLE";
  if (costPerRoundTripPct > 0.005) return "MARGINAL";
  if (costPerRoundTripPct > 0.002) return "WORKABLE";
  return "COMFORTABLE";
}

export function costDrag(input: CostDragInput): CostDrag {
  const positionSize = input.capital / Math.max(1, input.positions);
  if (!Number.isFinite(positionSize) || positionSize < 1) {
    throw new CostModelError(
      "POSITION_TOO_SMALL",
      `${input.capital} split across ${input.positions} positions gives ${positionSize} per position. ` +
        "Below one rupee there is no trade to price, and a cost ratio would be arithmetic on nothing.",
    );
  }

  const trip = roundTripCost({
    market: input.market,
    notional: positionSize,
    product: input.product,
    at: input.at,
  });

  const annualCost = trip.total * input.positions * input.roundTripsPerYear;
  const verdict = classify(trip.pctOfNotional);

  // The position size at which the per-round-trip cost first clears the UNWORKABLE threshold,
  // found by walking upward rather than solved analytically: the statutory component is
  // proportional but brokerage is capped, so the function is piecewise.
  let viablePosition = positionSize;
  for (let i = 0; i < 200 && classify(roundTripCost({ ...input, notional: viablePosition }).pctOfNotional) === "UNWORKABLE"; i += 1) {
    viablePosition *= 1.25;
  }

  const flatShare = trip.legs.sell.dpCharge / Math.max(trip.total, 1e-9);
  const reason =
    verdict === "UNWORKABLE"
      ? `A round trip costs ${(trip.pctOfNotional * 100).toFixed(2)}% of a ${Math.round(positionSize)} position, ` +
        `and ${(flatShare * 100).toFixed(0)}% of that is the flat DP charge, which does not shrink with size. ` +
        `Published daily-equity edges are a fraction of a percent per trade, so this is disqualifying rather ` +
        `than merely expensive.`
      : `A round trip costs ${(trip.pctOfNotional * 100).toFixed(3)}% of a ${Math.round(positionSize)} position; ` +
        `annual drag is ${(annualCost / input.capital * 100).toFixed(2)}% of capital at ${input.roundTripsPerYear} ` +
        `round trips per position per year.`;

  return {
    positionSize: round(positionSize),
    costPerRoundTrip: trip.total,
    costPerRoundTripPct: trip.pctOfNotional,
    annualCostPct: annualCost / input.capital,
    // Break-even needs the round trip covered, so the required edge equals the round-trip cost.
    breakEvenEdgePct: trip.pctOfNotional,
    verdict,
    viableAtCapital: Math.ceil((viablePosition * Math.max(1, input.positions)) / 1_000) * 1_000,
    reason,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
