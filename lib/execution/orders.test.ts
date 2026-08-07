import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { OrderBook, OrderRejected, type OrderRequest } from "./orders";

function bar(open: number, high: number, low: number, close: number, volume = 10_000, time = 1_700_000_000): Candle {
  return { time, open, high, low, close, volume };
}

function buyLimit(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    id: "o1",
    instrumentId: "AAA",
    side: "BUY",
    quantity: 100,
    type: "LIMIT",
    limitPrice: 99,
    ...overrides,
  };
}

describe("resting orders", () => {
  it("keeps an unreached limit working instead of expiring it", () => {
    // The existing paper engine returns EXPIRED here. A limit that has not been reached is
    // working — treating it as dead is why nothing in this system could rest an order.
    const book = new OrderBook();
    book.submit(buyLimit());
    const result = book.step(bar(105, 106, 100, 104), "AAA");

    expect(result.fills).toHaveLength(0);
    expect(book.get("o1")?.status).toBe("OPEN");
    expect(book.working()).toHaveLength(1);
  });

  it("fills once a later bar reaches the price", () => {
    const book = new OrderBook();
    book.submit(buyLimit());
    book.step(bar(105, 106, 100, 104), "AAA");
    const result = book.step(bar(101, 102, 98, 99, 10_000, 1_700_086_400), "AAA");

    expect(result.fills).toHaveLength(1);
    expect(book.get("o1")?.status).toBe("FILLED");
  });

  it("fills a buy limit at the limit, not at the last trade", () => {
    // Filling at the touch hands the passive order the spread for free and overstates every
    // scalping strategy, which lives on exactly that spread.
    const book = new OrderBook();
    book.submit(buyLimit({ limitPrice: 99 }));
    const result = book.step(bar(101, 102, 95, 96), "AAA");
    expect(result.fills[0].price).toBe(99);
  });

  it("gives a gapped-through limit the better opening price", () => {
    const book = new OrderBook();
    book.submit(buyLimit({ limitPrice: 99 }));
    const result = book.step(bar(95, 97, 94, 96), "AAA");
    expect(result.fills[0].price).toBe(95);
  });
});

describe("partial fills", () => {
  it("takes only a plausible share of the bar's volume", () => {
    // 10% of 500 = 50 of the 100 requested.
    const book = new OrderBook({ participationRate: 0.1 });
    book.submit(buyLimit({ quantity: 100 }));
    const result = book.step(bar(98, 99, 97, 98, 500), "AAA");

    expect(result.fills[0].quantity).toBe(50);
    expect(book.get("o1")?.status).toBe("PARTIALLY_FILLED");
    expect(book.get("o1")?.filledQuantity).toBe(50);
  });

  it("completes across bars and averages the fill price", () => {
    const book = new OrderBook({ participationRate: 0.1 });
    book.submit(buyLimit({ quantity: 100, limitPrice: 100 }));
    book.step(bar(98, 99, 97, 98, 500), "AAA");
    book.step(bar(96, 97, 95, 96, 500, 1_700_086_400), "AAA");

    const order = book.get("o1");
    expect(order?.status).toBe("FILLED");
    expect(order?.filledQuantity).toBe(100);
    // 50 at 98 and 50 at 96.
    expect(order?.averageFillPrice).toBeCloseTo(97, 10);
  });

  it("cancels a fill-or-kill that cannot be satisfied in one go", () => {
    const book = new OrderBook({ participationRate: 0.1 });
    book.submit(buyLimit({ quantity: 100, timeInForce: "FOK" }));
    book.step(bar(98, 99, 97, 98, 500), "AAA");
    expect(book.get("o1")?.status).toBe("CANCELLED");
  });

  it("releases the residual of an immediate-or-cancel order", () => {
    const book = new OrderBook({ participationRate: 0.1 });
    book.submit(buyLimit({ quantity: 100, timeInForce: "IOC" }));
    book.step(bar(98, 99, 97, 98, 500), "AAA");
    const order = book.get("o1");
    expect(order?.filledQuantity).toBe(50);
    expect(order?.status).toBe("FILLED");
    expect(book.working()).toHaveLength(0);
  });
});

