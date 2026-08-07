import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { refreshStockContext } from "@/lib/data/research";
import { getRealPortfolio } from "@/lib/trading/robinhood-portfolio";
import { requireMutationAccess } from "@/lib/security/request";
import { readBoundedString, readJsonObject } from "@/lib/http/input";

export const dynamic = "force-dynamic";

// The Scheduled Research System's refresh hook. The agent does its own candidate
// discovery externally (news/trends/TA) and feeds the tickers it wants logged via
// { tickers: [...] } — this endpoint then writes/refreshes their Context Files so
// the findings are recorded and readable. With no body it falls back to the
// baseline set (watchlist + current holdings) so holdings are always kept fresh.
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  let only: string[] | null = null;
  if (parsed.value.tickers !== undefined) {
    if (!Array.isArray(parsed.value.tickers) || parsed.value.tickers.length > 50) {
      return NextResponse.json({ error: "tickers must be an array of at most 50 symbols" }, { status: 400 });
    }
    const normalized = parsed.value.tickers.map((value) =>
      readBoundedString(value, { min: 1, max: 40, pattern: /^[A-Za-z0-9:._^-]+$/ })?.toUpperCase(),
    );
    if (normalized.some((ticker) => !ticker)) {
      return NextResponse.json({ error: "tickers contains an invalid symbol" }, { status: 400 });
    }
    only = normalized as string[];
  }

  const db = getDb();
  const watchlist = db.select().from(schema.userWatchlist).all().map((r) => r.ticker);
  const held = (getRealPortfolio()?.positions ?? []).map((p) => p.ticker);
  const tickers = only ?? Array.from(new Set([...watchlist, ...held]));

  const results = await Promise.all(
    tickers.map(async (t) => {
      try {
        return await refreshStockContext(t);
      } catch {
        return null;
      }
    })
  );

  const refreshed = results.filter((r): r is NonNullable<typeof r> => r !== null);
  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    count: refreshed.length,
    summaries: refreshed,
    skipped: tickers.filter((t) => !refreshed.some((r) => r.ticker === t)),
  });
}
