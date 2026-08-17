/**
 * Run the X01 canonical exploratory probe and report it.
 *
 * Direction-neutral: the spread is printed signed exactly as the contract declares
 * (HIGH_MAX minus LOW_MAX) and is NOT reversed after the fact. Offline; no provider call.
 *
 * Usage:  npx tsx scripts/run-x01-probe.mts
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { X01_CONTRACT, X01_CONTRACT_HASH, runX01Probe, type DailyBar, type X01Leg } from "@/lib/research/probe-x01";

const db = getDb();
const rows = db.all<{ ticker: string; d: string; close: number; volume: number }>(
  sql`SELECT ticker, date(time + 19800, 'unixepoch') AS d, close, volume
      FROM price_candles WHERE resolution = 'D' AND ticker IN (
        SELECT ticker FROM price_candles WHERE resolution = 'D' GROUP BY ticker HAVING count(*) >= 750
      ) ORDER BY ticker, d`,
);

const universe = new Map<string, DailyBar[]>();
for (const row of rows) {
  let s = universe.get(row.ticker);
  if (!s) { s = []; universe.set(row.ticker, s); }
  s.push({ date: row.d, close: Number(row.close), volume: Number(row.volume) });
}

const listings = new Map<string, string>();
for (const row of db.all<{ symbol: string; dateOfListing: string | null }>(
  sql`SELECT symbol, date_of_listing AS dateOfListing FROM nse_listing_versions WHERE date_of_listing IS NOT NULL`,
)) {
  const id = `IN:XNSE:${row.symbol}`;
  const existing = listings.get(id);
  if (!existing || (row.dateOfListing && row.dateOfListing < existing)) listings.set(id, row.dateOfListing!);
}
const eligibleAt = (id: string, date: string) => { const l = listings.get(id); return !l || l <= date; };

console.log(`X01 — ${X01_CONTRACT.title}`);
console.log(`contract hash      : ${X01_CONTRACT_HASH}  (frozen before any result)`);
console.log(`prior direction    : ${X01_CONTRACT.priorDirection}   spread = ${X01_CONTRACT.spreadDefinition}`);
console.log(`price bands        : ${X01_CONTRACT.priceBandCensoring}`);
console.log(`rights             : ${X01_CONTRACT.rightsStatus}`);
console.log(`universe           : ${universe.size} instruments\n`);

const r = runX01Probe(universe, eligibleAt);
const show = (name: string, s: X01Leg, cost: number) => {
  console.log(name);
  console.log(`  n (rebalances)        : ${s.observations}`);
  console.log(`  gross                 : ${s.grossMeanBps.toFixed(1)} bps/month`);
  console.log(`  net (cost ${String(cost).padStart(2)} bps)    : ${s.netMeanBps.toFixed(1)} bps/month`);
  console.log(`  gross profit factor   : ${s.profitFactorGross.toFixed(2)}`);
  console.log(`  HAC t (lag ${String(s.hac.lag).padStart(2)})        : ${s.hac.tStatistic.toFixed(2)}`);
  console.log(`  95% CI (bps)          : [${(s.hac.ci95[0] * 10_000).toFixed(0)}, ${(s.hac.ci95[1] * 10_000).toFixed(0)}]`);
  console.log(`  bootstrap sign prob.* : ${(s.bootstrapSignProbability * 100).toFixed(0)}%\n`);
};

console.log(`rebalances: ${r.rebalances.length}   instruments ever ranked: ${r.instrumentsSeen}\n`);
show("SPREAD  HIGH_MAX minus LOW_MAX (signed as declared)", r.spread, X01_CONTRACT.costBpsPerLeg * 2);
show("HIGH-MAX leg vs its own cohort", r.highVsCohort, X01_CONTRACT.costBpsPerLeg);
show("LOW-MAX leg vs its own cohort", r.lowVsCohort, X01_CONTRACT.costBpsPerLeg);

console.log("BY ERA (spread gross bps/month, signed as declared)");
for (const e of r.byEra) {
  console.log(`  ${e.era.padEnd(12)} ${String(e.rebalances).padStart(5)} rebalances  ${e.rebalances === 0 ? "not measured" : e.spreadGrossBps.toFixed(1).padStart(12)}`);
}

const measured = r.byEra.filter((e) => e.rebalances > 0);
const signs = measured.map((e) => Math.sign(e.spreadGrossBps));
const stable = signs.length > 0 && signs.every((s) => s === signs[0]);
const g = r.spread.grossMeanBps;
const cost = X01_CONTRACT.costBpsPerLeg * 2;

console.log(`\nKILL CHECK (predeclared)`);
console.log(`  |gross| vs 2x cost   : ${Math.abs(g).toFixed(1)} vs ${cost} bps`);
console.log(`  sign stable by era   : ${stable ? "YES" : "NO"}`);
console.log(`  dependence-aware |t| : ${Math.abs(r.spread.hac.tStatistic).toFixed(2)}`);
console.log(
  Math.abs(g) < cost
    ? "  VERDICT: spread cannot cover its own friction — reject, record FRICTION / NO_GROSS_EDGE."
    : !stable
      ? "  VERDICT: clears friction but the SIGN flips across eras — reject as unstable."
      : Math.abs(r.spread.hac.tStatistic) < 2
        ? "  VERDICT: clears friction and stable, but dependence-aware evidence is null — reject."
        : `  VERDICT: survives the kill check with sign ${g > 0 ? "POSITIVE (India-style)" : "NEGATIVE (classic lottery)"} — deeper robustness warranted.`,
);
console.log(
  `\nNo parameter is moved after this. MAX1/MAX3/MAX5, alternative quantiles and alternative holds\n` +
    `are NOT tried in response to the result — that would turn one hypothesis into an uncounted\n` +
    `optimizer. Promotion remains FORBIDDEN on every stage.`,
);
