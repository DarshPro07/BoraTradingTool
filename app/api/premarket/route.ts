import { NextResponse } from "next/server";
import { getMarketPhase, UNAVAILABLE_PREMARKET_INPUTS } from "@/lib/market/phases";
import type { Market } from "@/lib/market/types";

export const dynamic = "force-dynamic";

/**
 * Current market phase for both markets, plus an explicit list of the pre-market inputs this
 * deployment cannot supply.
 *
 * The unavailable list is not an apology, it is part of the answer. A pre-market report that
 * silently omits the F&O ban list reads identically to one where nothing was banned.
 */
export async function GET(request: Request) {
  const at = new URL(request.url).searchParams.get("at");
  const instant = at ? new Date(at) : new Date();

  if (Number.isNaN(instant.getTime())) {
    return NextResponse.json(
      { error: "INVALID_TIMESTAMP", message: `"${at}" is not a parseable date.` },
      { status: 400 },
    );
  }

  const markets: Market[] = ["IN", "US"];
  return NextResponse.json(
    {
      evaluatedAt: instant.toISOString(),
      phases: Object.fromEntries(markets.map((market) => [market, getMarketPhase(market, instant)])),
      unavailableInputs: UNAVAILABLE_PREMARKET_INPUTS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
