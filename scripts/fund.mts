/**
 * The autonomous paper fund, by hand. The scheduled cycle runs the same pass every 15 minutes.
 *
 *   npx tsx scripts/fund.mts run      one pass now (decide / execute / mark / kill)
 *   npx tsx scripts/fund.mts report   metrics and trust gates, from the ledger
 */
import { realFundDeps } from "@/lib/fund/deps";
import { fundReport } from "@/lib/fund/report";
import { runFundPass } from "@/lib/fund/run";
import { withCycleLease } from "@/lib/learning/lease";

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(2)}%`);

if (process.argv[2] === "run") {
  // The same lease the scheduled cycle holds: a manual pass at the moment a cycle runs would
  // otherwise read the same ledger and decide, or buy, twice.
  const outcome = await withCycleLease("fund-manual", () => runFundPass(realFundDeps));
  console.log(outcome.acquired ? JSON.stringify(outcome.result, null, 2) : `Skipped: ${outcome.blockedBy?.holder} holds the cycle lease.`);
} else {
  for (const r of fundReport()) {
    const m = r.metrics;
    console.log(`\n${r.contract.id}  ${r.contract.title}${r.suspended ? "   [SUSPENDED]" : ""}`);
    console.log(`  hash ${r.hash} · days ${m.daysLive} · decisions ${r.decisions.length} · holding ${r.holding}`);
    console.log(`  NAV ${m.navNow?.toFixed(2) ?? "—"} · return ${pct(m.totalReturn)} vs buy-and-hold ${pct(m.benchmarkReturn)}`);
    console.log(`  max DD ${pct(m.maxDrawdown)} vs ${pct(m.benchmarkMaxDrawdown)} · Sharpe(ann) ${m.annualizedSharpe?.toFixed(2) ?? "—"}`);
    console.log(`  gates T1 ${r.gates.T1_OPERATIONAL} · T2 ${r.gates.T2_BEHAVES_AS_DECLARED} · T3 ${r.gates.T3_STATISTICAL} · live-eligible ${r.gates.eligibleToProposeLive}`);
    for (const reason of r.gates.reasons) console.log(`    - ${reason}`);
    const last = r.decisions.at(-1);
    if (last) console.log(`  last decision ${last.decisionDate}: ${last.hold ? "HOLD" : "OUT"} ${JSON.stringify(last.inputs)}`);
  }
}
