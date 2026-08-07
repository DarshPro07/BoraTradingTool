import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
import type { CandleResolution } from "@/lib/providers/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ticker = searchParams.get("ticker")?.toUpperCase();
  const resolution = (searchParams.get("resolution") ?? "D") as CandleResolution;
  const from = Number(searchParams.get("from") ?? 0);
  const to = Number(searchParams.get("to") ?? Math.floor(Date.now() / 1000));

  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  try {
    const provider = getProvider();
    const candles = await provider.getCandles(ticker, resolution, from, to);
    // `count` so the client can distinguish "no bars in this range" from a failed request.
    // An empty array is a legitimate answer for a closed market, not an error.
    return NextResponse.json({ candles, count: candles.length, resolution });
  } catch (err) {
    // The raw error can carry upstream URLs and file paths. Log it, return a bounded message.
    console.error("[api/candles] provider failed", err);
    return NextResponse.json({ error: "Candle provider failed for this range." }, { status: 502 });
  }
}
