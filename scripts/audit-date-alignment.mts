/**
 * Universe-wide date-alignment audit.
 *
 * `RELIANCE`, `TCS` and `HDFCBANK` were found holding daily series stamped one calendar day early —
 * 429 of 436 closes matched an independent source at +1 day. Fixing those three does not prove the
 * other ~2,100 are sound, and the session-calendar guard cannot answer the question: a Monday bar
 * written to the preceding Friday sits on two legitimate sessions and passes every structural check
 * while still delivering tomorrow's price under today's date.
 *
 * What does answer it is correlation. An equity's returns move with its market contemporaneously; a
 * displaced series peaks at a lag instead. See `lib/market/date-alignment.ts`.
 *
 * The market factor is built from EVERY instrument, so the majority defines alignment. A handful of
 * displaced series cannot move a 2,000-instrument cross-sectional mean, which is what lets the test
 * find them without needing a reference series known to be correct.
 *
 * Runs entirely offline against stored bars — no provider call.
 *
 * Usage:  npx tsx scripts/audit-date-alignment.mts [--from 2024-09-01]
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assessAlignment, marketReturnFactor, MIN_OBSERVATIONS } from "@/lib/market/date-alignment";

const fromArg = process.argv.indexOf("--from");
const FROM = fromArg >= 0 ? process.argv[fromArg + 1]! : "2024-09-01";

const rows = getDb().all<{ ticker: string; d: string; close: number }>(
  sql`SELECT ticker, date(time + 19800, 'unixepoch') AS d, close
      FROM price_candles
      WHERE resolution = 'D' AND time > strftime('%s', ${FROM})
      ORDER BY ticker, d`,
);

const byInstrument = new Map<string, Map<string, number>>();
for (const row of rows) {
  let series = byInstrument.get(row.ticker);
  if (!series) {
    series = new Map();
    byInstrument.set(row.ticker, series);
  }
  series.set(row.d, Number(row.close));
}

const factor = marketReturnFactor(byInstrument);
console.log(`Window          : ${FROM} onward`);
console.log(`Instruments     : ${byInstrument.size}`);
console.log(`Factor sessions : ${factor.size}\n`);

const verdicts = [...byInstrument.entries()]
  .map(([id, series]) => assessAlignment(id, series, factor))
  .sort((a, b) => b.correlationAtBest - b.correlationAtZero - (a.correlationAtBest - a.correlationAtZero));

const tally = new Map<string, number>();
for (const v of verdicts) tally.set(v.status, (tally.get(v.status) ?? 0) + 1);
for (const [status, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status.padEnd(26)} ${String(n).padStart(5)}`);
}

const suspected = verdicts.filter((v) => v.status === "DATE_ALIGNMENT_SUSPECTED");
if (suspected.length > 0) {
  console.log(`\nDATE_ALIGNMENT_SUSPECTED — quarantine before research:\n`);
  for (const v of suspected) {
    console.log(
      `  ${v.instrumentId.padEnd(28)} bestLag=${v.bestLag >= 0 ? "+" : ""}${v.bestLag}  ` +
        `corr@0=${v.correlationAtZero.toFixed(3)}  corr@best=${v.correlationAtBest.toFixed(3)}  n=${v.observations}`,
    );
  }
} else {
  console.log(`\nNo instrument peaks at a non-zero lag. No date displacement detected.`);
}

// Reported, never folded into "aligned": not-measured and measured-clean are different claims.
const thin = verdicts.filter((v) => v.status === "INSUFFICIENT_DATA");
const flat = verdicts.filter((v) => v.status === "UNCORRELATED");
console.log(
  `\nNot assessable: ${thin.length} with < ${MIN_OBSERVATIONS} shared returns, ` +
    `${flat.length} too weakly correlated with the market for the test to speak.`,
);

// The three known-bad series, as a positive control that the test can still see a real shift.
const controls = ["IN:XNSE:RELIANCE", "IN:XNSE:TCS", "IN:XNSE:HDFCBANK"];
console.log(`\nRepaired series (should now be ALIGNED at lag 0):`);
for (const id of controls) {
  const v = verdicts.find((x) => x.instrumentId === id);
  if (v) {
    console.log(
      `  ${id.padEnd(28)} ${v.status.padEnd(26)} bestLag=${v.bestLag >= 0 ? "+" : ""}${v.bestLag}  ` +
        `corr@0=${v.correlationAtZero.toFixed(3)}`,
    );
  }
}
