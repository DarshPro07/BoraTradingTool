import { describe, expect, it } from "vitest";
import { parseInstrument } from "@/lib/market/instruments";
import type { DataQuality, NormalizedQuote } from "@/lib/market/types";
import { evaluatePaperOrder } from "./engine";
import type { PaperOrderIntent } from "./types";

function intent(overrides: Partial<PaperOrderIntent> = {}): PaperOrderIntent {
  return {
    instrument: parseInstrument("US:XNAS:AAPL"),
    side: "BUY",
    quantity: 10,
    orderType: "MARKET",
    idempotencyKey: "order-key-123",
    ...overrides,
  };
}

function quote(order = intent(), quality: DataQuality = "LIVE"): NormalizedQuote {
  return {
    instrument: order.instrument,
    price: order.instrument.currency === "USD" ? 100 : 1_000,
    open: 99,
    high: 101,
    low: 98,
    previousClose: 99,
    change: 1,
    changePct: 1,
    volume: 1_000_000,
    currency: order.instrument.currency,
    provenance: {
      provider: "TEST_FIXTURE",
      sourceEventAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      quality,
      delayedBySeconds: 0,
      sourceId: "fixture:quote",
    },
  };
}

function evaluate(order = intent(), overrides: { cash?: number; heldQuantity?: number; quality?: DataQuality; session?: "REGULAR" | "CLOSED" } = {}) {
  return evaluatePaperOrder(order, {
    quote: quote(order, overrides.quality),
    session: overrides.session ?? "REGULAR",
    cash: overrides.cash ?? 100_000,
    heldQuantity: overrides.heldQuantity ?? 0,
  });
}

describe("evaluatePaperOrder", () => {
  it("fills US and India market buys with market-specific slippage and fees", () => {
    const us = evaluate();
    expect(us).toMatchObject({ status: "FILLED", fillPrice: 100.05, fees: 0, feePolicy: "US_EQUITY_2026_01" });

    const indiaIntent = intent({ instrument: parseInstrument("IN:XNSE:RELIANCE") });
    const india = evaluate(indiaIntent);
    expect(india.status).toBe("FILLED");
    if (india.status === "FILLED") {
      expect(india.fillPrice).toBe(1000.8);
      expect(india.fees).toBeGreaterThan(0);
      expect(india.feePolicy).toBe("IN_EQUITY_DELIVERY_2026_01");
    }
  });

  it("does not cross-fund an INR order from USD cash", () => {
    const indiaIntent = intent({ instrument: parseInstrument("IN:XNSE:RELIANCE"), quantity: 2 });
    expect(evaluate(indiaIntent, { cash: 0 })).toMatchObject({ status: "REJECTED", reason: "INSUFFICIENT_CASH" });
  });

  it("rejects stale quotes, closed sessions, invalid quantities, and excess sells", () => {
    expect(evaluate(intent(), { quality: "STALE" })).toMatchObject({ reason: "INELIGIBLE_QUOTE" });
    expect(evaluate(intent(), { session: "CLOSED" })).toMatchObject({ reason: "MARKET_NOT_REGULAR" });
    expect(evaluate(intent({ quantity: Number.NaN }))).toMatchObject({ reason: "INVALID_QUANTITY" });
    expect(evaluate(intent({ side: "SELL" }), { heldQuantity: 1 })).toMatchObject({ reason: "INSUFFICIENT_HOLDINGS" });
  });

  it("expires an uncrossed immediate-or-expire limit and fills a crossed limit without slippage", () => {
    expect(evaluate(intent({ orderType: "LIMIT", limitPrice: 90 }))).toMatchObject({ status: "EXPIRED", reason: "LIMIT_NOT_REACHED" });
    expect(evaluate(intent({ orderType: "LIMIT", limitPrice: 101 }))).toMatchObject({ status: "FILLED", fillPrice: 100 });
  });
});

describe("paper fills pay what a real delivery sell pays", () => {
  it("charges the depository (DP) charge on an India delivery SELL, matching the cost model", async () => {
    // A real delivery sell pays a flat ~₹15.93 DP charge per scrip. The paper engine omitted it
    // while `roundTripCost` included it, so the two disagreed by ₹15.93 a round trip — about 10%
    // of a ₹150 position, the size the owner's ₹1,000 account allows. Paper P&L would have looked
    // ten points a trade better than reality, which is the one error a paper record must not make.
    const { roundTripCost } = await import("./cost-model");
    const sell = intent({ instrument: parseInstrument("IN:XNSE:RELIANCE"), side: "SELL", quantity: 1 });
    const filled = evaluate(sell, { heldQuantity: 1 });
    expect(filled.status).toBe("FILLED");
    if (filled.status !== "FILLED") return;

    const expected = roundTripCost({ market: "IN", notional: filled.fillPrice, product: "DELIVERY", broker: "ZERODHA" });
    expect(filled.fees, "the sell leg must carry the DP charge").toBeCloseTo(expected.legs.sell.total, 2);
  });
});