describe("stops", () => {
  it("does not execute before the stop is touched", () => {
    const book = new OrderBook();
    book.submit({ id: "s1", instrumentId: "AAA", side: "SELL", quantity: 10, type: "STOP", stopPrice: 90 });
    const result = book.step(bar(100, 101, 95, 99), "AAA");
    expect(result.fills).toHaveLength(0);
    expect(book.get("s1")?.triggered).toBe(false);
  });

  it("executes on the bar that touches it, at the stop price", () => {
    const book = new OrderBook();
    book.submit({ id: "s1", instrumentId: "AAA", side: "SELL", quantity: 10, type: "STOP", stopPrice: 90 });
    const result = book.step(bar(100, 101, 89, 92), "AAA");

    expect(book.get("s1")?.triggered).toBe(true);
    expect(result.fills).toHaveLength(1);
    // Not 100. The bar's open predates the trigger; pricing there invents ten points.
    expect(result.fills[0].price).toBe(90);
  });

  it("takes the worse price when the bar gaps straight through the stop", () => {
    const book = new OrderBook();
    book.submit({ id: "s1", instrumentId: "AAA", side: "SELL", quantity: 10, type: "STOP", stopPrice: 90 });
    const result = book.step(bar(85, 86, 80, 84), "AAA");
    expect(result.fills[0].price).toBe(85);
  });

  it("prices a buy stop at the stop or above", () => {
    const book = new OrderBook();
    book.submit({ id: "s2", instrumentId: "AAA", side: "BUY", quantity: 10, type: "STOP", stopPrice: 110 });
    const result = book.step(bar(105, 115, 104, 114), "AAA");
    expect(result.fills[0].price).toBe(110);
  });
});

describe("linked orders", () => {
  it("cancels the sibling when a bracket leg fills", () => {
    // Without this, a filled target leaves a live stop behind and the account carries an
    // exit for a position it no longer holds.
    const book = new OrderBook();
    book.submit({ id: "target", instrumentId: "AAA", side: "SELL", quantity: 10, type: "LIMIT", limitPrice: 110, ocoGroupId: "bracket-1" });
    book.submit({ id: "stop", instrumentId: "AAA", side: "SELL", quantity: 10, type: "STOP", stopPrice: 90, ocoGroupId: "bracket-1" });

    const result = book.step(bar(105, 112, 104, 111), "AAA");
    expect(result.fills.map((fill) => fill.orderId)).toEqual(["target"]);
    expect(book.get("stop")?.status).toBe("CANCELLED");
    expect(book.get("stop")?.reason).toMatch(/target/);
  });

  it("holds a child order until its parent has filled", () => {
    const book = new OrderBook();
    book.submit({ id: "entry", instrumentId: "AAA", side: "BUY", quantity: 10, type: "LIMIT", limitPrice: 90 });
    book.submit({ id: "exit", instrumentId: "AAA", side: "SELL", quantity: 10, type: "LIMIT", limitPrice: 95, parentId: "entry" });

    // Price reaches the child's level but the parent never filled — the exit must not fire.
    const result = book.step(bar(96, 99, 94, 97), "AAA");
    expect(result.fills).toHaveLength(0);
    expect(book.get("exit")?.status).toBe("OPEN");
  });
});

describe("time in force", () => {
  it("expires a day order at the session boundary", () => {
    const book = new OrderBook();
    book.submit(buyLimit());
    book.step(bar(105, 106, 100, 104), "AAA");
    const closed = book.endOfSession();
    expect(closed).toHaveLength(1);
    expect(book.get("o1")?.status).toBe("EXPIRED");
  });

  it("carries a good-till-cancelled order across the session boundary", () => {
    const book = new OrderBook();
    book.submit(buyLimit({ timeInForce: "GTC" }));
    book.step(bar(105, 106, 100, 104), "AAA");
    book.endOfSession();
    expect(book.get("o1")?.status).toBe("OPEN");
  });
});

describe("validation", () => {
  it("rejects a non-positive quantity", () => {
    expect(() => new OrderBook().submit(buyLimit({ quantity: 0 }))).toThrow(OrderRejected);
  });

  it("rejects a limit order with no limit price", () => {
    expect(() => new OrderBook().submit(buyLimit({ limitPrice: undefined }))).toThrow(/limit price/);
  });

  it("rejects a stop order with no stop price", () => {
    expect(() =>
      new OrderBook().submit({ id: "x", instrumentId: "AAA", side: "SELL", quantity: 1, type: "STOP" }),
    ).toThrow(/stop price/);
  });

  it("rejects a duplicate order id", () => {
    const book = new OrderBook();
    book.submit(buyLimit());
    expect(() => book.submit(buyLimit())).toThrow(/already exists/);
  });

  it("ignores bars for other instruments", () => {
    const book = new OrderBook();
    book.submit(buyLimit());
    const result = book.step(bar(90, 91, 89, 90), "BBB");
    expect(result.fills).toHaveLength(0);
    expect(book.get("o1")?.status).toBe("OPEN");
  });
});
