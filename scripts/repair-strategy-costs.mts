/**
 * Repairs strategy specs that declare a round-trip cost below what the owner's capital pays,
 * and invalidates the validation results computed under the old assumption.
 *
 * ## Why the second half is not optional
 *
 * Rewriting the DSL alone would be worse than doing nothing. `evidenceFor` reads the spec's DSL
 * for the cost standing and the `validation_results` row for the profit factor and deflated
 * Sharpe. Fix the DSL without clearing the row and the ladder pairs an honest cost declaration
 * with numbers computed at 20 bps — the strategy sails past the gate on precisely the evidence
 * the gate exists to reject, and it now looks *better* documented than before.
 *
 * So the rows go, and the strategy drops back to "not yet rehearsed". That is the correct state:
 * it has no valid evidence, because the evidence it had described a market that does not exist.
 * The cycle's rehearsal pass will regenerate it honestly.
 *
 * Usage:  npx tsx scripts/repair-strategy-costs.mts [--apply]
 *         (dry run by default — deleting evidence should require saying so)
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { costStanding, requiredCostBps } from "@/lib/strategy/cost-gate";
import { ASSUMED_SLIPPAGE_BPS } from "@/lib/paper/capital";

const apply = process.argv.includes("--apply");
const db = getDb();
const required = requiredCostBps();

console.log(`Required round-trip cost at the owner's capital: ${required} bps\n`);

const specs = db.select().from(schema.strategySpecs).all();
let repaired = 0;
let clearedRows = 0;

for (const spec of specs) {
  const standing = costStanding(spec.dsl);
  if (!standing.understated) continue;

  // Half, because `roundTripCostBps` treats commission and slippage as per-side and doubles both.
  // Slippage is left at its stated assumption so the measured and estimated halves stay separable.
  const perSide = Math.max(0, Math.ceil(required / 2) - ASSUMED_SLIPPAGE_BPS);

  let updated: string;
  try {
    const parsed = JSON.parse(spec.dsl) as Record<string, unknown>;
    parsed.costs = { commissionBps: perSide, slippageBps: ASSUMED_SLIPPAGE_BPS };
    updated = JSON.stringify(parsed);
  } catch {
    console.log(`  SKIP ${spec.name} — DSL will not parse, so it cannot be repaired safely.`);
    continue;
  }

  const rows = db
    .select()
    .from(schema.validationResults)
    .where(eq(schema.validationResults.strategySpecId, spec.id))
    .all();

  console.log(
    `  ${apply ? "REPAIR" : "would repair"} ${spec.name}: ${standing.declaredBps} → ${required} bps` +
      (rows.length ? `, discarding ${rows.length} validation result(s) computed at the old cost` : ""),
  );

  if (apply) {
    db.update(schema.strategySpecs).set({ dsl: updated }).where(eq(schema.strategySpecs.id, spec.id)).run();
    if (rows.length) {
      db.delete(schema.validationResults).where(eq(schema.validationResults.strategySpecId, spec.id)).run();
    }
  }
  repaired += 1;
  clearedRows += rows.length;
}

if (repaired === 0) {
  console.log("Every spec already prices its trading honestly. Nothing to do.");
} else {
  console.log(
    `\n${apply ? "Repaired" : "Would repair"} ${repaired} spec(s) and ` +
      `${apply ? "discarded" : "would discard"} ${clearedRows} validation result(s).`,
  );
  if (!apply) console.log("Dry run. Re-run with --apply to make the change.");
  else console.log("These strategies now have no validation evidence, which is correct — the cycle will rehearse them again against honest costs.");
}
