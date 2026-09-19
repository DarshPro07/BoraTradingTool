import type { IndiaProduct } from "./fees";
import type { Currency, Instrument, NormalizedQuote } from "@/lib/market/types";
import type { MarketSession } from "@/lib/market/calendar";

export interface PaperOrderIntent {
  instrument: Instrument;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
  idempotencyKey: string;
  /**
   * India only. DELIVERY (default) or INTRADAY: decides the fee schedule and whether the cycle
   * squares the position off before the close. Defaults to DELIVERY because cost assumptions must
   * fail expensive (`lib/paper/fees.ts`).
   */
  product?: IndiaProduct;
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
