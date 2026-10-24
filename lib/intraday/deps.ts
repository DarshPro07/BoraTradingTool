/** The intraday trader's real inputs and outputs: live 5-minute bars, live quotes, the NSE session, the paper engine. */
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getMarketSession } from "@/lib/market/calendar";
import { parseInstrument } from "@/lib/market/instruments";
import { getNormalizedCandles, getNormalizedQuote } from "@/lib/market/service";
import { enginePositionCapPct } from "@/lib/paper/desk";
import { placePaperOrder } from "@/lib/paper/service";
import type { IntradayDeps } from "./orb";

const istMinuteOf = (t: number) => {
  const ist = new Date((t + 19_800) * 1000);
  return { day: ist.toISOString().slice(0, 10), minute: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
};

/** The minute task and the cycle's backstop (EC-4) share this lease file, so they never trade at once. */
export const intradayLeaseFile = () => path.resolve(process.cwd(), "marketpulse.db.intraday-lease");
/**
 * EC-9: a dead holder frees it in 2 minutes, not 10 (the 09:36 and 09:52 freezes on 2026-10-23).
 * Renewal stops at 150 s, inside the task's 3-minute limit, so a hung run cannot keep it alive.
 */
export const INTRADAY_LEASE = { ttlMs: 120_000, maxCycleMs: 150_000 } as const;

export const realIntradayDeps: IntradayDeps = {
  async firstCandle(instrumentId, day) {
    const to = Math.floor(Date.now() / 1000);
    // "5" is the provider's 5-minute key ("5m" once silently returned daily bars — see yahoo.ts).
    const { candles } = await getNormalizedCandles(parseInstrument(instrumentId), "5", to - 86_400, to);
    const bar = candles.find((c) => {
      const t = istMinuteOf(c.time);
      return t.day === day && t.minute === 9 * 60 + 15;
    });
    return bar ? { open: bar.open, high: bar.high, low: bar.low, close: bar.close } : null;
  },

  async lastPrice(instrumentId) {
    const quote = await getNormalizedQuote(parseInstrument(instrumentId));
    // A stale price is not a price to trade or stop on; the engine would refuse it anyway.
    return ["STALE", "UNAVAILABLE", "CONFLICTED"].includes(quote.provenance.quality) ? null : quote.price;
  },

  sessionOpen: (now) => getMarketSession("IN", now).session === "REGULAR",

  book() {
    const account = getDb().select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, "INR")).get();
    return { startingCash: account?.startingCash ?? 0, cash: account?.cash ?? 0, capPct: enginePositionCapPct() };
  },

  async place(instrumentId, side, quantity, key) {
    const { order } = await placePaperOrder({
      instrument: parseInstrument(instrumentId), side, quantity, orderType: "MARKET", product: "INTRADAY", idempotencyKey: key,
    });
    return { status: order.status, fillPrice: order.fillPrice, fees: order.fees, reason: order.reason };
  },
};
