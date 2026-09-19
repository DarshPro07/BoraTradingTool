/**
 * Drain the daily-refresh backlog left by the ALREADY_READY defect.
 *
 * Ingestion was dead from 2026-08-16 to 2026-08-26 because the executor dismissed every refresh the
 * planner queued. With that fixed the scheduler will drain naturally, but the backlog is ten days
 * across ~2,100 instruments and this walks it deliberately rather than waiting.
 *
 * Paced: the provider is the same one the scheduler uses, and a burst is a different load profile
 * from a daily pass. Safe to re-run — a current instrument short-circuits without a provider call.
 *
 * Usage:  npx tsx scripts/catch-up-daily.mts [--limit 2500] [--delay 250]
 */
import { ingestInstrumentHistory } from "@/lib/market/ingest";
import { planUniverseIngestion, universeCoverage } from "@/lib/market/universe-coverage";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const LIMIT = arg("limit", 2_500);
const DELAY_MS = arg("delay", 250);

const plan = planUniverseIngestion(LIMIT, universeCoverage());
console.log(`Backlog: ${plan.length} instruments queued for work.`);

const tally = new Map<string, number>();
let done = 0;
for (const item of plan) {
  try {
    const out = await ingestInstrumentHistory(item.instrumentId);
    tally.set(out.code, (tally.get(out.code) ?? 0) + 1);
  } catch (error) {
    tally.set("THREW", (tally.get("THREW") ?? 0) + 1);
    void error;
  }
  done += 1;
  if (done % 100 === 0) {
    const summary = [...tally].map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`  ${done}/${plan.length}  ${summary}`);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`\nDone. ${done} processed.`);
for (const [code, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${code.padEnd(24)} ${n}`);
