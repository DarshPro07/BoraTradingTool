import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { parseInstrument } from "@/lib/market/instruments";
import { updateAgentConfig } from "@/lib/trading/config";
import { getPaperPortfolio, listPaperOrders, placePaperOrder } from "./service";

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-paper-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "paper.db"));
  vi.stubEnv("MARKETPULSE_TEST_MODE", "1");
  closeDbForTests();
  updateAgentConfig({ watchlistOnly: false, maxPositionPct: 15, dailyTradeCap: 5 });
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("paper repository", () => {
  it("keeps USD and INR accounts independent and idempotent", async () => {
    const us = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 10,
      orderType: "MARKET",
      idempotencyKey: "us-order-0001",
    });
    const india = await placePaperOrder({
      instrument: parseInstrument("IN:XNSE:RELIANCE"),
      side: "BUY",
      quantity: 10,
      orderType: "MARKET",
      idempotencyKey: "in-order-0001",
    });
    const replay = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 10,
      orderType: "MARKET",
      idempotencyKey: "us-order-0001",
    });

    expect(us.order.status).toBe("FILLED");
    expect(us.order).toMatchObject({
      simulatedFixture: true,
      quoteProvider: "TEST_FIXTURE",
      quoteQuality: "LIVE",
    });
    expect(india.order.status).toBe("FILLED");
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.order.id).toBe(us.order.id);

    const portfolio = getPaperPortfolio();
    const usd = portfolio.accounts.find((account) => account.currency === "USD")!;
    const inr = portfolio.accounts.find((account) => account.currency === "INR")!;
    expect(usd.cash).toBeLessThan(usd.startingCash);
    expect(inr.cash).toBeLessThan(inr.startingCash);
    expect(portfolio.orders).toHaveLength(2);
    expect(portfolio.positions).toHaveLength(2);
  });

  it("enforces watchlist-only buys", async () => {
    updateAgentConfig({ watchlistOnly: true });
    const rejected = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "watchlist-reject-0001",
    });
    expect(rejected.order).toMatchObject({ status: "REJECTED", reason: "PAPER_WATCHLIST_REQUIRED" });

    getDb().insert(schema.userWatchlist).values({ ticker: "AAPL", addedAt: new Date() }).run();
    const accepted = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "watchlist-accept-0001",
    });
    expect(accepted.order.status).toBe("FILLED");
  });

  it("enforces the configured position and daily order caps", async () => {
    updateAgentConfig({ maxPositionPct: 0.1, dailyTradeCap: 5 });
    const concentrated = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 10_000,
      orderType: "MARKET",
      idempotencyKey: "position-cap-0001",
    });
    expect(concentrated.order).toMatchObject({ status: "REJECTED", reason: "PAPER_POSITION_CAP" });

    updateAgentConfig({ maxPositionPct: 15, dailyTradeCap: 1 });
    const first = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "daily-cap-first-0001",
    });
    const second = await placePaperOrder({
      instrument: parseInstrument("US:XNAS:MSFT"),
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "daily-cap-second-0001",
    });
    expect(first.order.status).toBe("FILLED");
    expect(second.order).toMatchObject({ status: "REJECTED", reason: "PAPER_DAILY_ORDER_CAP" });
  });

  it("expires uncrossed immediate-or-expire limit orders at submission", async () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    const placed = await placePaperOrder(
      {
        instrument: parseInstrument("US:XNAS:AAPL"),
        side: "BUY",
        quantity: 1,
        orderType: "LIMIT",
        limitPrice: 1,
        idempotencyKey: "expiring-limit-0001",
      },
      { now },
    );
    expect(placed.order).toMatchObject({ status: "EXPIRED", reason: "LIMIT_NOT_REACHED" });
    expect(placed.order.expiresAt).toBeNull();
    expect(placed.order.resolvedAt?.toISOString()).toBe(now.toISOString());
  });

  it("rejects idempotency-key reuse with a different immutable order payload", async () => {
    await placePaperOrder({
      instrument: parseInstrument("US:XNAS:AAPL"),
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "payload-bound-key-0001",
    });
    await expect(placePaperOrder({
      instrument: parseInstrument("US:XNAS:MSFT"),
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "payload-bound-key-0001",
    })).rejects.toThrow(/idempotency key/i);
  });

  it("binds concurrent idempotency races to the winning payload", async () => {
    const key = "concurrent-payload-key-0001";
    const results = await Promise.allSettled([
      placePaperOrder({
        instrument: parseInstrument("US:XNAS:AAPL"), side: "BUY", quantity: 1,
        orderType: "MARKET", idempotencyKey: key,
      }),
      placePaperOrder({
        instrument: parseInstrument("US:XNAS:MSFT"), side: "BUY", quantity: 2,
        orderType: "MARKET", idempotencyKey: key,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/idempotency key/i) }),
    });
  });
});
