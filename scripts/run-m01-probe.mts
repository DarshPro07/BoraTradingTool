/**
 * Run M01 — the last admitted runnable hypothesis in this discovery cycle.
 *
 * Definition unchanged from registration. No parameter reacts to M02's failure. Offline.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { M01_CONTRACT, M01_CONTRACT_HASH, runM01Probe, type DailyBar, type LegStatistics } from "@/lib/research/probe-m01";

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

console.log(`M01 — ${M01_CONTRACT.title}`);
console.log(`contract hash : ${M01_CONTRACT_HASH}`);
console.log(`formation     : ${M01_CONTRACT.formationSessions} sessions (M02 used 126 — the only difference)`);
console.log(`related       : ${M01_CONTRACT.relatedHypotheses.join(", ")}  (independent: ${M01_CONTRACT.independentOfRelated})`);
console.log(`universe      : ${universe.size} instruments\n`);

const r = runM01Probe(universe, eligibleAt);
const show = (n: string, s: LegStatistics, cost: number) => {
  console.log(`${n}`);
  console.log(`  gross ${s.grossMeanBps.toFixed(1).padStart(8)} bps   net ${s.netMeanBps.toFixed(1).padStart(8)} (cost ${cost})   PF ${s.profitFactorGross.toFixed(2)}   HAC t ${s.hac.tStatistic.toFixed(2).padStart(6)}   CI [${(s.hac.ci95[0]*10000).toFixed(0)}, ${(s.hac.ci95[1]*10000).toFixed(0)}]   signProb ${(s.bootstrapSignProbability*100).toFixed(0)}%`);
};
console.log(`rebalances: ${r.rebalances.length}   instruments: ${r.instrumentsSeen}\n`);
show("LONG-SHORT factor spread  <- PRIMARY", r.longShort, M01_CONTRACT.costBpsPerLeg * 2);
show("LONG-ONLY winners (absolute)", r.longOnly, M01_CONTRACT.costBpsPerLeg);
show("WINNERS vs their own cohort", r.longVsCohort, M01_CONTRACT.costBpsPerLeg);
show("LOSERS  vs their own cohort", r.shortVsCohort, M01_CONTRACT.costBpsPerLeg);

console.log("\nBY ERA (gross bps/month)");
console.log("  era          rebalances    long-short     long-only");
for (const e of r.byEra) {
  const cells = e.rebalances === 0
    ? `${"not measured".padStart(12)}  ${"not measured".padStart(12)}`
    : `${e.longShortGrossBps.toFixed(1).padStart(12)}  ${e.longOnlyGrossBps.toFixed(1).padStart(12)}`;
  console.log(`  ${e.era.padEnd(12)} ${String(e.rebalances).padStart(9)}  ${cells}`);
}

const measured = r.byEra.filter((e) => e.rebalances > 0);
const stable = measured.length > 0 && measured.every((e) => Math.sign(e.longShortGrossBps) === Math.sign(measured[0]!.longShortGrossBps));
const g = r.longShort.grossMeanBps, cost = M01_CONTRACT.costBpsPerLeg * 2;
console.log(`\nKILL CHECK (predeclared)`);
console.log(`  gross vs 2x cost     : ${g.toFixed(1)} vs ${cost} bps`);
console.log(`  sign stable by era   : ${stable ? "YES" : "NO"}`);
console.log(`  dependence-aware |t| : ${Math.abs(r.longShort.hac.tStatistic).toFixed(2)}`);
console.log(`  winners vs cohort    : ${r.longVsCohort.grossMeanBps.toFixed(1)} bps (t ${r.longVsCohort.hac.tStatistic.toFixed(2)})`);
console.log(
  g <= 0 ? "  VERDICT: factor spread NEGATIVE — reject, record NO_GROSS_EDGE."
  : g < cost ? "  VERDICT: positive but below its own friction — reject."
  : !stable ? "  VERDICT: clears friction but the SIGN flips across eras — reject as unstable."
  : Math.abs(r.longShort.hac.tStatistic) < 2 ? "  VERDICT: clears friction and stable, but dependence-aware evidence is null — reject."
  : "  VERDICT: survives the kill check — a LEAD on DISCOVERY_DATA, not a finding.",
);
console.log(
  [
    "",
    "  M01 is the last admitted runnable hypothesis in this cycle. Whatever this says, no parameter",
    "  moves in response and no new technical factor is invented to replace it. Promotion FORBIDDEN.",
  ].join("\n"),
);
