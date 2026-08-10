import { describe, expect, it } from "vitest";
import { feeSchedule, roundTripCost } from "./cost-model";
import { assessFeasibility } from "./feasibility";

/**
 * Feasibility must be per-instrument, per-broker, per-product and per-date — and honest about
 * what it does not know, which is per-stock margin.
 *
 * The review's example drives the fixtures: "With Rs 1,000, which instruments can actually be
 * traded today under my broker's current margin rules?" A capital-level answer with a Rs 500
 * proxy cannot answer that; RELIANCE and ITC differ by 7x in share price.
 */

const AT = new Date("2026-08-09T10:00:00Z");
const RELIANCE = 2985.5;
const ITC = 400;

describe("per-instrument dependence", () => {
  it("gives opposite answers for RELIANCE and ITC at Rs 1,000", () => {
    const reliance = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: RELIANCE, capital: 1000, at: AT });
    const itc = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: ITC, capital: 1000, at: AT });

    // Rs 1,000 cannot buy one RELIANCE share; it buys two of ITC. A Rs 500 constant sees neither.
    expect(reliance.tradable).toBe(false);
    expect(reliance.sharesPossibleCashOnly).toBe(0);
    expect(itc.sharesPossibleCashOnly).toBe(2);
    expect(itc.tradable).toBe(true);
  });

  it("still names the single-share cash requirement when refusing", () => {
    const verdict = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: RELIANCE, capital: 1000, at: AT });
    expect(verdict.cashRequired.value).toBeCloseTo(RELIANCE, 2);
    expect(verdict.reason).toMatch(/cannot buy one share/);
  });
});

describe("leverage is a labelled bound, never the verdict", () => {
  it("reports the 5x MIS ceiling as an upper bound with its assumption attached", () => {
    const verdict = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: RELIANCE, capital: 1000, at: AT });

    // 1000 * 5 / 2985.5 -> 1 share is possible at the ceiling. The verdict must still be false,
    // because per-stock VaR+ELM margin is unknown and missing is not 5x.
    expect(verdict.sharesPossibleAtMaxLeverage.value).toBe(1);
    expect(verdict.sharesPossibleAtMaxLeverage.assumption).toMatch(/must not be treated as available/i);
    expect(verdict.tradable).toBe(false);
  });

  it("reports no leverage bound for delivery, which is fully funded", () => {
    const verdict = assessFeasibility({ market: "IN", product: "DELIVERY", sharePrice: ITC, capital: 1000, at: AT });
    expect(verdict.sharesPossibleAtMaxLeverage.value).toBeNull();
    expect(verdict.sharesPossibleAtMaxLeverage.assumption).toMatch(/fully funded/i);
  });

  it("never states a margin requirement it does not hold", () => {
    const verdict = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: ITC, capital: 1000, at: AT });
    expect(verdict.marginRequired.value).toBeNull();
    expect(verdict.marginRequired.note).toMatch(/VaR\+ELM/);
  });
});

describe("product dependence", () => {
  it("attaches the forced-close charge to intraday and not to delivery", () => {
    const mis = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: ITC, capital: 5000, at: AT });
    const cnc = assessFeasibility({ market: "IN", product: "DELIVERY", sharePrice: ITC, capital: 5000, at: AT });

    // Rs 50 + 18% GST, from the fetched Zerodha documentation, via the execution profile.
    expect(mis.autoSquareOffChargeIfForced).toBe(59);
    expect(cnc.autoSquareOffChargeIfForced).toBeNull();
  });

  it("shows delivery's flat DP charge pushing small quantities over the workable line", () => {
    const mis = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: ITC, capital: 1000, at: AT });
    const cnc = assessFeasibility({ market: "IN", product: "DELIVERY", sharePrice: ITC, capital: 1000, at: AT });

    expect(mis.tradable).toBe(true);
    // Two ITC shares on delivery carry the Rs 15.93 DP charge — around 2% of Rs 800.
    expect(cnc.tradable).toBe(false);
    expect(cnc.estimatedRoundTrip!.pctOfNotional).toBeGreaterThan(0.015);
  });
});

describe("broker dependence flows through from the fee engine", () => {
  it("prices the same intraday trade differently for Upstox and Zerodha below the cap", () => {
    // Zerodha brokerage min(0.03%, 20)/order; Upstox min(0.1%, 20)/order per the owner's review.
    // At Rs 10,000 notional neither cap binds, so the difference must appear.
    const zerodha = roundTripCost({ market: "IN", notional: 10_000, product: "INTRADAY", at: AT, broker: "ZERODHA" });
    const upstox = roundTripCost({ market: "IN", notional: 10_000, product: "INTRADAY", at: AT, broker: "UPSTOX" });

    expect(upstox.total).toBeGreaterThan(zerodha.total);
    // Delta: (10 - 3) * 1.18 per leg, two legs = 16.52.
    expect(upstox.total - zerodha.total).toBeCloseTo(16.52, 1);
  });

  it("converges where both brokers' Rs 20 caps bind", () => {
    const zerodha = roundTripCost({ market: "IN", notional: 200_000, product: "INTRADAY", at: AT, broker: "ZERODHA" });
    const upstox = roundTripCost({ market: "IN", notional: 200_000, product: "INTRADAY", at: AT, broker: "UPSTOX" });
    expect(upstox.total).toBeCloseTo(zerodha.total, 2);
  });

  it("refuses an Upstox delivery lookup rather than borrowing Zerodha's card", () => {
    // Only Upstox intraday was cited in the review. Delivery is not added unverified, and the
    // lookup must refuse rather than silently answer with another broker's rates.
    expect(() => feeSchedule("IN", "DELIVERY", AT, "UPSTOX")).toThrow(/No IN fee schedule covers UPSTOX/);
  });
});

describe("date dependence and fail-closed", () => {
  it("refuses a 2023 date, which no schedule covers", () => {
    const verdict = assessFeasibility({
      market: "IN",
      product: "INTRADAY",
      sharePrice: ITC,
      capital: 5000,
      at: new Date("2023-06-01T10:00:00Z"),
    });
    expect(verdict.tradable).toBe(false);
    expect(verdict.reason).toMatch(/No execution profile covers|fee engine refused/);
  });

  it("carries the profile's own assumptions into the verdict", () => {
    const verdict = assessFeasibility({ market: "IN", product: "INTRADAY", sharePrice: ITC, capital: 5000, at: AT });
    expect(verdict.assumptions.join(" ")).toMatch(/non-CAS/);
  });

  it("finds the minimum viable quantity where one exists within the capital", () => {
    const verdict = assessFeasibility({ market: "IN", product: "DELIVERY", sharePrice: ITC, capital: 20_000, at: AT });
    // Somewhere below 50 shares of ITC, the Rs 15.93 flat DP charge dilutes under 0.5%.
    expect(verdict.minimumViableQuantity).not.toBeNull();
    expect(verdict.minimumViableQuantity!).toBeGreaterThan(1);
    const atMinimum = roundTripCost({
      market: "IN",
      notional: verdict.minimumViableQuantity! * ITC,
      product: "DELIVERY",
      at: AT,
    });
    expect(atMinimum.pctOfNotional).toBeLessThanOrEqual(0.005);
  });
});
