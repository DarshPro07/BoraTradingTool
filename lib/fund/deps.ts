/**
 * The fund's real inputs and outputs: stored/refreshed bars, sessions, and the two paper engines.
 * Kept apart from `run.ts` so the pass is tested with fakes and runs in production with these.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { findVerifiedToken } from "@/lib/crypto/jupiter";
import { placeCryptoPaperOrder } from "@/lib/crypto/paper";
import { getMarketSession } from "@/lib/market/calendar";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { parseInstrument } from "@/lib/market/instruments";
import { istDate } from "@/lib/market/session-calendar";
import { latestExpectedSession } from "@/lib/market/universe-coverage";
import { placePaperOrder } from "@/lib/paper/service";
import { getYahooCandles } from "@/lib/providers/yahoo";
import type { MandateContract } from "./mandates";
import { CRYPTO_BUY_RESERVE, type Execution, type FundDeps } from "./run";

const rejected = (reason: string): Execution => ({
  status: "REJECTED", reason, quantityDelta: 0, cashDelta: 0, fillPrice: null, fees: 0,
});

export const realFundDeps: FundDeps = {
  async loadCloses(mandate: MandateContract, now: Date) {
    if (mandate.venue === "NSE") {
      const id = mandate.asset.instrumentId!;
      // ETFs sit outside the universe planner, so the fund keeps its own instruments current. A
      // failed refresh is not fatal: the store's bars are read either way and staleness shows.
      try {
        const { ingestInstrumentHistory } = await import("@/lib/market/ingest");
        await ingestInstrumentHistory(id);
      } catch {
        /* read what is stored */
      }
      const latest = latestExpectedSession(now.getTime());
      return loadStoredCandles(id, "D")
        .map((bar) => ({ date: istDate(bar.time), close: bar.close }))
        .filter((bar) => bar.date <= latest);
    }
    const to = Math.floor(now.getTime() / 1000);
    const today = now.toISOString().slice(0, 10);
    // Crypto never closes; today's UTC bar is still forming and is dropped.
    return (await getYahooCandles(mandate.asset.yahoo, "D", to - 420 * 86_400, to))
      .map((bar) => ({ date: new Date(bar.time * 1000).toISOString().slice(0, 10), close: bar.close }))
      .filter((bar) => bar.date < today);
  },

  bookCapital(mandate) {
    const db = getDb();
    return mandate.venue === "NSE"
      ? db.select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, "INR")).get()?.startingCash ?? 0
      : db.select().from(schema.cryptoPaperAccounts).where(eq(schema.cryptoPaperAccounts.asset, "USDC")).get()?.startingCash ?? 0;
  },

  canExecute(mandate, now) {
    return mandate.venue === "SOLANA" || getMarketSession("IN", now).session === "REGULAR";
  },

  async execute(mandate, side, amount, price, key) {
    if (mandate.venue === "NSE") {
      // 2% headroom for the gap between yesterday's close and today's fill plus charges.
      const quantity = side === "BUY" ? Math.floor((amount * 0.98) / price) : amount;
      if (quantity < 1) return rejected("SLEEVE_TOO_SMALL");
      const { order } = await placePaperOrder({
        instrument: parseInstrument(mandate.asset.instrumentId!),
        side, quantity, orderType: "MARKET", product: "DELIVERY", idempotencyKey: key,
      });
      if (order.status !== "FILLED") return rejected(order.reason ?? order.status);
      const gross = order.fillPrice! * order.quantity;
      return {
        status: "FILLED", reason: null, fillPrice: order.fillPrice, fees: order.fees,
        quantityDelta: side === "BUY" ? order.quantity : -order.quantity,
        cashDelta: side === "BUY" ? -(gross + order.fees) : gross - order.fees,
      };
    }
    // The mint is pinned in the contract; a symbol that now resolves elsewhere is refused.
    const token = await findVerifiedToken(mandate.asset.symbol);
    if (!token || token.mint !== mandate.asset.mint) return rejected("MINT_MISMATCH");
    const spend = side === "BUY" ? Math.floor((amount - CRYPTO_BUY_RESERVE) * 100) / 100 : amount;
    if (!(spend > 0)) return rejected("SLEEVE_TOO_SMALL");
    const { order } = await placeCryptoPaperOrder({
      token, side, amount: spend, thesis: `${mandate.id} mandate ${side} (autonomous fund)`, idempotencyKey: key,
    });
    if (order.status !== "FILLED") return rejected(order.reason ?? order.status);
    return {
      status: "FILLED", reason: null, fillPrice: order.fillPrice, fees: order.feesUsdc,
      quantityDelta: side === "BUY" ? order.quantity : -order.quantity,
      cashDelta: side === "BUY" ? -(order.usdcAmount + order.feesUsdc) : order.usdcAmount - order.feesUsdc,
    };
  },

  tradeDate(mandate, now) {
    return mandate.venue === "NSE" ? istDate(Math.floor(now.getTime() / 1000)) : now.toISOString().slice(0, 10);
  },
};
