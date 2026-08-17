/**
 * Run the M02 canonical exploratory probe and report it.
 *
 * Reads the store directly, offline. Restricted to the deep cohort, because only those series have
 * six months of formation history before 2024 — and that restriction is itself the probe's largest
 * weakness (see `knownBias` in the contract).
 *
 * Usage:  npx tsx scripts/run-m02-probe.mts
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { M02_CONTRACT, M02_CONTRACT_HASH, runM02Probe, type DailyBar, type LegStatistics } from "@/lib/research/probe-m02";

const db = getDb();

/** Deep series only: six months of formation is impossible on a 500-bar Yahoo series before 2024. */
const rows = db.all<{ ticker: string; d: string; close: number; volume: number }>(
  sql`SELECT ticker, date(time + 19800, 'unixepoch') AS d, close, volume
      FROM price_candles
      WHERE resolution = 'D' AND ticker IN (
        SELECT ticker FROM price_candles WHERE resolution = 'D' GROUP BY ticker HAVING count(*) >= 750
      )
      ORDER BY ticker, d`,
);

const universe = new Map<string, DailyBar[]>();
for (const row of rows) {
  let series = universe.get(row.ticker);
  if (!series) {
    series = [];
    universe.set(row.ticker, series);
  }
  series.push({ date: row.d, close: Number(row.close), volume: Number(row.volume) });
}

/** Point-in-time listing: a stock not yet listed at date t must not be ranked at t. */
const listings = new Map<string, string>();
for (const row of db.all<{ symbol: string; dateOfListing: string | null }>(
  sql`SELECT symbol, date_of_listing AS dateOfListing FROM nse_listing_versions
      WHERE date_of_listing IS NOT NULL`,
)) {
  const id = `IN:XNSE:${row.symbol}`;
  const existing = listings.get(id);
  if (!existing || (row.dateOfListing && row.dateOfListing < existing)) {
    listings.set(id, row.dateOfListing!);
  }
}

let withListingDate = 0;
const eligibleAt = (id: string, date: string): boolean => {
  const listed = listings.get(id);
  if (!listed) return true; // absent listing date: the bars themselves bound the history
  return listed <= date;
};
for (const id of universe.keys()) if (listings.has(id)) withListingDate += 1;

console.log(`M02 — ${M02_CONTRACT.title}`);
console.log(`contract hash        : ${M02_CONTRACT_HASH}  (frozen before any result)`);
console.log(`replication status   : ${M02_CONTRACT.replicationStatus}`);
console.log(`evidence -> target   : ${M02_CONTRACT.evidenceMarket} -> ${M02_CONTRACT.targetMarket} (transfer ${M02_CONTRACT.transferAssumption})`);
console.log(`liquidity proxy      : ${M02_CONTRACT.liquidityProxy}  (source used turnover ratio)`);
console.log(`rights               : ${M02_CONTRACT.rightsStatus}`);
console.log(`known bias           : ${M02_CONTRACT.knownBias}`);
console.log(`universe loaded      : ${universe.size} instruments, ${withListingDate} with a listing date\n`);

const result = runM02Probe(universe, eligibleAt);

const show = (name: string, s: LegStatistics, costBps: number) => {
  console.log(`${name}`);
  console.log(`  rebalances (effective n) : ${s.observations}`);
  console.log(`  gross mean               : ${s.grossMeanBps.toFixed(1)} bps / month`);
  console.log(`  cost                     : ${costBps} bps`);
  console.log(`  net mean                 : ${s.netMeanBps.toFixed(1)} bps / month`);
  console.log(`  gross profit factor      : ${s.profitFactorGross.toFixed(2)}`);
  console.log(`  HAC t (lag ${String(s.hac.lag).padStart(2)})           : ${s.hac.tStatistic.toFixed(2)}`);
  console.log(`  95% CI (bps)             : [${(s.hac.ci95[0] * 10_000).toFixed(0)}, ${(s.hac.ci95[1] * 10_000).toFixed(0)}]`);
  console.log(`  P(mean > 0) bootstrap    : ${(s.probabilityMeanPositive * 100).toFixed(0)}%\n`);
};

