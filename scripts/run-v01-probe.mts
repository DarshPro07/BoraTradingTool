/**
 * Run the V01 canonical exploratory probe.
 *
 * Direction-neutral. The primary statistic is the INTERACTION — does volume change what follows an
 * extreme move — reported signed as declared and not reversed afterwards. Offline; no provider call.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { V01_CONTRACT, V01_CONTRACT_HASH, runV01Probe, type DailyBar, type V01Leg } from "@/lib/research/probe-v01";

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

console.log(`V01 — ${V01_CONTRACT.title}`);
console.log(`contract hash    : ${V01_CONTRACT_HASH}`);
console.log(`prior direction  : ${V01_CONTRACT.priorDirection}`);
console.log(`primary statistic: ${V01_CONTRACT.primaryStatistic}`);
console.log(`transfer         : ${V01_CONTRACT.transferAssumption}`);
console.log(`universe         : ${universe.size} instruments\n`);

const r = runV01Probe(universe, eligibleAt);
const show = (n: string, s: V01Leg, cost: number) => {
  console.log(`${n}`);
  console.log(`  gross ${s.grossMeanBps.toFixed(1).padStart(8)} bps   net ${s.netMeanBps.toFixed(1).padStart(8)} (cost ${cost})   PF ${s.profitFactorGross.toFixed(2)}   HAC t ${s.hac.tStatistic.toFixed(2).padStart(6)}   CI [${(s.hac.ci95[0]*10000).toFixed(0)}, ${(s.hac.ci95[1]*10000).toFixed(0)}]   signProb ${(s.bootstrapSignProbability*100).toFixed(0)}%`);
};
console.log(`rebalances: ${r.rebalances.length}   instruments: ${r.instrumentsSeen}\n`);
show("INTERACTION  (high-vol spread minus normal-vol spread)  <- PRIMARY", r.interaction, V01_CONTRACT.costBpsPerLeg * 2);
show("  high-volume spread   POS_HIGH - NEG_HIGH", r.highVolumeSpread, V01_CONTRACT.costBpsPerLeg * 2);
show("  normal-volume spread POS_NORMAL - NEG_NORMAL", r.normalVolumeSpread, V01_CONTRACT.costBpsPerLeg * 2);
console.log("\nCELLS (each in excess of the SAME cohort on the SAME date)");
for (const [k, v] of Object.entries(r.cells)) show(`  ${k}`, v, V01_CONTRACT.costBpsPerLeg);

console.log("\nBY ERA (interaction, bps/month)");
for (const e of r.byEra) {
  console.log(`  ${e.era.padEnd(12)} ${String(e.rebalances).padStart(5)} rebalances  ${e.rebalances === 0 ? "not measured" : e.interactionBps.toFixed(1).padStart(12)}`);
}

const measured = r.byEra.filter((e) => e.rebalances > 0);
const stable = measured.length > 0 && measured.every((e) => Math.sign(e.interactionBps) === Math.sign(measured[0]!.interactionBps));
const g = r.interaction.grossMeanBps, cost = V01_CONTRACT.costBpsPerLeg * 2;
console.log(`\nKILL CHECK (predeclared)`);
console.log(`  |interaction| vs 2x cost : ${Math.abs(g).toFixed(1)} vs ${cost} bps`);
console.log(`  sign stable by era       : ${stable ? "YES" : "NO"}`);
console.log(`  dependence-aware |t|     : ${Math.abs(r.interaction.hac.tStatistic).toFixed(2)}`);
console.log(
  Math.abs(g) < cost ? "  VERDICT: interaction cannot cover its own friction — reject."
  : !stable ? "  VERDICT: clears friction but the SIGN flips across eras — reject as unstable."
  : Math.abs(r.interaction.hac.tStatistic) < 2 ? "  VERDICT: clears friction and stable, but dependence-aware evidence is null — reject."
  : `  VERDICT: survives — volume ${g > 0 ? "AMPLIFIES continuation" : "produces REVERSAL"}. Deeper robustness warranted.`,
);
console.log(`\nNo threshold is moved after this. Promotion remains FORBIDDEN on every stage.`);
