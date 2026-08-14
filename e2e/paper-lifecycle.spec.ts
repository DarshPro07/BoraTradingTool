import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * Paper lifecycle — the simulated ledger, exercised through the real HTTP surface.
 *
 * Paper trading is deliberately not a brokerage: no credentials exist or are needed. The quote
 * is the deterministic TEST_FIXTURE (RELIANCE = ₹2,985.50, quality LIVE, session forced REGULAR
 * under MARKETPULSE_TEST_MODE=1), the fee model is the published IN_EQUITY_DELIVERY_2026_01
 * schedule, and capital is the seeded ₹1,00,00,000 paper account.
 *
 * Proven here, in order: watchlist refusal → position-cap refusal → input validation →
 * create + full fill → position open → idempotent replay + conflict → holdings refusal →
 * exit with realised P&L → limit expiry → limit-crossed fill → daily-order-cap refusal →
 * persistence (API + raw ledger cross-check).
 *
 * Honest scope notes (reported, not hidden):
 * - CANCEL: there is no cancel route (`/api/paper/orders` is GET/POST only) and `expiresAt` is
 *   always null, so resting orders never time-expire. Expiry semantics in this engine are
 *   immediate: an uncrossed LIMIT is EXPIRED at evaluation. Asserted as such.
 * - PARTIAL FILL: does not exist in this engine — a crossed order fills in full or not at all.
 * - INSUFFICIENT_CASH / INELIGIBLE_QUOTE / MARKET_NOT_REGULAR are unreachable through HTTP in
 *   test mode: the position cap (15% of starting cash per instrument) fires before cash can
 *   run out, the fixture quote is always LIVE, and the session is forced REGULAR. All three
 *   are unit-covered at lib/paper/engine.test.ts (:67 INSUFFICIENT_CASH, :71 INELIGIBLE_QUOTE).
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;
const RUN_STAMP = Date.now().toString(36);
const RELIANCE = "IN:XNSE:RELIANCE";
const TCS = "IN:XNSE:TCS";
const QUOTE = 2_985.5;
const SLIPPAGE = 0.0008;
const MARKET_BUY_FILL = Math.round(QUOTE * (1 + SLIPPAGE) * 10_000) / 10_000; // 2987.8884

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

interface PaperOrder {
  id: number;
  instrumentId: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  status: string;
  reason: string | null;
  quotePrice: number;
  fillPrice: number | null;
  fees: number;
  quoteQuality: string;
  simulatedFixture: boolean;
  idempotencyKey: string;
  createdAt: string;
}

interface Portfolio {
  accounts: { currency: string; cash: number; startingCash: number }[];
  positions: { instrumentId: string; quantity: number; averageCost: number; realizedPnl: number }[];
  orders: PaperOrder[];
}

