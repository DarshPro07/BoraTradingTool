import { NextResponse } from "next/server";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { STORE_RESOLUTION } from "@/lib/research-data/snapshot";

export const dynamic = "force-dynamic";

/**
 * Display-context bars from the canonical store — and only the store.
 *
 * The trade chart draws a completed trade against the bars around it. Those bars come from the
 * same store the experiment's snapshot was built from; the live provider is never consulted here,
 * because a chart that quietly redrew historical evidence with today's provider window would be
 * the item-13 defect wearing a UI. Missing bars are an empty, stated answer — not a fetch.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker")?.trim() ?? "";
  const resolution = url.searchParams.get("resolution")?.trim() ?? "";
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));

  if (!ticker || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "ticker, from and to (unix seconds, from < to) are required." },
      { status: 400 },
    );
  }

  const storeResolution = STORE_RESOLUTION[resolution];
  if (!storeResolution) {
    return NextResponse.json(
      { error: "UNKNOWN_RESOLUTION", message: `${resolution || "(none)"} is not a store resolution.` },
      { status: 400 },
    );
  }

  const bars = loadStoredCandles(ticker, storeResolution, from, to).map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
  }));

  return NextResponse.json({
    bars,
    source: "canonical-store",
    note:
      bars.length === 0
        ? "The canonical store holds no bars in this window. Nothing was fetched to fill the gap — missing history is an ingestion task."
        : "Served from the canonical candle store. The live provider was not consulted.",
  });
}