console.log(`rebalances: ${result.rebalances.length}   instruments ever ranked: ${result.instrumentsSeen}\n`);
show("LONG-SHORT (factor spread — research diagnosis, not implementable here)", result.longShort, M02_CONTRACT.costBpsPerLeg * 2);
show("LONG-ONLY WINNERS (the implementable leg)", result.longOnly, M02_CONTRACT.costBpsPerLeg);
show("LONG-ONLY minus its own cohort (selection, stripped of market direction)", result.longVsCohort, M02_CONTRACT.costBpsPerLeg);

console.log("BY ERA (gross bps / month)");
console.log("  era          rebalances    long-short     long-only");
for (const era of result.byEra) {
  // An era with no rebalances was NOT MEASURED. Printing 0.0 would read as "no effect", which is a
  // different claim and the one this codebase exists not to make.
  const cells =
    era.rebalances === 0
      ? `${"not measured".padStart(12)}  ${"not measured".padStart(12)}`
      : `${era.longShortGrossBps.toFixed(1).padStart(12)}  ${era.longOnlyGrossBps.toFixed(1).padStart(12)}`;
  console.log(`  ${era.era.padEnd(12)} ${String(era.rebalances).padStart(9)}  ${cells}`);
}
const unmeasured = result.byEra.filter((e) => e.rebalances === 0);
if (unmeasured.length > 0) {
  console.log(
    `
  ${unmeasured.map((e) => e.era).join(", ")} produced no rebalance: too few instruments were
` +
      `  listed and liquid enough to form a ${M02_CONTRACT.minCohortSize}-name cohort at ` +
      `${(M02_CONTRACT.liquidityCohortPct * 100).toFixed(0)}% of the universe.`,
  );
}

const cost = M02_CONTRACT.costBpsPerLeg;
const lsGross = result.longShort.grossMeanBps;
const signs = result.byEra.filter((e) => e.rebalances > 0).map((e) => Math.sign(e.longShortGrossBps));
const consistent = signs.length > 0 && signs.every((s) => s === signs[0]);

console.log(`\nKILL CHECK (predeclared, applied before any deeper analysis)`);
console.log(`  gross long-short vs 2x cost : ${lsGross.toFixed(1)} vs ${cost * 2} bps`);
console.log(`  same sign across all eras   : ${consistent ? "YES" : "NO"}`);
const excessGross = result.longVsCohort.grossMeanBps;
console.log(`  long-only EXCESS over cohort : ${excessGross.toFixed(1)} vs ${cost} bps`);
console.log(
  lsGross <= 0
    ? "  VERDICT: the factor spread is NEGATIVE — winners underperformed losers. Reject, record NO_GROSS_EDGE."
    : lsGross < cost * 2
      ? "  VERDICT: spread positive but below its own friction — not a candidate."
      : consistent
        ? "  VERDICT: clears friction and is sign-consistent across eras — deeper robustness warranted."
        : "  VERDICT: clears friction but flips sign across eras — regime investigation before anything else.",
);
if (result.longOnly.grossMeanBps > cost && excessGross < cost) {
  console.log(
    `
  READ THE LONG-ONLY LEG CAREFULLY. It shows ${result.longOnly.grossMeanBps.toFixed(1)} bps gross,
` +
      `  which looks tradeable — but against its OWN cohort it adds only ${excessGross.toFixed(1)} bps.
` +
      `  Almost all of it is the cohort's return, i.e. exposure to liquid Indian equities over this
` +
      `  period, not momentum selection. A long-only backtest reported without this decomposition
` +
      `  would have looked like a strategy and been market beta.`,
  );
}
console.log(
  `\nWhatever this says, promotion remains FORBIDDEN: validation=false trial=false holdout=false ` +
    `forward=false paper=false. The universe carries survivorship bias and the data carries an ` +
    `unconfirmed access basis. This answers only whether the idea is worth authenticating data for.`,
);
