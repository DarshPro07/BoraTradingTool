import { getMarketSession } from "@/lib/market/calendar";
import { getNormalizedQuote } from "@/lib/market/service";
import type { PaperOrderIntent } from "./types";
import {
  expireOpenPaperOrders,
  assertPaperOrderMatchesIntent,
  findPaperOrderByIdempotencyKey,
  listPaperOrders,
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
