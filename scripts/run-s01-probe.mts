/**
 * Run the S01 canonical exploratory probe.
 *
 * Direction-neutral; the spread is printed signed as declared (HIGH_SKEW minus LOW_SKEW). Offline.
 *
 * S01 is NOT independent of X01 — both are observables inside the lottery/higher-moment mechanism.
 * A matching result is one finding about lottery demand in NSE equities, not two.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { S01_CONTRACT, S01_CONTRACT_HASH, runS01Probe, type DailyBar, type S01Leg } from "@/lib/research/probe-s01";

const db = getDb();
const rows = db.all<{ ticker: string; d: string; close: number; volume: number }>(
  sql`SELECT ticker, date(time + 19800, 'unixepoch') AS d, close, volume
      FROM price_candles WHERE resolution = 'D' AND ticker IN (
        SELECT ticker FROM price_candles WHERE resolution = 'D' GROUP BY ticker HAVING count(*) >= 750
      ) ORDER BY ticker, d`,
);
const universe = new Map<string, DailyBar[]>();
for (const r of rows) {
  let s = universe.get(r.ticker);
  if (!s) { s = []; universe.set(r.ticker, s); }
  s.push({ date: r.d, close: Number(r.close), volume: Number(r.volume) });
}
const listings = new Map<string, string>();
for (const r of db.all<{ symbol: string; dateOfListing: string | null }>(
  sql`SELECT symbol, date_of_listing AS dateOfListing FROM nse_listing_versions WHERE date_of_listing IS NOT NULL`)) {
  const id = `IN:XNSE:${r.symbol}`; const e = listings.get(id);
  if (!e || (r.dateOfListing && r.dateOfListing < e)) listings.set(id, r.dateOfListing!);
}
const eligibleAt = (id: string, date: string) => { const l = listings.get(id); return !l || l <= date; };

console.log(`S01 — ${S01_CONTRACT.title}`);
console.log(`contract hash    : ${S01_CONTRACT_HASH}`);
console.log(`prior direction  : ${S01_CONTRACT.priorDirection}   spread = ${S01_CONTRACT.spreadDefinition}`);
console.log(`mechanism family : ${S01_CONTRACT.mechanismFamily}`);
console.log(`related          : ${S01_CONTRACT.relatedHypotheses.join(", ")}  (independent: ${S01_CONTRACT.independentOfRelated})`);
console.log(`universe         : ${universe.size} instruments\n`);

const r = runS01Probe(universe, eligibleAt);
const show = (n: string, s: S01Leg, cost: number) => {
  console.log(`${n}`);
  console.log(`  gross ${s.grossMeanBps.toFixed(1).padStart(8)} bps   net ${s.netMeanBps.toFixed(1).padStart(8)} (cost ${cost})   PF ${s.profitFactorGross.toFixed(2)}   HAC t ${s.hac.tStatistic.toFixed(2).padStart(6)}   CI [${(s.hac.ci95[0]*10000).toFixed(0)}, ${(s.hac.ci95[1]*10000).toFixed(0)}]   signProb ${(s.bootstrapSignProbability*100).toFixed(0)}%`);
};
console.log(`rebalances: ${r.rebalances.length}   instruments: ${r.instrumentsSeen}\n`);
show("SPREAD  HIGH_SKEW minus LOW_SKEW  <- PRIMARY", r.spread, S01_CONTRACT.costBpsPerLeg * 2);
show("HIGH-SKEW leg vs its own cohort", r.highVsCohort, S01_CONTRACT.costBpsPerLeg);
show("LOW-SKEW leg vs its own cohort", r.lowVsCohort, S01_CONTRACT.costBpsPerLeg);
show("HIGH-SKEW leg with MAX-extreme names REMOVED", r.highExMaxVsCohort, S01_CONTRACT.costBpsPerLeg);

console.log("\nBY ERA (spread gross bps/month)");
for (const e of r.byEra) {
  console.log(`  ${e.era.padEnd(12)} ${String(e.rebalances).padStart(5)} rebalances  ${e.rebalances === 0 ? "not measured" : e.spreadGrossBps.toFixed(1).padStart(12)}`);
}

const measured = r.byEra.filter((e) => e.rebalances > 0);
const stable = measured.length > 0 && measured.every((e) => Math.sign(e.spreadGrossBps) === Math.sign(measured[0]!.spreadGrossBps));
const g = r.spread.grossMeanBps, cost = S01_CONTRACT.costBpsPerLeg * 2;
console.log(`\nKILL CHECK (predeclared)`);
console.log(`  |spread| vs 2x cost  : ${Math.abs(g).toFixed(1)} vs ${cost} bps`);
console.log(`  sign stable by era   : ${stable ? "YES" : "NO"}`);
console.log(`  dependence-aware |t| : ${Math.abs(r.spread.hac.tStatistic).toFixed(2)}`);
console.log(`  survives ex-MAX      : ${Math.abs(r.highExMaxVsCohort.hac.tStatistic).toFixed(2)} (t)`);
console.log(
  Math.abs(g) < cost ? "  VERDICT: spread cannot cover its own friction — reject."
  : !stable ? "  VERDICT: clears friction but the SIGN flips across eras — reject as unstable."
  : Math.abs(r.spread.hac.tStatistic) < 2 ? "  VERDICT: clears friction and stable, but dependence-aware evidence is null — reject."
  : "  VERDICT: survives the kill check — and is still NOT independent evidence from X01.",
);
console.log(
  [
    "",
    "  Whatever this says, S01 and X01 are two observables inside ONE mechanism. A similar result",
    "  means two lottery/higher-moment observables behave alike — never that two independent",
    "  mechanisms agree. Promotion remains FORBIDDEN; this sits on DISCOVERY_DATA.",
  ].join("\n"),
);
