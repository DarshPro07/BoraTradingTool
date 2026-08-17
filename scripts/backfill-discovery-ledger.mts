/**
 * Record the looks already taken, so the counter does not start at zero.
 *
 * Three probes have run and thirteen market statistics were inspected on one historical dataset.
 * Starting a fresh ledger at 0 would be the same untruth in a new place: the looks happened, they
 * shaped what gets tested next, and the count has to reflect that.
 *
 * Idempotent — re-running does not double the ledger.
 *
 * Usage:  npx tsx scripts/backfill-discovery-ledger.mts [--apply]
 */
import { allLooks, recordLook, programmeState, adjustFamily, type DiscoveryLook } from "@/lib/research/discovery-ledger";

const apply = process.argv.includes("--apply");
const FAMILY = "foundry-2026-exploratory";
const COHORT = "deep-358-recent-liquidity-selected";

const base = {
  familyId: FAMILY,
  cohortFingerprint: COHORT,
  dataRole: "DISCOVERY_DATA" as const,
  observedAt: "2026-08-17",
};

const looks: DiscoveryLook[] = [
  // M02 — contract 6m/1m liquidity-conditioned momentum.
  { ...base, probeId: "M02", hypothesisId: "M02", statisticId: "longShort", role: "PRIMARY_CONFIRMATORY", declaredBeforeRun: true, directionDeclared: "POSITIVE", estimateBps: -52.6, hacT: -0.79, ci95Bps: [-184, 78], observations: 221, contractHash: "m02" },
  { ...base, probeId: "M02", hypothesisId: "M02", statisticId: "longOnly", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "POSITIVE", estimateBps: 122.4, hacT: 1.69, ci95Bps: [-19, 264], observations: 221, contractHash: "m02" },
  { ...base, probeId: "M02", hypothesisId: "M02", statisticId: "longVsCohort", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "POSITIVE", estimateBps: 12.5, hacT: 0.33, ci95Bps: [-62, 87], observations: 221, contractHash: "m02" },

  // X01 — MAX / lottery, direction UNKNOWN.
  { ...base, probeId: "X01", hypothesisId: "X01", statisticId: "spread", role: "PRIMARY_CONFIRMATORY", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: 78.0, hacT: 1.71, ci95Bps: [-11, 167], observations: 278, contractHash: "x01" },
  { ...base, probeId: "X01", hypothesisId: "X01", statisticId: "highVsCohort", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: 49.5, hacT: 1.81, ci95Bps: [-4, 103], observations: 278, contractHash: "x01" },
  { ...base, probeId: "X01", hypothesisId: "X01", statisticId: "lowVsCohort", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: -28.5, hacT: -1.36, ci95Bps: [-69, 12], observations: 278, contractHash: "x01" },

  // V01 — return x volume, direction UNKNOWN. Seven statistics.
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "interaction", role: "PRIMARY_CONFIRMATORY", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: 114.1, hacT: 1.74, ci95Bps: [-15, 243], observations: 261, contractHash: "v01" },
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "highVolumeSpread", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: -16.3, hacT: -0.38, ci95Bps: [-100, 68], observations: 261, contractHash: "v01" },
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "normalVolumeSpread", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: -130.4, hacT: -1.92, ci95Bps: [-264, 3], observations: 261, contractHash: "v01" },
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "cell.posHigh", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: -16.0, hacT: -0.68, ci95Bps: [-62, 30], observations: 261, contractHash: "v01" },
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "cell.posNormal", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: -34.4, hacT: -0.64, ci95Bps: [-139, 71], observations: 261, contractHash: "v01" },
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "cell.negHigh", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: 0.2, hacT: 0.01, ci95Bps: [-50, 51], observations: 261, contractHash: "v01" },
  { ...base, probeId: "V01", hypothesisId: "V01", statisticId: "cell.negNormal", role: "SECONDARY_PREDECLARED", declaredBeforeRun: true, directionDeclared: "UNKNOWN", estimateBps: 96.0, hacT: 3.01, ci95Bps: [34, 158], observations: 261, contractHash: "v01" },
];

const existing = new Set(allLooks().map((l) => `${l.probeId}:${l.statisticId}`));
const fresh = looks.filter((l) => !existing.has(`${l.probeId}:${l.statisticId}`));

console.log(`Backfill: ${looks.length} historical looks, ${fresh.length} not yet recorded.\n`);
if (apply) for (const l of fresh) recordLook(l);

const state = programmeState();
console.log("PROGRAMME STATE — both numbers, always together");
console.log(`  registeredTrialCount   : ${state.registeredTrialCount}`);
console.log(`  probeDiscoveryLooks    : ${state.probeDiscoveryLooks}`);
console.log(`  probes                 : ${state.probes.join(", ") || "(none)"}`);
console.log();

const adjusted = adjustFamily(apply ? allLooks(FAMILY) : looks);
console.log("FAMILY-WIDE ADJUSTMENT (Holm for error control, BH for ranking only)");
console.log("  statistic                     t      raw p     Holm p      BH q   promotable");
for (const a of adjusted.slice(0, 6)) {
  console.log(
    `  ${(a.probeId + "." + a.statisticId).padEnd(26)} ${a.hacT.toFixed(2).padStart(6)}  ${a.rawP.toFixed(4)}   ${a.holmP.toFixed(4)}   ${a.bhQ.toFixed(4)}        ${a.role === "POST_HOC_DISCOVERY" || a.dataRole === "DISCOVERY_DATA" ? "NO" : "yes"}`,
  );
}
console.log(`  ... ${Math.max(0, adjusted.length - 6)} more\n`);
console.log(
  "An adjusted p-value is NOT a retroactive pre-registration machine. A crude 13-look screen still\n" +
  "leaves V01's negNormal cell under .05, and the cell remains POST HOC and therefore is not\n" +
  "confirmatory evidence. Nothing here is promotable: every look sits on DISCOVERY_DATA.",
);
if (!apply) console.log("\nReport only. Re-run with --apply to write the ledger.");
