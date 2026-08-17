/**
 * Backfill NSE daily history from Upstox V3.
 *
 * ## Why
 *
 * Two problems, one remedy.
 *
 * 1. `RELIANCE`, `TCS` and `HDFCBANK` hold a daily series stamped one calendar day early — 122
 *    Sunday-dated bars each, one full day of lookahead against the rest of the universe in any
 *    cross-sectional join. See `docs/plans/upstox-daily-backfill/01-reality.md`.
 * 2. The store held 2.5 years of daily history, which caps the only research lane currently
 *    runnable. Upstox serves daily candles back to January 2000.
 *
 * The contaminated series cannot be repaired in place: a shifted bar is indistinguishable from a
 * correct one without an external reference, so shifting them back would be trusting the same
 * clock that got it wrong. They are purged and refetched.
 *
 * `quant/nse_history.py` — the script that produced them — reads the NSE bhavcopy by automated
 * request, which ADR 0009/0010 prohibits. It is NOT the repair path and is not re-run.
 *
 * ## Safe to re-run
 *
 * `persistCandles` skips timestamps already held, so a second run inserts nothing. `--purge` is
 * required to drop an existing series first, and is only meant for the three contaminated ones.
 *
 * Usage:
 *   npx tsx scripts/backfill-upstox-daily.mts --symbols RELIANCE,TCS,HDFCBANK --purge
 *   npx tsx scripts/backfill-upstox-daily.mts --symbols RELIANCE --from 2000-01-01
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { persistCandles, storedCoverage } from "@/lib/market/candle-store";
import { getUpstoxDailyHistory, EARLIEST_AVAILABLE } from "@/lib/providers/upstox";
import { istDate } from "@/lib/market/session-calendar";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const symbols = (arg("symbols") ?? "RELIANCE,TCS,HDFCBANK").split(",").map((s) => s.trim()).filter(Boolean);
const from = arg("from") ?? EARLIEST_AVAILABLE;
const purge = process.argv.includes("--purge");
const db = getDb();

/** The exchange's own identifier, from the security master — no symbol mapping to get wrong. */
function isinFor(symbol: string): string | null {
  const row = db
    .select({ isin: schema.nseListingVersions.isin })
    .from(schema.nseListingVersions)
    .where(
      and(
        eq(schema.nseListingVersions.symbol, symbol),
        eq(schema.nseListingVersions.listingStatus, "LISTED"),
      ),
    )
    .limit(1)
    .all();
  return row[0]?.isin ?? null;
}

console.log(`Upstox daily backfill — ${symbols.length} symbol(s), from ${from}${purge ? ", PURGING first" : ""}`);

for (const symbol of symbols) {
  const ticker = `IN:XNSE:${symbol}`;
  const isin = isinFor(symbol);
  if (!isin) {
    console.log(`  ${symbol.padEnd(12)} SKIPPED — no LISTED row in the security master`);
    continue;
  }

  const before = storedCoverage(ticker).find((c) => c.resolution === "D");

  let result;
  try {
    result = await getUpstoxDailyHistory(isin, { from });
  } catch (error) {
    console.log(`  ${symbol.padEnd(12)} REFUSED — ${(error as Error).message}`);
    continue;
  }

  if (result.candles.length === 0) {
    console.log(`  ${symbol.padEnd(12)} no bars returned; existing series left untouched`);
    continue;
  }

  // Purge only after a successful fetch. Dropping a series and then failing to replace it would
  // turn a dated series into no series at all.
  let purged = 0;
  if (purge) {
    purged = db
      .delete(schema.priceCandles)
      .where(and(eq(schema.priceCandles.ticker, ticker), eq(schema.priceCandles.resolution, "D")))
      .run().changes;
  }

  const written = persistCandles(
    result.candles.map((c) => ({ ticker, resolution: "D", ...c })),
  );

  const first = istDate(result.candles[0]!.time);
  const last = istDate(result.candles.at(-1)!.time);
  console.log(
    `  ${symbol.padEnd(12)} ${isin}  ${result.candles.length} bars ${first}..${last}` +
      `  (was ${before?.bars ?? 0})  purged=${purged} inserted=${written.inserted}` +
      ` skipped=${written.skipped} rejected=${written.rejected} refusedAtEdge=${result.rejected.length}`,
  );
}

const weekend = db
  .select({ n: sql<number>`count(*)` })
  .from(schema.priceCandles)
  .where(sql`resolution = 'D' AND strftime('%w', time + 19800, 'unixepoch') = '0'`)
  .all();
console.log(`\nSunday-dated daily bars remaining in the store: ${weekend[0]?.n ?? 0}`);
