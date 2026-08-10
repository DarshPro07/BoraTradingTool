/**
 * One-off repair: put every intraday bar in the candle store on the same clock.
 *
 * ## What was wrong
 *
 * `price_candles` held two incompatible timestamp conventions for the *same* instrument:
 *
 *   - the Yahoo accumulator writes true UTC — a 09:15 IST bar is stored as `03:45Z`;
 *   - `quant/tv_history.py` wrote IST wall-clock stamped as UTC — the same bar as `09:15Z`.
 *
 * The fetcher said so in a comment, and reasoned that consistency mattered more than the absolute
 * offset "because every consumer compares these bars only with each other". That was true of the
 * JSON file and false of the store. Six tickers carried both conventions, 5h30m apart, and in the
 * `09:15–10:00Z` overlap `UNIQUE(ticker, resolution, time)` merged a 09:15 IST bar with a 14:45 IST
 * one — keeping whichever was written first, silently.
 *
 * Nothing downstream could detect it. The bars are real, the prices are real, the series is
 * strictly increasing in `time`; only the *meaning* of the numbers differs between rows. Any
 * session-relative rule — a square-off, an opening range — then reads the wrong clock for half the
 * universe and produces a confident answer.
 *
 * ## Why re-import rather than shift in place
 *
 * In the overlap window the two conventions are indistinguishable by timestamp, so no in-place
 * arithmetic can recover which source wrote a given row. The surviving export is unambiguous —
 * it is pure tvdatafeed — so the honest repair is to drop the affected series and rebuild it.
 *
 * The Yahoo bars for those tickers are dropped with them (roughly one session's worth). That is
 * deliberate and self-healing: the accumulator re-fetches them on its next pass, and a handful of
 * recoverable bars is a small price for a store with one clock in it.
 *
 * Safe to re-run. Once `tv_history.py` has been re-run, the export declares `timeBasis: "utc"` and
 * this applies no shift at all.
 *
 * Usage:  npx tsx scripts/repair-intraday-clock.mts [path-to-nse-tv-5m.json]
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { persistCandles, recordDatasetImport } from "@/lib/market/candle-store";
import type { ImportedCandle } from "@/lib/market/dataset-import";

interface FetchedFile {
  source?: string;
  licence?: string | null;
  resolution?: string;
  fetchedAt?: string;
  /** Absent in files written before the clock was fixed. */
  timeBasis?: string;
  series?: Record<string, Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>;
}

/** IST is UTC+5:30 and has no daylight saving, so one constant is exact rather than approximate. */
const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;

/** NSE trades 09:15–15:30 IST. In true UTC that is 03:45–10:00. */
const SESSION_OPEN_UTC_MINUTE = 3 * 60 + 45;
const SESSION_CLOSE_UTC_MINUTE = 10 * 60;

const input = process.argv[2] ?? path.join(process.cwd(), "data", "quantcore", "nse-tv-5m.json");

if (!fs.existsSync(input)) {
  console.error(
    `No file at ${input}. This repair rebuilds a series from the export that produced it; ` +
      "without the export there is nothing to rebuild from, and inventing bars is the one thing it must never do.",
  );
  process.exit(2);
}

const file = JSON.parse(fs.readFileSync(input, "utf8")) as FetchedFile;
const series = file.series ?? {};
const resolution = file.resolution ?? "5";
const tickers = Object.keys(series);

if (tickers.length === 0) {
  console.error("The export holds no series. Nothing to repair.");
  process.exit(2);
}

// The file itself says which clock it is on. Inferred only when it does not say — and the only
// files that do not say were written by the revision that got it wrong.
const shift = file.timeBasis === "utc" ? 0 : -IST_OFFSET_SECONDS;

console.log(`Export: ${input}`);
console.log(`  timeBasis: ${file.timeBasis ?? "(absent — written before the fix)"}`);
console.log(`  shift applied: ${shift}s${shift === 0 ? " (already UTC)" : " (IST wall-clock → UTC)"}`);
console.log(`  ${tickers.length} ticker(s) at resolution ${resolution}`);

const db = getDb();

const before = db
  .select({ time: schema.priceCandles.time })
  .from(schema.priceCandles)
  .where(and(inArray(schema.priceCandles.ticker, tickers), eq(schema.priceCandles.resolution, resolution)))
  .all();

const removed = db
  .delete(schema.priceCandles)
  .where(and(inArray(schema.priceCandles.ticker, tickers), eq(schema.priceCandles.resolution, resolution)))
  .run();

console.log(`\nPurged ${before.length} row(s) (${removed.changes} reported by the driver).`);

const candles: ImportedCandle[] = [];
let rejected = 0;

for (const [ticker, bars] of Object.entries(series)) {
  for (const bar of bars) {
    const finite = [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value));
    if (!finite || bar.high < bar.low || !Number.isFinite(bar.time)) {
      rejected += 1;
      continue;
    }
    candles.push({
      ticker,
      resolution,
      time: bar.time + shift,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : null,
    });
  }
}

const result = persistCandles(candles);
console.log(`Re-imported ${result.inserted} bar(s), skipped ${result.skipped}, rejected ${rejected} malformed.`);

const unfitForValidation =
  "Unadjusted vendor bars for currently-listed symbols only: a split reads as a price cliff, and " +
  "the absence of delisted names makes every result optimistic by an unknown amount. Usable for " +
  "exploring an idea, not for promoting one.";

recordDatasetImport(
  {
    source: `${file.source ?? "TradingView chart feed via tvdatafeed"} (clock repaired: ${shift}s)`,
    license: file.licence ?? null,
    adjustment: "raw",
    includesDelisted: false,
    resolution,
  },
  { inserted: result.inserted, skipped: result.skipped, rejected, unfitForValidation },
  "intraday-clock-repair",
);

// Verify rather than assert success. A repair that reports "done" without checking is how the
// original defect survived an import in the first place.
const after = db
  .select({ ticker: schema.priceCandles.ticker, time: schema.priceCandles.time })
  .from(schema.priceCandles)
  .where(eq(schema.priceCandles.resolution, resolution))
  .all();

const outside = after.filter((row) => {
  if (!row.ticker.startsWith("IN:")) return false;
  const minute = new Date(row.time * 1000).getUTCHours() * 60 + new Date(row.time * 1000).getUTCMinutes();
  return minute < SESSION_OPEN_UTC_MINUTE || minute >= SESSION_CLOSE_UTC_MINUTE;
});

console.log(`\nVerification — ${after.length} row(s) at resolution ${resolution}:`);
if (outside.length === 0) {
  console.log("  every NSE bar falls inside 03:45–10:00Z (09:15–15:30 IST). One clock.");
} else {
  const sample = outside.slice(0, 5).map((row) => `${row.ticker} @ ${new Date(row.time * 1000).toISOString()}`);
  console.error(`  ${outside.length} bar(s) still fall outside the NSE session in UTC:`);
  for (const line of sample) console.error(`    ${line}`);
  console.error("  The store still holds more than one clock. Do not build session rules on it.");
  process.exit(1);
}
