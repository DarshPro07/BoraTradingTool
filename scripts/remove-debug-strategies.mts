/**
 * Remove strategy specs that were only ever debugging artefacts.
 *
 * `collision_probe` and `dup_probe_1` were written to exercise the registry's duplicate-name and
 * hash-collision paths. They are not ideas anybody had about a market, and leaving them in the
 * registry inflates every count the Strategy Lab reports — "8 strategies" reads as eight
 * hypotheses under test when two of them are test fixtures.
 *
 * ## The refusal is the point
 *
 * A strategy that has been through a trial may **not** be deleted, ever. `delete_trial_record` is
 * one of the eleven permanently prohibited actions (`lib/governance/policy.ts`): removing a spec
 * that spent a trial would silently lower the multiple-testing denominator, which makes every
 * surviving strategy in that family look better than the evidence says. Deleting a *failed* one is
 * worse still — that is how a registry ends up showing only winners.
 *
 * So this checks first and refuses loudly. A debug artefact has no evidence attached by
 * definition; anything that does is not a debug artefact, whatever it is called.
 *
 * Usage:  npx tsx scripts/remove-debug-strategies.mts [name...]
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

const DEFAULT_NAMES = ["collision_probe", "dup_probe_1"];
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_NAMES;

const db = getDb();

const specs = db.select().from(schema.strategySpecs).where(inArray(schema.strategySpecs.name, names)).all();

if (specs.length === 0) {
  console.log(`No strategy named ${names.join(", ")} is in the registry. Nothing to do.`);
  process.exit(0);
}

/** Evidence that makes a spec permanent. Counted per table so the refusal can say which. */
function evidenceFor(specId: string): { table: string; rows: number }[] {
  const counts = [
    { table: "trials", rows: db.select().from(schema.trials).where(eq(schema.trials.strategySpecId, specId)).all().length },
    {
      table: "validation_results",
      rows: db.select().from(schema.validationResults).where(eq(schema.validationResults.strategySpecId, specId)).all().length,
    },
    {
      table: "forward_outcomes",
      rows: db.select().from(schema.forwardOutcomes).where(eq(schema.forwardOutcomes.strategySpecId, specId)).all().length,
    },
    {
      table: "holdout_ledger",
      rows: db.select().from(schema.holdoutLedger).where(eq(schema.holdoutLedger.strategySpecId, specId)).all().length,
    },
  ];
  return counts.filter((entry) => entry.rows > 0);
}

let refused = 0;
const removable: typeof specs = [];

for (const spec of specs) {
  const evidence = evidenceFor(spec.id);
  if (evidence.length > 0) {
    refused += 1;
    console.error(
      `REFUSED ${spec.name} (${spec.id}) — it carries ${evidence
        .map((entry) => `${entry.rows} ${entry.table}`)
        .join(", ")}. A spec that has been measured is part of the multiple-testing record and is ` +
        "never deleted; removing it would make every surviving sibling look better than the evidence says.",
    );
    continue;
  }
  removable.push(spec);
}

for (const spec of removable) {
  // Rehearsal outcomes go with it. A rehearsal spends no trial and carries no statistical weight,
  // so it is not evidence in the sense above — but leaving it orphaned would keep the spec's ghost
  // in the ladder's reads.
  db.delete(schema.rehearsalOutcomes).where(eq(schema.rehearsalOutcomes.strategySpecId, spec.id)).run();
  db.delete(schema.strategySpecs).where(eq(schema.strategySpecs.id, spec.id)).run();
  console.log(`Removed ${spec.name} (${spec.id}) — no trial, no validation, no forward observation.`);
}

const remaining = db.select().from(schema.strategySpecs).all();
console.log(`\n${removable.length} removed, ${refused} refused. ${remaining.length} strategy(ies) remain:`);
for (const spec of remaining) console.log(`  ${spec.name} — ${spec.status}`);

if (refused > 0) process.exit(1);
