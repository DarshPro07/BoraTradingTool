/**
 * Propose a family classification for every strategy currently in the registry.
 *
 * ## Read-only, deliberately
 *
 * This writes nothing. A backfill that runs `UPDATE strategy_specs SET family_id = ...` off a name
 * match is how eight orphan specs become eight *confidently wrong* specs — and family identity is
 * the thing the deflated Sharpe denominator is about to be computed from, so a wrong grouping is a
 * wrong statistical claim rather than a tidying error.
 *
 * So it classifies, explains itself, and stops. A human confirms.
 *
 * ## The classification rule
 *
 * A new family requires a material change in the **economic hypothesis**, not a parameter change,
 * a rename, a re-implementation or a new id. When in doubt the answer is SAME_FAMILY, because
 * over-merging costs a little statistical power and under-merging silently resets contamination
 * history — an asymmetry that only points one way.
 *
 * The structural fingerprint below is an **anti-evasion signal, not identity**. It ignores
 * parameter values, so `stop 0.5%` and `stop 0.7%` collapse together as they should; but two
 * genuinely different hypotheses can share a shape, and one hypothesis can be written two ways.
 * Anything the fingerprint cannot settle is reported UNKNOWN and fails closed.
 *
 * Usage:  npx tsx scripts/classify-research-identity.mts
 */
import { getDb, schema } from "@/lib/db";
import { StrategyDslSchema, type Condition, type StrategyDsl } from "@/lib/strategy/dsl";
// One implementation, shared with the ledger that computes the denominator. A second copy here
// would drift, and the two would disagree about whether a strategy is a variant — silently.
import { semanticFingerprint } from "@/lib/strategy/research-identity";

/** Features referenced anywhere in the rule — the information set, which is family-defining. */
function featuresOf(dsl: StrategyDsl): string[] {
  const found = new Set<string>();
  const walk = (condition: Condition): void => {
    if ("feature" in condition) found.add(condition.feature);
    else if ("compare" in condition) condition.compare.forEach((f) => found.add(f));
    else if ("crossover" in condition) condition.crossover.forEach((f) => found.add(f));
    else if ("crossunder" in condition) condition.crossunder.forEach((f) => found.add(f));
    else if ("not" in condition) walk(condition.not);
    else for (const child of "all" in condition ? condition.all : condition.any) walk(child);
  };
  walk(dsl.entry);
  if (dsl.exit.condition) walk(dsl.exit.condition);
  return [...found].sort();
}

const specs = getDb().select().from(schema.strategySpecs).all();

interface Row {
  id: string;
  name: string;
  status: string;
  parsed: StrategyDsl | null;
  fingerprint: string | null;
  features: string[];
}

const rows: Row[] = specs.map((spec) => {
  const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
  const dsl = parsed.success ? parsed.data : null;
  return {
    id: spec.id,
    name: spec.name,
    status: spec.status,
    parsed: dsl,
    fingerprint: dsl ? semanticFingerprint(dsl) : null,
    features: dsl ? featuresOf(dsl) : [],
  };
});

const byFingerprint = new Map<string, Row[]>();
for (const row of rows) {
  if (row.fingerprint === null) continue;
  byFingerprint.set(row.fingerprint, [...(byFingerprint.get(row.fingerprint) ?? []), row]);
}

console.log(`${rows.length} strategy spec(s) in the registry. None currently carries a family.\n`);
console.log("Structural grouping — identical shape, parameters ignored:\n");

for (const [fingerprint, group] of byFingerprint) {
  const names = group.map((row) => row.name).join(", ");
  console.log(`  ${fingerprint}  ${group.length === 1 ? "(alone)" : `(${group.length} together)`}  ${names}`);
  console.log(`             features: ${group[0].features.join(", ") || "none"}`);
  console.log(
    `             market/res: ${group[0].parsed?.universe.market}/${group[0].parsed?.universe.resolution}`,
  );
}

console.log("\n\nProposed classification — every one needs a human decision:\n");

const unparseable = rows.filter((row) => row.parsed === null);
const grouped = [...byFingerprint.values()].filter((group) => group.length > 1);
const alone = [...byFingerprint.values()].filter((group) => group.length === 1).flat();

for (const group of grouped) {
  console.log(`  SAME_FAMILY (structurally identical)  →  ${group.map((r) => r.name).join(" + ")}`);
  console.log("      Same shape, differing only in thresholds. Variants of one idea; each still");
  console.log("      costs its own selection trial.\n");
}

for (const row of alone) {
  console.log(`  UNKNOWN  →  ${row.name}  [${row.status}]`);
  console.log(`      Structurally unique (${row.fingerprint}), which settles nothing on its own:`);
  console.log("      a distinct shape may still be adaptive refinement of an earlier idea. Needs the");
  console.log("      economic hypothesis stated before it can be placed. Fails closed until then.\n");
}

for (const row of unparseable) {
  console.log(`  UNKNOWN  →  ${row.name}  [DSL does not parse against the current compiler]\n`);
}

console.log("\nWhat this means for validation eligibility:\n");
console.log(`  ${rows.length} spec(s) would be validation_eligible = 0 under the new schema,`);
console.log("  because none has a declared campaign or family yet. That is the intended");
console.log("  fail-closed state: a missing identity must block validation rather than");
console.log("  default to a family of one, which is the defect being repaired.\n");
console.log("  Nothing here has been written. Declare the campaigns and families, then re-run.");
