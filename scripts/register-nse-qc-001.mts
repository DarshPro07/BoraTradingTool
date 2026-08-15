/**
 * Register campaign NSE-QC-001 and its five declared families (owner directive 2026-08-15).
 *
 * The declaration lives in lib/strategy/campaigns/nse-qc-001.ts and its human-readable contract
 * in docs/plans/nse-qc-001/02-contract.md — this script only carries it into the database
 * through the registry, which:
 *   - is idempotent (identical re-run: "unchanged"),
 *   - REFUSES a changed family (declaration_hash mismatch) rather than silently redefining it,
 *   - REFUSES a redefined campaign question.
 *
 * Safe to re-run. Never edits an existing row.
 *
 * Usage:  npx tsx scripts/register-nse-qc-001.mts
 *         (MARKETPULSE_DB_PATH selects the database; unset = the production marketpulse.db)
 */
import { registerCampaignDeclaration } from "../lib/strategy/campaign-registry";
import { NSE_QC_001 } from "../lib/strategy/campaigns/nse-qc-001";

const report = registerCampaignDeclaration(NSE_QC_001, "owner:register-nse-qc-001");

console.log(`campaign ${NSE_QC_001.campaignId}: ${report.campaign}`);
for (const family of report.families) {
  console.log(`  ${family.familyId}: ${family.outcome}${family.reason ? ` — ${family.reason}` : ""}`);
}
if (report.refusals.length > 0) {
  console.error(`\nREFUSALS (${report.refusals.length}) — nothing was redefined:`);
  for (const refusal of report.refusals) console.error(`  - ${refusal}`);
  process.exit(1);
}
console.log("\nThe pin holds: re-running with an edited declaration will refuse, not redefine.");
