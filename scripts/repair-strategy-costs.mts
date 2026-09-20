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
import { requiredCostBps } from "@/lib/strategy/cost-gate";
import { repairDeclaredCosts } from "@/lib/strategy/cost-repair";

const apply = process.argv.includes("--apply");
const db = getDb();

console.log(
  `Required round-trip cost at the owner's capital: ${requiredCostBps("DELIVERY")} bps delivery, ` +
    `${requiredCostBps("INTRADAY")} bps intraday (each spec is priced at the one its resolution implies).
`,
);

const specs = db.select().from(schema.strategySpecs).all();
let repaired = 0;
let clearedRows = 0;

for (const spec of specs) {
  const repair = repairDeclaredCosts(spec.dsl);
  if (repair.kind === "sound") continue;
  if (repair.kind === "unrepairable") {
    console.log(`  SKIP ${spec.name} — ${repair.message}.`);
    continue;
  }
  const { json: updated, product, declaredBps, requiredBps: required } = repair;

  const rows = db
    .select()
    .from(schema.validationResults)
    .where(eq(schema.validationResults.strategySpecId, spec.id))
    .all();

  console.log(
    `  ${apply ? "REPAIR" : "would repair"} ${spec.name} (${product}): ${declaredBps} → ${required} bps` +
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
