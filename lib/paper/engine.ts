import { calculatePaperFees, feePolicyId } from "./fees";
import type { PaperDecision, PaperEvaluationContext, PaperOrderIntent } from "./types";

const SLIPPAGE_RATE = { US: 0.0005, IN: 0.0008 } as const;

export function evaluatePaperOrder(
  intent: PaperOrderIntent,
  context: PaperEvaluationContext,
): PaperDecision {
  const policy = feePolicyId(intent.instrument.market, intent.product);
  if (!Number.isFinite(intent.quantity) || intent.quantity <= 0 || intent.quantity > 1_000_000) {
    return { status: "REJECTED", reason: "INVALID_QUANTITY", feePolicy: policy };
  }
  if (context.quote.instrument.id !== intent.instrument.id) {
    return { status: "REJECTED", reason: "QUOTE_INSTRUMENT_MISMATCH", feePolicy: policy };
  }
  if (context.quote.currency !== intent.instrument.currency) {
    return { status: "REJECTED", reason: "QUOTE_CURRENCY_MISMATCH", feePolicy: policy };
  }
  if (context.quote.provenance.quality === "STALE" || context.quote.provenance.quality === "CONFLICTED" || context.quote.provenance.quality === "UNAVAILABLE") {
    return { status: "REJECTED", reason: "INELIGIBLE_QUOTE", feePolicy: policy };
  }
  if (context.session !== "REGULAR") {
    return { status: "REJECTED", reason: "MARKET_NOT_REGULAR", feePolicy: policy };
  }

  let fillPrice: number;
  if (intent.orderType === "LIMIT") {
    if (!Number.isFinite(intent.limitPrice) || (intent.limitPrice ?? 0) <= 0) {
      return { status: "REJECTED", reason: "INVALID_LIMIT_PRICE", feePolicy: policy };
    }
    const crossed = intent.side === "BUY"
      ? context.quote.price <= intent.limitPrice!
      : context.quote.price >= intent.limitPrice!;
    if (!crossed) return { status: "EXPIRED", reason: "LIMIT_NOT_REACHED", feePolicy: policy };
    fillPrice = context.quote.price;
  } else {
    const slippage = SLIPPAGE_RATE[intent.instrument.market];
    fillPrice = context.quote.price * (intent.side === "BUY" ? 1 + slippage : 1 - slippage);
  }

  fillPrice = roundPrice(fillPrice);
  const notional = fillPrice * intent.quantity;
  const fees = calculatePaperFees({
    market: intent.instrument.market,
    currency: intent.instrument.currency,
    side: intent.side,
    notional,
    product: intent.product,
  });

  if (intent.side === "BUY") {
    const required = notional + fees;
    if (required > context.cash + 1e-6) {
      return { status: "REJECTED", reason: "INSUFFICIENT_CASH", feePolicy: policy };
    }
    return { status: "FILLED", fillPrice, fees, feePolicy: policy, cashDelta: -required };
  }

  if (intent.quantity > context.heldQuantity + 1e-6) {
    return { status: "REJECTED", reason: "INSUFFICIENT_HOLDINGS", feePolicy: policy };
  }
  return {
    status: "FILLED",
    fillPrice,
    fees,
    feePolicy: policy,
    cashDelta: notional - fees,
  };
}

function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
