import type { Currency, Market } from "@/lib/market/types";

/**
 * Statutory charge models for paper fills.
 *
 * India taxes the same trade differently depending on how long it is held. A position closed
 * the same day is "speculative" and attracts STT of 0.025% on the sell side only; a position
 * carried overnight is "delivery" and attracts 0.1% on *both* sides. Charging delivery rates
 * to an intraday strategy costs it 20bps of round-trip STT instead of 2.5bps — an error of
 * 17.5bps per trade, which is larger than the edge most intraday strategies claim to have.
 *
 * That error is conservative: it makes a strategy look worse than it is, so a strategy that
 * passes under it would also pass under the correct rate. The non-conservative error is the
 * other one this file previously had — intraday brokerage of zero. Discount brokers charge
 * nothing for delivery, which is why the omission was invisible, but they charge the lower of
 * ₹20 and 0.03% per executed intraday order, plus GST on it.
 *
 * That brokerage claws back a large part of the STT saving: on a ₹100,000 round trip the STT
 * difference is 17.5bps but the realised difference is about 14bps, because intraday adds ₹40
 * of brokerage and its GST that delivery does not pay. ₹20 is a ceiling rather than a floor —
 * below roughly ₹66,667 of notional the 0.03% rate binds instead — so the charge is
 * proportional for small trades and fixed for large ones.
 *
 * DELIVERY remains the default so that existing recorded fills keep the fee policy they were
 * priced under. A cost model that changes retroactively makes old results incomparable.
 */

export type IndiaProduct = "DELIVERY" | "INTRADAY";

export const PAPER_FEE_POLICIES = Object.freeze({
  US_EQUITY_2026_01: {
    id: "US_EQUITY_2026_01",
    label: "Estimated US cash-equity regulatory fees",
    /** SEC Section 31 fee, sell side only. */
    sellRegulatoryRate: 0.0000278,
  },
  IN_EQUITY_DELIVERY_2026_01: {
    id: "IN_EQUITY_DELIVERY_2026_01",
    label: "Estimated India cash-equity delivery charges",
    /** STT: 0.1% on both sides for delivery. */
    sttRate: 0.001,
    sttSellOnly: false,
    exchangeRate: 0.0000297,
    sebiRate: 0.000001,
    stampDutyBuyRate: 0.00015,
    gstRate: 0.18,
    /** Discount brokers charge nothing for delivery. */
    brokerageRate: 0,
    brokerageCap: 0,
    /**
     * Depository charge per scrip on a delivery SELL: Zerodha's ₹13.50, GST on top ≈ ₹15.93.
     * Flat, so it dominates small trades — about 10% of a ₹150 round trip.
     */
    dpChargePerScrip: 13.5,
  },
  IN_EQUITY_INTRADAY_2026_01: {
    id: "IN_EQUITY_INTRADAY_2026_01",
    label: "Estimated India cash-equity intraday charges",
    /** STT: 0.025%, sell side only, for same-day squared-off positions. */
    sttRate: 0.00025,
    sttSellOnly: true,
    exchangeRate: 0.0000297,
    sebiRate: 0.000001,
    /** Intraday stamp duty is 0.003% buy side, not the 0.015% delivery rate. */
    stampDutyBuyRate: 0.00003,
    gstRate: 0.18,
    /** The lower of 0.03% and ₹20 per executed order. */
    brokerageRate: 0.0003,
    brokerageCap: 20,
  },
});

export function feePolicyId(market: Market, product: IndiaProduct = "DELIVERY"): string {
  if (market === "US") return "US_EQUITY_2026_01";
  return product === "INTRADAY" ? "IN_EQUITY_INTRADAY_2026_01" : "IN_EQUITY_DELIVERY_2026_01";
}

export interface PaperFeeInput {
  market: Market;
  currency: Currency;
  side: "BUY" | "SELL";
  notional: number;
  /**
   * India only. Defaults to DELIVERY: assuming the cheaper intraday regime without being told
   * the position is closed the same day would understate cost, and cost assumptions must fail
   * expensive rather than cheap.
   */
  product?: IndiaProduct;
  /**
   * Charge the depository fee a delivery SELL incurs. Defaults to true: the paper engine fills
   * through this function alone, and omitting DP made every small paper round trip ~₹16 cheaper
   * than the real one. `roundTripCost` passes false because it itemizes DP as its own line.
   */
  includeDpCharge?: boolean;
}

export function calculatePaperFees(input: PaperFeeInput): number {
  if (input.notional <= 0 || !Number.isFinite(input.notional)) return 0;

  if (input.market === "US") {
    const policy = PAPER_FEE_POLICIES.US_EQUITY_2026_01;
    // The FINRA trading activity fee is charged per share, not on notional, so it cannot be
    // derived here. It is small (capped at $8.30 per trade) and is knowingly omitted.
    return input.side === "SELL" ? roundMoney(input.notional * policy.sellRegulatoryRate) : 0;
  }

  const policy =
    input.product === "INTRADAY"
      ? PAPER_FEE_POLICIES.IN_EQUITY_INTRADAY_2026_01
      : PAPER_FEE_POLICIES.IN_EQUITY_DELIVERY_2026_01;

  const stt = policy.sttSellOnly && input.side === "BUY" ? 0 : input.notional * policy.sttRate;
  const exchange = input.notional * policy.exchangeRate;
  const sebi = input.notional * policy.sebiRate;
  const stamp = input.side === "BUY" ? input.notional * policy.stampDutyBuyRate : 0;
  const brokerage =
    policy.brokerageRate === 0 ? 0 : Math.min(policy.brokerageCap, input.notional * policy.brokerageRate);
  // GST applies to the broker's and exchange's charges, never to the statutory taxes.
  const gst = (brokerage + exchange + sebi) * policy.gstRate;
  // ponytail: DP is per scrip per DAY; two sells of one scrip in a day are charged twice here.
  // That errs expensive, as this file requires.
  const dp =
    input.product !== "INTRADAY" && input.side === "SELL" && input.includeDpCharge !== false
      ? PAPER_FEE_POLICIES.IN_EQUITY_DELIVERY_2026_01.dpChargePerScrip * (1 + policy.gstRate)
      : 0;

  return roundMoney(stt + exchange + sebi + stamp + brokerage + gst + dp);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
