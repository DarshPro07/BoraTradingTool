import { NextResponse } from "next/server";
import { parseInstrument } from "@/lib/market/instruments";
import { readBoundedString, readEnum, readFiniteNumber, readJsonObject } from "@/lib/http/input";
import { requireMutationAccess } from "@/lib/security/request";
import { listPaperOrders, placePaperOrder } from "@/lib/paper/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = readFiniteNumber(Number(new URL(request.url).searchParams.get("limit") ?? 100), {
    min: 1,
    max: 500,
    integer: true,
  }) ?? 100;
  return NextResponse.json(listPaperOrders(limit));
}

export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const instrumentId = readBoundedString(body.instrumentId, { min: 1, max: 64 });
  const side = readEnum(body.side, ["BUY", "SELL"] as const);
  const quantity = readFiniteNumber(body.quantity, { min: 0.000001, max: 1_000_000 });
  const orderType = readEnum(body.orderType, ["MARKET", "LIMIT"] as const);
  const idempotencyKey = readBoundedString(body.idempotencyKey, {
    min: 8,
    max: 80,
    pattern: /^[A-Za-z0-9_-]+$/,
  });
  const limitPrice = body.limitPrice == null
    ? undefined
    : readFiniteNumber(body.limitPrice, { min: 0.0001, max: 1_000_000_000 });
  if (!instrumentId || !side || quantity === null || !orderType || !idempotencyKey || (orderType === "LIMIT" && limitPrice == null)) {
    return NextResponse.json({ error: "INVALID_PAPER_ORDER" }, { status: 400 });
  }

  try {
    const result = await placePaperOrder({
      instrument: parseInstrument(instrumentId),
      side,
      quantity,
      orderType,
      limitPrice: limitPrice ?? undefined,
      idempotencyKey,
    });
    const status = result.order.status === "REJECTED" ? 422 : result.idempotentReplay ? 200 : 201;
    return NextResponse.json(result, { status });
  } catch (error) {
    return NextResponse.json(
      { error: "PAPER_ORDER_FAILED", message: error instanceof Error ? error.message : "Paper order failed." },
      { status: 400 },
    );
  }
}
