import { NextResponse } from "next/server";
import { parseInstrument } from "@/lib/market/instruments";
import { getNormalizedQuote } from "@/lib/market/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const instrumentId = new URL(request.url).searchParams.get("instrumentId") ?? "";
  try {
    return NextResponse.json(await getNormalizedQuote(parseInstrument(instrumentId)));
  } catch (error) {
    return NextResponse.json(
      { error: "QUOTE_UNAVAILABLE", message: error instanceof Error ? error.message : "Quote unavailable." },
      { status: 404 },
    );
  }
}
