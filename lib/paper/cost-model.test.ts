import { describe, expect, it } from "vitest";
import { CostModelError, costDrag, feeSchedule, roundTripCost } from "./cost-model";

/**
 * The module that answers "can this earn at my capital?"
 *
 * `lib/paper/fees.ts` models STT, exchange, SEBI, stamp duty, brokerage and GST correctly — and
 * omits the one charge that decides the answer at small size. Zerodha's DP charge is
 * ₹13.50 + 18% GST ≈ ₹15.93 **per scrip, per day**, on delivery sells only, and it is flat: the
 * same rupees whether the position is ₹1,000 or ₹1,00,000.
 *
 * Flat charges do not scale down. Every percentage-based cost in the existing model is
 * size-neutral, which is exactly why their omission was invisible — and why every backtest in
 * this repository currently understates what trading would really cost.
 */

const IN = { market: "IN" as const, product: "DELIVERY" as const };

describe("the DP charge", () => {
  it("is charged on an India delivery sell", () => {
    const sell = roundTripCost({ ...IN, notional: 100_000 }).legs.sell;
    expect(sell.dpCharge).toBeCloseTo(15.93, 2);
  });

  it("is not charged on the buy leg", () => {
    // The demat debit happens on settlement of a sale. Buying incurs no DP charge.
    expect(roundTripCost({ ...IN, notional: 100_000 }).legs.buy.dpCharge).toBe(0);
  });

  it("is not charged on intraday, where nothing leaves the demat account", () => {
    const intraday = roundTripCost({ market: "IN", product: "INTRADAY", notional: 100_000 });
    expect(intraday.legs.sell.dpCharge).toBe(0);
  });

  it("is not charged on US equities, which have no Indian depository", () => {
    expect(roundTripCost({ market: "US", notional: 100_000 }).legs.sell.dpCharge).toBe(0);
  });

  it("is flat — identical rupees at every position size", () => {
    // The whole point. A percentage charge would scale; this one does not, which is why it
    // dominates small trades and vanishes on large ones.
    const small = roundTripCost({ ...IN, notional: 1_000 }).legs.sell.dpCharge;
    const large = roundTripCost({ ...IN, notional: 1_000_000 }).legs.sell.dpCharge;
    expect(small).toBe(large);
  });
});

describe("the round trip a ₹1,000 position actually pays", () => {
  const trip = roundTripCost({ ...IN, notional: 1_000 });

  it("costs roughly ₹18, nearly all of it the flat DP charge", () => {
    expect(trip.total).toBeGreaterThan(17);
    expect(trip.total).toBeLessThan(20);
    expect(trip.legs.sell.dpCharge / trip.total).toBeGreaterThan(0.8);
  });

  it("is about 1.8% of the position", () => {
    expect(trip.pctOfNotional).toBeGreaterThan(0.015);
    expect(trip.pctOfNotional).toBeLessThan(0.021);
  });

  it("never falls below the STT floor, however large the position", () => {
    // The correction that matters. Delivery STT is 0.1% on BOTH sides, so a round trip costs
    // ~0.2% in tax alone before any DP charge, brokerage or stamp duty. Scaling up dilutes the
    // flat DP charge to nothing but cannot go below this floor — at ₹25,000 the round trip is
    // still ~0.29%, and at ₹10,00,000 it is still ~0.22%.
    expect(roundTripCost({ ...IN, notional: 25_000 }).pctOfNotional).toBeCloseTo(0.0029, 3);
    expect(roundTripCost({ ...IN, notional: 1_000_000 }).pctOfNotional).toBeGreaterThan(0.002);
  });

  it("makes intraday cheaper per round trip than delivery, despite the brokerage", () => {
    // Intraday pays STT once at 0.025% and no DP charge; delivery pays 0.1% twice plus ₹15.93.
    const delivery = roundTripCost({ ...IN, notional: 25_000 }).pctOfNotional;
    const intraday = roundTripCost({ market: "IN", product: "INTRADAY", notional: 25_000 }).pctOfNotional;
    expect(intraday).toBeLessThan(delivery);
  });
});

describe("effective dating", () => {
  it("selects the schedule in force on the trade date", () => {
    const schedule = feeSchedule("IN", "DELIVERY", new Date("2026-06-01T00:00:00Z"));
    expect(schedule.id).toMatch(/IN_EQUITY_DELIVERY/);
  });

  it("refuses a date no schedule covers rather than guessing", () => {
    // Applying today's rates to 2015 silently misprices every trade in the backtest. A refusal
    // is recoverable; a wrong number that looks right is not.
    expect(() => feeSchedule("IN", "DELIVERY", new Date("2015-01-01T00:00:00Z"))).toThrow(
      CostModelError,
    );
  });

  it("names the window it could not serve", () => {
    expect(() => feeSchedule("IN", "DELIVERY", new Date("2015-01-01T00:00:00Z"))).toThrow(
      /2015-01-01/,
    );
  });
});

describe("capital viability", () => {
  it("calls ₹1,000 unworkable", () => {
    const drag = costDrag({ capital: 1_000, positions: 1, roundTripsPerYear: 12, ...IN });
    expect(drag.verdict).toBe("UNWORKABLE");
    expect(drag.reason).toMatch(/DP/i);
  });

  it("states the edge per trade needed just to break even", () => {
    const drag = costDrag({ capital: 1_000, positions: 1, roundTripsPerYear: 12, ...IN });
    // ~1.8% per round trip. Published daily equity edges are fractions of a percent.
    expect(drag.breakEvenEdgePct).toBeGreaterThan(0.015);
  });

  it("calls a ₹1,00,000 ten-position basket workable", () => {
    const drag = costDrag({ capital: 100_000, positions: 10, roundTripsPerYear: 12, ...IN });
    expect(["WORKABLE", "COMFORTABLE"]).toContain(drag.verdict);
  });

  it("reports the annual drag on capital, not only the per-trade cost", () => {
    const drag = costDrag({ capital: 100_000, positions: 10, roundTripsPerYear: 12, ...IN });
    // ₹10,000 per position, so ~₹38 a round trip — ₹20 of it STT, which scales with notional and
    // therefore does NOT shrink as the flat DP charge does. 10 × 12 × ₹38 ≈ ₹4,580, or 4.6% of
    // capital surrendered every year before a single rupee of profit.
    expect(drag.annualCostPct).toBeGreaterThan(0.04);
    expect(drag.annualCostPct).toBeLessThan(0.05);
  });

  it("gets worse with turnover, not better", () => {
    const slow = costDrag({ capital: 100_000, positions: 10, roundTripsPerYear: 4, ...IN });
    const fast = costDrag({ capital: 100_000, positions: 10, roundTripsPerYear: 52, ...IN });
    expect(fast.annualCostPct).toBeGreaterThan(slow.annualCostPct);
  });

  it("finds the capital at which the position size becomes viable", () => {
    const drag = costDrag({ capital: 1_000, positions: 1, roundTripsPerYear: 12, ...IN });
    expect(drag.viableAtCapital).toBeGreaterThan(1_000);
    // Suggesting a threshold is only useful if that threshold actually clears the bar.
    const atThreshold = costDrag({
      capital: drag.viableAtCapital,
      positions: 1,
      roundTripsPerYear: 12,
      ...IN,
    });
    expect(atThreshold.verdict).not.toBe("UNWORKABLE");
  });

  it("refuses a position size below one rupee rather than reporting a ratio", () => {
    expect(() => costDrag({ capital: 10, positions: 100, roundTripsPerYear: 12, ...IN })).toThrow(
      CostModelError,
    );
  });
});
