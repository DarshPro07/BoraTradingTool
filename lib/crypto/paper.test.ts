import { describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { ASSUMED_NETWORK_FEE_USDC, decideCryptoOrder } from "./paper";

const token = { verified: true, decimals: 9 };
const base = {
  token,
  cash: 300,
  startingCash: 300,
  heldQuantity: 0,
  heldCostBasis: 0,
  ordersToday: 0,
};
/** 20 USDC -> 0.1 SOL (price 200), 0.2% impact. */
const buyQuote = { inAmount: 20e6, outAmount: 0.1e9, priceImpact: 0.002 };

describe("decideCryptoOrder", () => {
  it("fills a buy at the quote's own price and charges the network fee", () => {
    const d = decideCryptoOrder({ ...base, side: "BUY", quote: buyQuote, amount: 20 });
    expect(d).toMatchObject({ status: "FILLED", quantity: 0.1, fillPrice: 200 });
    if (d.status === "FILLED") expect(d.cashDelta).toBeCloseTo(-(20 + ASSUMED_NETWORK_FEE_USDC), 9);
  });

  it.each([
    ["an unverified token", { token: { verified: false, decimals: 9 } }, "UNVERIFIED_TOKEN"],
    ["a quote that moves the market more than 1%", { quote: { ...buyQuote, priceImpact: 0.02 } }, "PRICE_IMPACT_TOO_HIGH"],
    ["more than the cash", { amount: 400 }, "INSUFFICIENT_CASH"],
    ["a position over 25% of capital", { amount: 80 }, "CRYPTO_POSITION_CAP"],
    ["the eleventh order of the day", { ordersToday: 10 }, "CRYPTO_DAILY_ORDER_CAP"],
  ] as const)("refuses %s", (_label, over, reason) => {
    const d = decideCryptoOrder({ ...base, side: "BUY", quote: buyQuote, amount: 20, ...over } as never);
    expect(d).toEqual({ status: "REJECTED", reason });
  });

  it("refuses to sell what is not held", () => {
    const d = decideCryptoOrder({ ...base, side: "SELL", quote: { inAmount: 1e9, outAmount: 200e6, priceImpact: 0 }, amount: 1, heldQuantity: 0.5 });
    expect(d).toEqual({ status: "REJECTED", reason: "INSUFFICIENT_HOLDINGS" });
  });
});

describe("placeCryptoPaperOrder", () => {
  useTemporaryDatabase();

  it("round-trips a paper swap against quoted prices and records realized P&L", async () => {
    const jupiter = await import("./jupiter");
    const spy = vi
      .spyOn(jupiter, "getSwapQuote")
      .mockResolvedValueOnce({ inAmount: 20e6, outAmount: 0.1e9, priceImpact: 0.001, route: "Test" })
      // Sell 0.1 SOL for 22 USDC: price moved 200 -> 220.
      .mockResolvedValueOnce({ inAmount: 0.1e9, outAmount: 22e6, priceImpact: 0.001, route: "Test" });
    const { placeCryptoPaperOrder } = await import("./paper");
    const sol = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL", decimals: 9, verified: true, usdPrice: 200, liquidityUsd: 1e9 };

    const buy = await placeCryptoPaperOrder({ token: sol, side: "BUY", amount: 20, thesis: "test", idempotencyKey: "c-buy-1" });
    const sell = await placeCryptoPaperOrder({ token: sol, side: "SELL", amount: 0.1, thesis: "test", idempotencyKey: "c-sell-1" });
    expect(buy.order.status).toBe("FILLED");
    expect(sell.order.status).toBe("FILLED");

    const account = getDb().select().from(schema.cryptoPaperAccounts).get()!;
    // 300 - 20.02 + (22 - 0.02) = 301.96
    expect(account.cash).toBeCloseTo(301.96, 6);
    const position = getDb().select().from(schema.cryptoPaperPositions).get()!;
    expect(position.quantity).toBeCloseTo(0, 12);
    expect(position.realizedPnl, "22 - 0.02 proceeds against a 20.02 cost basis").toBeCloseTo(1.96, 6);

    const replay = await placeCryptoPaperOrder({ token: sol, side: "SELL", amount: 0.1, thesis: "test", idempotencyKey: "c-sell-1" });
    expect(replay.replay).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
