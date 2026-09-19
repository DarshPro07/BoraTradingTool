import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getMarketSession } from "@/lib/market/calendar";
import { parseInstrument } from "@/lib/market/instruments";
import { getNormalizedQuote } from "@/lib/market/service";
import type { PaperOrderIntent } from "./types";
import {
  expireOpenPaperOrders,
  assertPaperOrderMatchesIntent,
  findPaperOrderByIdempotencyKey,
  listPaperOrders,
  INTRADAY_LAST_ENTRY_IST_MINUTES,
  istMinutes,
  persistPaperOrder,
  readPaperPortfolio,
} from "./repository";

export interface PlacePaperOrderOptions {
  now?: Date;
}

export async function placePaperOrder(intent: PaperOrderIntent, options: PlacePaperOrderOptions = {}) {
  const now = options.now ?? new Date();
  expireOpenPaperOrders(now);
  const existing = findPaperOrderByIdempotencyKey(intent.idempotencyKey);
  if (existing) {
    assertPaperOrderMatchesIntent(existing, intent);
    return { order: existing, idempotentReplay: true };
  }

  const quote = await getNormalizedQuote(intent.instrument);
  const session = process.env.MARKETPULSE_TEST_MODE === "1"
    ? "REGULAR"
    : getMarketSession(intent.instrument.market, now).session;
  return persistPaperOrder(intent, quote, session, now);
}

export function getPaperPortfolio() {
  return readPaperPortfolio();
}

export { listPaperOrders };

export interface SquareOffReport {
  attempted: number;
  closed: number;
  /** Positions that could not be closed this pass, with the engine's reason. */
  carried: { instrumentId: string; reason: string | null }[];
}

/**
 * Close every intraday paper position, from the entry cut-off (15:10 IST) onward.
 *
 * The scheduled cycle calls this every pass; before the cut-off it does nothing. A broker squares
 * MIS positions off itself near 15:20; the paper equivalent is this pass, which the 15:15 cycle
 * reaches with the market still open. A position this pass cannot close — stale quote, closed
 * session — is REPORTED as carried rather than filled at an invented price, and the next pass
 * retries (the next session's first cycle, if it came to that).
 */
export async function squareOffIntradayPaper(now = new Date()): Promise<SquareOffReport> {
  const report: SquareOffReport = { attempted: 0, closed: 0, carried: [] };
  const istDay = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const day = istDay(now);
  const due = getDb()
    .select()
    .from(schema.paperPositions)
    .where(eq(schema.paperPositions.product, "INTRADAY"))
    .all()
    // Due from the cut-off, or at once if it was carried from an earlier day.
    .filter((p) => p.quantity > 1e-9 && (istMinutes(now) >= INTRADAY_LAST_ENTRY_IST_MINUTES || istDay(p.updatedAt) < day));

  for (const position of due) {
    report.attempted += 1;
    const { order } = await placePaperOrder(
      {
        instrument: parseInstrument(position.instrumentId),
        side: "SELL",
        quantity: position.quantity,
        orderType: "MARKET",
        product: "INTRADAY",
        // One square-off per position per day and pass window; a retry after a rejection needs a
        // fresh key, so the minute is part of it.
        idempotencyKey: `squareoff-${position.instrumentId}-${day}-${istMinutes(now)}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80),
      },
      { now },
    );
    if (order.status === "FILLED") report.closed += 1;
    else report.carried.push({ instrumentId: position.instrumentId, reason: order.reason });
  }
  return report;
}

