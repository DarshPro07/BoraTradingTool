import { describe, expect, it } from "vitest";
import { calculatePaperFees, feePolicyId, type PaperFeeInput } from "./fees";

function india(overrides: Partial<PaperFeeInput> = {}): PaperFeeInput {
  return { market: "IN", currency: "INR", side: "BUY", notional: 100_000, ...overrides };
}

describe("policy selection", () => {
  it("defaults India to delivery rather than the cheaper intraday regime", () => {
    // Guessing intraday without being told understates cost. Cost assumptions fail expensive.
    expect(feePolicyId("IN")).toBe("IN_EQUITY_DELIVERY_2026_01");
    expect(calculatePaperFees(india())).toBe(calculatePaperFees(india({ product: "DELIVERY" })));
  });

  it("selects the intraday policy when told the position is squared off", () => {
    expect(feePolicyId("IN", "INTRADAY")).toBe("IN_EQUITY_INTRADAY_2026_01");
  });

  it("ignores the product for US trades", () => {
    expect(feePolicyId("US", "INTRADAY")).toBe("US_EQUITY_2026_01");
  });
});

describe("India STT", () => {
  it("charges delivery STT on both sides", () => {
    // 0.1% of 100,000 = 100 on each side.
    expect(calculatePaperFees(india({ side: "BUY" }))).toBeGreaterThan(100);
    expect(calculatePaperFees(india({ side: "SELL" }))).toBeGreaterThan(100);
  });

  it("charges intraday STT on the sell side only", () => {
    const buy = calculatePaperFees(india({ side: "BUY", product: "INTRADAY" }));
    const sell = calculatePaperFees(india({ side: "SELL", product: "INTRADAY" }));
    // Sell carries 0.025% = 25 of STT that buy does not.
    expect(sell - buy).toBeCloseTo(25 - 100_000 * 0.00003, 1);
  });

  it("makes an intraday round trip cheaper, but by less than the STT difference alone", () => {
    // The STT difference is 17.5bps. The realised difference is about 14bps, because intraday
    // pays ₹40 of brokerage plus GST that delivery does not. Quoting the STT saving as the
    // cost saving overstates it by roughly a fifth.
    const deliveryRoundTrip =
      calculatePaperFees(india({ side: "BUY" })) + calculatePaperFees(india({ side: "SELL" }));
    const intradayRoundTrip =
      calculatePaperFees(india({ side: "BUY", product: "INTRADAY" })) +
      calculatePaperFees(india({ side: "SELL", product: "INTRADAY" }));

    const saving = deliveryRoundTrip - intradayRoundTrip;
    expect(saving).toBeGreaterThan(0.0013 * 100_000);
    expect(saving).toBeLessThan(0.00175 * 100_000);
  });
});

describe("India brokerage", () => {
  it("charges nothing for delivery", () => {
    // 0.1% STT + 0.00297% exchange + 0.0001% SEBI + 0.015% stamp + 18% GST on the last two.
    const expected = 100 + 2.97 + 0.1 + 15 + (2.97 + 0.1) * 0.18;
    expect(calculatePaperFees(india({ side: "BUY" }))).toBeCloseTo(expected, 2);
  });

  it("charges 0.03% intraday below the cap", () => {
    // 0.03% of 50,000 = 15, under the ₹20 cap.
    const fees = calculatePaperFees(india({ notional: 50_000, side: "BUY", product: "INTRADAY" }));
    const statutory = 50_000 * (0.0000297 + 0.000001 + 0.00003);
    expect(fees).toBeCloseTo(statutory + 15 + (15 + 50_000 * (0.0000297 + 0.000001)) * 0.18, 2);
  });

  it("caps intraday brokerage at 20 rupees per order however large the trade", () => {
    // A 10,000,000 notional would pay 3,000 at 0.03% without the cap.
    const large = calculatePaperFees(india({ notional: 10_000_000, side: "BUY", product: "INTRADAY" }));
    const statutory = 10_000_000 * (0.00003 + 0.0000297 + 0.000001);
    const gst = (20 + 10_000_000 * (0.0000297 + 0.000001)) * 0.18;
    expect(large).toBeCloseTo(statutory + 20 + gst, 1);
  });

  it("is proportional below the cap and fixed above it", () => {
    // ₹20 is a ceiling, not a floor. Below roughly ₹66,667 the 0.03% rate binds, so a small
    // trade is not penalised by a flat fee — and doubling it doubles the brokerage.
    // Cost per rupee of notional falls as size rises once the cap binds, and is flat below it.
    const smallRate = calculatePaperFees(india({ notional: 10_000, side: "BUY", product: "INTRADAY" })) / 10_000;
    const midRate = calculatePaperFees(india({ notional: 20_000, side: "BUY", product: "INTRADAY" })) / 20_000;
    const largeRate = calculatePaperFees(india({ notional: 1_000_000, side: "BUY", product: "INTRADAY" })) / 1_000_000;

    expect(smallRate).toBeCloseTo(midRate, 6);
    expect(largeRate).toBeLessThan(smallRate);
  });
});

describe("GST", () => {
  it("applies to brokerage and exchange charges but never to the statutory taxes", () => {
    const notional = 100_000;
    const fees = calculatePaperFees(india({ notional, side: "SELL", product: "INTRADAY" }));
    const stt = notional * 0.00025;
    const exchange = notional * 0.0000297;
    const sebi = notional * 0.000001;
    const brokerage = Math.min(20, notional * 0.0003);
    expect(fees).toBeCloseTo(stt + exchange + sebi + brokerage + (brokerage + exchange + sebi) * 0.18, 2);
  });
});

describe("US and edge cases", () => {
  it("charges the section 31 fee on sells only", () => {
    expect(calculatePaperFees({ market: "US", currency: "USD", side: "BUY", notional: 100_000 })).toBe(0);
    expect(calculatePaperFees({ market: "US", currency: "USD", side: "SELL", notional: 100_000 })).toBeCloseTo(2.78, 2);
  });

  it("returns zero for a non-positive or non-finite notional", () => {
    expect(calculatePaperFees(india({ notional: 0 }))).toBe(0);
    expect(calculatePaperFees(india({ notional: -1 }))).toBe(0);
    expect(calculatePaperFees(india({ notional: Number.NaN }))).toBe(0);
  });
});
