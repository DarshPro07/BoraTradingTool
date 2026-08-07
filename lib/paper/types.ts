import type { Currency, Instrument, NormalizedQuote } from "@/lib/market/types";
import type { MarketSession } from "@/lib/market/calendar";

export interface PaperOrderIntent {
  instrument: Instrument;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
  idempotencyKey: string;
}

export class PaperOrderConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperOrderConflict";
  }
}

export interface PaperEvaluationContext {
  quote: NormalizedQuote;
  session: MarketSession;
  cash: number;
  heldQuantity: number;
}

export type PaperDecision =
  | {
      status: "FILLED";
      fillPrice: number;
      fees: number;
      feePolicy: string;
      cashDelta: number;
    }
  | { status: "EXPIRED"; reason: "LIMIT_NOT_REACHED"; feePolicy: string }
  | { status: "REJECTED"; reason: string; feePolicy: string };

export interface PaperAccount {
  currency: Currency;
  startingCash: number;
  cash: number;
}
