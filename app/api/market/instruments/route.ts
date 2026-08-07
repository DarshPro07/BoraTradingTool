import { NextResponse } from "next/server";
import { searchInstruments } from "@/lib/market/catalog";
import type { Exchange } from "@/lib/market/types";

const EXCHANGES = new Set<Exchange>(["XNAS", "XNYS", "XNSE", "XBOM"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").slice(0, 80);
  const requestedExchange = params.get("exchange") as Exchange | null;
  const exchange = requestedExchange && EXCHANGES.has(requestedExchange) ? requestedExchange : undefined;
  return NextResponse.json({ instruments: searchInstruments(query, exchange) });
}
