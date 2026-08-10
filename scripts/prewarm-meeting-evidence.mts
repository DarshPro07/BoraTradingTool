/**
 * Pre-warms a RECORDED HISTORICAL MARKET EVIDENCE database (owner Task 0, 2026-08-10 22:43).
 *
 * ## What this is, and what it deliberately is not
 *
 * These are real bars, really fetched from the configured provider, written into the canonical
 * store with their provenance declared. They are NOT fixtures, and the word "demo data" must not
 * be used for them: fixtures are invented, this is recorded evidence.
 *
 * The declaration is the load-bearing part. Yahoo serves NSE history back-adjusted for later
 * corporate actions, which means every bar contains information from after it — so
 * `validationFitness` marks the dataset UNFIT FOR VALIDATION and the audit trail records that
 * verdict permanently. That is correct and it is why this database is legitimate for
 * *demonstrating the workflow* and illegitimate for *promoting a strategy*. Anyone reading the
 * ledger later sees exactly which it was.
 *
 * Usage:
 *   MARKETPULSE_DB_PATH=<path> npx tsx scripts/prewarm-meeting-evidence.mts
 */
import { getProvider } from "@/lib/providers";
import { persistCandles, recordDatasetImport } from "@/lib/market/candle-store";
import { validationFitness, type DatasetDeclaration, type ImportedCandle } from "@/lib/market/dataset-import";
import { parseInstrument } from "@/lib/market/instruments";

const INSTRUMENTS = ["IN:XNSE:SBIN", "IN:XNSE:RELIANCE", "IN:XNSE:TCS", "IN:XNSE:NIFTYBEES"];

/** Daily carries the strategy history; 5-minute carries the intraday demonstration. */
const PLAN: { resolution: "D" | "5"; days: number }[] = [
  { resolution: "D", days: 3 * 365 },
  { resolution: "5", days: 55 },
];

function declarationFor(resolution: string): DatasetDeclaration {
  return {
    source: "provider:yahoo",
    license: null,
    // Yahoo back-adjusts NSE history. Declared, never assumed away — this is what makes the
    // dataset honestly unfit for validation rather than quietly contaminated.
    adjustment: "adjusted",
    includesDelisted: false,
    resolution,
  };
}

async function main(): Promise<void> {
  const provider = getProvider();
  const to = Math.floor(Date.now() / 1000);
  const report: { instrument: string; resolution: string; fetched: number; inserted: number; first: string; last: string }[] = [];

  for (const { resolution, days } of PLAN) {
    const from = to - days * 86_400;
    const batch: ImportedCandle[] = [];

    for (const instrumentId of INSTRUMENTS) {
      const instrument = parseInstrument(instrumentId);
      try {
        const candles = await provider.getCandles(instrument.providerSymbol, resolution, from, to);
        if (candles.length === 0) {
          console.log(`  ${instrumentId} ${resolution}: provider returned no bars (recorded as zero, not skipped silently)`);
          report.push({ instrument: instrumentId, resolution, fetched: 0, inserted: 0, first: "-", last: "-" });
          continue;
        }
        for (const candle of candles) {
          batch.push({
            ticker: instrumentId,
            resolution,
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume ?? null,
          });
        }
        const times = candles.map((candle) => candle.time);
        report.push({
          instrument: instrumentId,
          resolution,
          fetched: candles.length,
          inserted: 0,
          first: new Date(Math.min(...times) * 1000).toISOString().slice(0, 16),
          last: new Date(Math.max(...times) * 1000).toISOString().slice(0, 16),
        });
      } catch (caught) {
        // A provider failure is reported, never papered over with generated bars.
        console.log(`  ${instrumentId} ${resolution}: FETCH FAILED — ${caught instanceof Error ? caught.message : String(caught)}`);
        report.push({ instrument: instrumentId, resolution, fetched: 0, inserted: 0, first: "FAILED", last: "FAILED" });
      }
    }

    if (batch.length === 0) continue;
    const result = persistCandles(batch);
    const declaration = declarationFor(resolution);
    recordDatasetImport(
      declaration,
      { ...result, rejected: 0, unfitForValidation: validationFitness(declaration) },
      "prewarm-meeting-evidence",
    );
    for (const row of report) if (row.resolution === resolution && row.fetched > 0) row.inserted = result.inserted;
    console.log(`\n${resolution}: fetched ${batch.length} bars → inserted ${result.inserted}, skipped ${result.skipped}`);
    console.log(`   declared: ${declaration.source} · adjustment=${declaration.adjustment} · delisted=${declaration.includesDelisted}`);
    console.log(`   fitness : ${validationFitness(declaration) ?? "fit for validation"}`);
  }

  console.log("\nRECORDED HISTORICAL MARKET EVIDENCE");
  for (const row of report) {
    console.log(`  ${row.instrument.padEnd(20)} ${row.resolution.padEnd(3)} ${String(row.fetched).padStart(6)} bars  ${row.first} → ${row.last}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
