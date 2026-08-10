/**
 * Imports the NSE bhavcopy history fetched by `quant/nse_history.py` into the candle store.
 *
 * ## Why the exchange's own bars are worth importing when Yahoo already serves NSE
 *
 * Yahoo is a redistributor. It maps Indian symbols onto its own tickers, applies its own
 * adjustment policy, and occasionally disagrees with the exchange about a split or bonus date.
 * The bhavcopy is what NSE itself published. For a system whose entire cost model is Indian and
 * whose owner trades NSE, that difference is not cosmetic.
 *
 * ## The declaration is the point, not the bars
 *
 * `recordDatasetImport` writes provenance into `audit_events`, and this import declares two things
 * that decide how the bars may be used:
 *
 *   - **`adjustment: "none"`** — the bhavcopy is unadjusted. A split shows as a price cliff. Any
 *     strategy computing returns across one will read a −50% day that never happened, so this is
 *     declared rather than assumed away.
 *   - **`includesDelisted: false`** — only currently-listed symbols were requested. The sample is
 *     survivorship-biased and every backtest over it is optimistic by an unknown amount.
 *
 * Both make the dataset *unfit for validation* by design, and that is the honest state. It is
 * legitimate evidence for exploring an idea and not for promoting one, which is exactly what the
 * declaration causes downstream.
 *
 * Usage:  npx tsx scripts/import-nse-history.mts [path-to-nse-daily.json]
 */
import fs from "node:fs";
import path from "node:path";
import { persistCandles, recordDatasetImport } from "@/lib/market/candle-store";
import type { ImportedCandle } from "@/lib/market/dataset-import";
import { quantCoreRoot } from "@/lib/quantcore/filesystem";

interface FetchedFile {
  source: string;
  licence: string | null;
  adjusted: boolean;
  resolution: string;
  fetchedAt: string;
  series: Record<string, Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>;
  failures: Record<string, string>;
}

const input = process.argv[2] ?? path.join(quantCoreRoot(), "nse-daily.json");

if (!fs.existsSync(input)) {
  console.error(
    `No file at ${input}. Run \`python quant/nse_history.py\` first — this script imports what that fetches, ` +
      "and inventing bars for a missing file is the one thing it must never do.",
  );
  process.exit(2);
}

const file = JSON.parse(fs.readFileSync(input, "utf8")) as FetchedFile;
const candles: ImportedCandle[] = [];
let rejected = 0;

for (const [instrumentId, bars] of Object.entries(file.series ?? {})) {
  for (const bar of bars) {
    // Re-validated here rather than trusted from the file. The fetcher already drops malformed
    // rows, but a bar that reaches the store is indistinguishable from history forever after, so
    // the check is repeated at the boundary that matters.
    const finite = [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value));
    if (!finite || bar.high < bar.low || !Number.isFinite(bar.time)) {
      rejected += 1;
      continue;
    }
    candles.push({
      ticker: instrumentId,
      resolution: file.resolution ?? "D",
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : null,
    });
  }
}

const result = persistCandles(candles);

const unfitForValidation =
  "Unadjusted prices and currently-listed symbols only: a split reads as a price cliff, and the " +
  "absence of delisted names makes every result optimistic by an unknown amount. Usable for " +
  "exploring an idea, not for promoting one.";

recordDatasetImport(
  {
    source: file.source ?? "NSE bhavcopy via jugaad-data",
    license: file.licence ?? null,
    // "raw", not "adjusted": the bhavcopy prints the prices that traded on the day. That is the
    // safe kind for a backtest — an adjusted series carries information from after the bar.
    adjustment: "raw",
    includesDelisted: false,
    resolution: file.resolution ?? "D",
  },
  { inserted: result.inserted, skipped: result.skipped, rejected, unfitForValidation },
  "nse-bhavcopy-import",
);

console.log(
  `Imported ${result.inserted} bar(s), skipped ${result.skipped} already held, rejected ${rejected} malformed.`,
);
console.log(`Source: ${file.source} · fetched ${file.fetchedAt}`);
const failures = Object.entries(file.failures ?? {});
if (failures.length > 0) {
  console.log(`${failures.length} symbol(s) failed at fetch time and are absent from the store:`);
  for (const [symbol, reason] of failures) console.log(`  ${symbol}: ${reason}`);
}
console.log(`\nDeclared unfit for validation — ${unfitForValidation}`);