test.describe("paper lifecycle — create, fill, refuse, exit, persist", () => {
  test.skip(!DB_PATH, "needs direct access to the server's database file");

  test("the full order lifecycle through the real API, with the ledger agreeing", async ({
    request,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(120_000);
    await ensureLocalSession(request);
    const h = headers(baseURL!);
    const key = (label: string) => `pl_${label}_${RUN_STAMP}`;

    const place = (body: Record<string, unknown>) =>
      request.post("/api/paper/orders", { headers: h, data: body });

    let orderSeq = 0;
    const order = (label: string, body: Record<string, unknown>) =>
      place({ idempotencyKey: key(`${orderSeq++}_${label}`), ...body });

    await test.step("0. deterministic budget: raise the daily order cap for this run", async () => {
      const patch = await request.patch("/api/agent/config", { headers: h, data: { dailyTradeCap: 100 } });
      expect(patch.status()).toBe(200);
    });

    await test.step("1. risk refusal: a BUY for an unwatchlisted instrument is refused by name", async () => {
      const res = await order("watchlist", { instrumentId: RELIANCE, side: "BUY", quantity: 1, orderType: "MARKET" });
      expect(res.status()).toBe(422);
      const body = (await res.json()) as { order: PaperOrder };
      expect(body.order.status).toBe("REJECTED");
      expect(body.order.reason).toBe("PAPER_WATCHLIST_REQUIRED");
    });

    await test.step("2. watchlist the instruments the way the product intends", async () => {
      for (const ticker of [RELIANCE, TCS]) {
        const res = await request.post("/api/watchlist", { headers: h, data: { ticker } });
        expect(res.status()).toBe(200);
      }
    });

    await test.step("3. risk refusal: the position ceiling refuses an oversized order", async () => {
      // 2,000 × ₹1,000 fixture = ₹20,00,000 = 20% of the ₹1cr seed — above the 15% ceiling.
      const res = await order("cap", { instrumentId: TCS, side: "BUY", quantity: 2_000, orderType: "MARKET" });
      expect(res.status()).toBe(422);
      expect(((await res.json()) as { order: PaperOrder }).order.reason).toBe("PAPER_POSITION_CAP");
    });

    await test.step("4. input validation: a zero quantity never reaches the engine", async () => {
      const res = await order("badqty", { instrumentId: RELIANCE, side: "BUY", quantity: 0, orderType: "MARKET" });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("INVALID_PAPER_ORDER");
    });

    let buyOrder: PaperOrder;
    let cashAfterBuy: number;

    await test.step("5. create + full fill: a MARKET BUY fills at quote + slippage with real fees", async () => {
      const res = await order("buy", { instrumentId: RELIANCE, side: "BUY", quantity: 2, orderType: "MARKET" });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { order: PaperOrder; idempotentReplay: boolean };
      buyOrder = body.order;
      expect(body.idempotentReplay).toBe(false);
      expect(buyOrder.status).toBe("FILLED");
      expect(buyOrder.fillPrice).toBeCloseTo(MARKET_BUY_FILL, 4);
      expect(buyOrder.fees).toBeGreaterThan(0);
      // A fill carries the fee schedule id as its reason — the cost basis is named, not hidden.
      expect(buyOrder.reason).toBe("IN_EQUITY_DELIVERY_2026_01");
      expect(buyOrder.quoteQuality).toBe("LIVE");
      expect(buyOrder.simulatedFixture).toBe(true);
    });

    await test.step("6. open: the portfolio shows the position and the cash left exactly once", async () => {
      const portfolio = (await (await request.get("/api/paper/portfolio")).json()) as Portfolio;
      const position = portfolio.positions.find((p) => p.instrumentId === RELIANCE);
      expect(position?.quantity).toBe(2);
      expect(position!.averageCost).toBeCloseTo((buyOrder.fillPrice! * 2 + buyOrder.fees) / 2, 4);
      const account = portfolio.accounts.find((a) => a.currency === "INR");
      cashAfterBuy = account!.cash;
      expect(account!.startingCash).toBe(10_000_000);
      expect(account!.cash).toBeCloseTo(10_000_000 - (buyOrder.fillPrice! * 2 + buyOrder.fees), 2);
    });

    await test.step("7. idempotency: a replayed key returns the same order; a reused key conflicts", async () => {
      const replay = await place({
        idempotencyKey: key("3_buy"),
        instrumentId: RELIANCE,
        side: "BUY",
        quantity: 2,
        orderType: "MARKET",
      });
      expect(replay.status()).toBe(200);
      const replayBody = (await replay.json()) as { order: PaperOrder; idempotentReplay: boolean };
      expect(replayBody.idempotentReplay).toBe(true);
      expect(replayBody.order.id).toBe(buyOrder.id);

      const conflict = await place({
        idempotencyKey: key("3_buy"),
        instrumentId: RELIANCE,
        side: "BUY",
        quantity: 3,
        orderType: "MARKET",
      });
      expect(conflict.status()).toBe(400);
      expect(((await conflict.json()) as { error: string }).error).toBe("PAPER_ORDER_FAILED");
    });

    await test.step("8. holdings refusal: selling more than held is refused by name", async () => {
      const res = await order("oversell", { instrumentId: RELIANCE, side: "SELL", quantity: 5, orderType: "MARKET" });
      expect(res.status()).toBe(422);
      expect(((await res.json()) as { order: PaperOrder }).order.reason).toBe("INSUFFICIENT_HOLDINGS");
    });

    await test.step("9. exit: a SELL fills, books realised P&L, and returns cash exactly once", async () => {
      const res = await order("sell", { instrumentId: RELIANCE, side: "SELL", quantity: 1, orderType: "MARKET" });
      expect(res.status()).toBe(201);
      const sell = ((await res.json()) as { order: PaperOrder }).order;
      expect(sell.status).toBe("FILLED");
      expect(sell.fillPrice).toBeCloseTo(Math.round(QUOTE * (1 - SLIPPAGE) * 10_000) / 10_000, 4);
      expect(sell.fees).toBeGreaterThan(0);

      const portfolio = (await (await request.get("/api/paper/portfolio")).json()) as Portfolio;
      const position = portfolio.positions.find((p) => p.instrumentId === RELIANCE)!;
      expect(position.quantity).toBe(1);
      // Fill (2983.11) is below the average cost (~2987.89 + fees) — a realised loss, honestly signed.
      expect(position.realizedPnl).toBeLessThan(0);
      const account = portfolio.accounts.find((a) => a.currency === "INR")!;
      expect(account.cash).toBeCloseTo(cashAfterBuy + (sell.fillPrice! * 1 - sell.fees), 2);
    });

    await test.step("10. expiry: an uncrossed LIMIT expires immediately, naming why", async () => {
      const res = await order("expire", {
        instrumentId: RELIANCE,
        side: "BUY",
        quantity: 1,
        orderType: "LIMIT",
        limitPrice: 1_000, // far below the ₹2,985.50 fixture — never crosses
      });
      expect(res.status()).toBe(201);
      const expired = ((await res.json()) as { order: PaperOrder }).order;
      expect(expired.status).toBe("EXPIRED");
      expect(expired.reason).toBe("LIMIT_NOT_REACHED");
      expect(expired.fillPrice).toBeNull();
    });

    await test.step("11. a crossed LIMIT fills at the quote — the limit is a ceiling, not the price", async () => {
      const res = await order("limit", {
        instrumentId: RELIANCE,
        side: "BUY",
        quantity: 1,
        orderType: "LIMIT",
        limitPrice: 3_000, // above the fixture quote — crosses
      });
      expect(res.status()).toBe(201);
      const filled = ((await res.json()) as { order: PaperOrder }).order;
      expect(filled.status).toBe("FILLED");
      expect(filled.fillPrice).toBe(QUOTE); // limit fills at market, no slippage
      expect(filled.fees).toBeGreaterThan(0);
    });

    await test.step("12. risk refusal: the daily order cap refuses the next order by name", async () => {
      // Set the cap to exactly today's accepted count, so the very next order must trip it —
      // deterministic no matter how many orders earlier specs in the suite placed today.
      const orders = (await (await request.get("/api/paper/orders?limit=500")).json()) as PaperOrder[];
      const todayUtc = new Date().toISOString().slice(0, 10);
      const acceptedToday = orders.filter(
        (o) => o.status !== "REJECTED" && o.createdAt.startsWith(todayUtc),
      ).length;
      const patch = await request.patch("/api/agent/config", { headers: h, data: { dailyTradeCap: acceptedToday } });
      expect(patch.status()).toBe(200);

      const res = await order("dailycap", { instrumentId: RELIANCE, side: "BUY", quantity: 1, orderType: "MARKET" });
      expect(res.status()).toBe(422);
      expect(((await res.json()) as { order: PaperOrder }).order.reason).toBe("PAPER_DAILY_ORDER_CAP");

      // Restore headroom so later specs are not boxed in by this run's orders.
      await request.patch("/api/agent/config", { headers: h, data: { dailyTradeCap: 100 } });
    });

    await test.step("13. persistence: the API and the raw ledger agree, funds never negative", async () => {
      const orders = (await (await request.get("/api/paper/orders?limit=500")).json()) as PaperOrder[];
      const mine = orders.filter((o) => o.idempotencyKey.startsWith(`pl_`) && o.idempotencyKey.endsWith(RUN_STAMP));
      // watchlist REJECTED, cap REJECTED, buy FILLED, oversell REJECTED, sell FILLED,
      // expire EXPIRED, limit FILLED, dailycap REJECTED (the 400 never persisted).
      expect(mine.length).toBe(8);
      expect(mine.filter((o) => o.status === "FILLED")).toHaveLength(3);
      expect(mine.filter((o) => o.status === "REJECTED")).toHaveLength(4);
      expect(mine.filter((o) => o.status === "EXPIRED")).toHaveLength(1);

      const db = new Database(DB_PATH!);
      try {
        // Every fill wrote exactly one CASH and one POSITION ledger entry.
        const ledger = db
          .prepare(
            `SELECT o.id, COUNT(l.order_id) AS entries FROM paper_orders o
             LEFT JOIN paper_ledger l ON l.order_id = o.id
             WHERE o.idempotency_key LIKE ? GROUP BY o.id`,
          )
          .all(`pl_%_${RUN_STAMP}`) as { id: number; entries: number }[];
        const fills = db
          .prepare("SELECT id FROM paper_orders WHERE idempotency_key LIKE ? AND status = 'FILLED'")
          .all(`pl_%_${RUN_STAMP}`) as { id: number }[];
        expect(fills).toHaveLength(3);
        for (const fill of fills) {
          expect(ledger.find((row) => row.id === fill.id)?.entries).toBe(2);
        }
        const account = db.prepare("SELECT cash FROM paper_accounts WHERE currency = 'INR'").get() as { cash: number };
        expect(account.cash).toBeGreaterThanOrEqual(0);
      } finally {
        db.close();
      }
    });
  });
});
