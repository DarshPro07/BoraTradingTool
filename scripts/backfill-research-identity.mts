/**
 * Backfill research identity for the strategies already in the registry.
 *
 * ## What this writes, and what it refuses to
 *
 * Owner instruction, 2026-08-09:
 *
 *   1. `sma_cross_20_50` and `sma_cross_ui_probe` go in the **same declared family** — the
 *      classifier found them structurally identical, differing only in thresholds, which makes
 *      them variants of one idea rather than two ideas.
 *   2. **Do not guess families for the other six.** They stay unclassified and
 *      validation-ineligible until an economic hypothesis is written for each.
 *
 * ## Why the unclassified six get no row at all
 *
 * `strategy_identity` requires a non-null campaign and family, deliberately: a nullable family is
 * how a "family of one" default creeps back in. So an unplaceable spec gets **no identity row**,
 * and `validationStanding()` refuses it — which is exactly the required fail-closed behaviour.
 *
 * Absence alone is ambiguous, though: it cannot distinguish "examined and could not be placed"
 * from "nobody has looked yet". So each refusal is recorded as an audit event. The schema stays
 * strict and the decision stays auditable.
 *
 * Safe to re-run. Existing rows are left untouched rather than overwritten — a placement that has
 * already had trials counted against it must not be silently moved to another family.
 *
 * Usage:  npx tsx scripts/backfill-research-identity.mts
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { researchIdentityReady, semanticFingerprint } from "@/lib/strategy/research-identity";

if (!researchIdentityReady()) {
  console.error(
    "The research-identity tables are not present. Register 0008_research_identity.sql in " +
      "lib/db/migrate.ts and re-run — this script will not create schema behind the migration runner.",
  );
  process.exit(2);
}

const CAMPAIGN = {
  id: "camp_2026_intraday_india",
  name: "Indian equities, small-capital viability",
  question:
    "At the owner's capital, does any strategy clear its own round-trip cost on unbiased forward " +
    "evidence? Every strategy tested under this campaign shares one dataset and one search, so " +
    "contamination is shared across all of them.",
};

/** The only placement the structure justifies without a stated hypothesis. */
const DECLARED_FAMILIES = [
  {
    id: "fam_sma_crossover",
    name: "Moving-average crossover",
    economicHypothesis:
      "A short moving average crossing a longer one marks a change in trend that persists long " +
      "enough to be traded. Classical trend-following; the oldest published systematic idea there is.",
    mechanism: "Cross of SMA(20) over SMA(50) on daily bars, long only.",
    allowedVariantDimensions: JSON.stringify({
      fast_window: "5-50",
      slow_window: "20-200",
      stop: "any",
      target: "any",
      universe: "any equity",
    }),
    members: ["sma_cross_20_50", "sma_cross_ui_probe"],
  },
];

const db = getDb();
const now = new Date();

function parse(raw: string): StrategyDsl | null {
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---- campaign -------------------------------------------------------------
const campaignExists = db
  .select()
  .from(schema.researchCampaigns)
  .where(eq(schema.researchCampaigns.id, CAMPAIGN.id))
  .get();

if (!campaignExists) {
  db.insert(schema.researchCampaigns)
    .values({ ...CAMPAIGN, createdAt: now, createdBy: "owner:backfill-2026-08-09" })
    .run();
  console.log(`campaign ${CAMPAIGN.id} declared`);
} else {
  console.log(`campaign ${CAMPAIGN.id} already declared`);
}

// ---- families and their members -------------------------------------------
const specs = db.select().from(schema.strategySpecs).all();
const placed = new Set<string>();

for (const family of DECLARED_FAMILIES) {
  const exists = db
    .select()
    .from(schema.strategyFamilies)
    .where(eq(schema.strategyFamilies.id, family.id))
    .get();

  if (!exists) {
    db.insert(schema.strategyFamilies)
      .values({
        id: family.id,
        researchCampaignId: CAMPAIGN.id,
        name: family.name,
        economicHypothesis: family.economicHypothesis,
        mechanism: family.mechanism,
        allowedVariantDimensions: family.allowedVariantDimensions,
        // Hashing the declaration so a family cannot be quietly redefined after trials are counted.
        declarationHash: semanticFingerprintOfDeclaration(family),
        createdAt: now,
        createdBy: "owner:backfill-2026-08-09",
      })
      .run();
    console.log(`family ${family.id} declared — "${family.name}"`);
  }

  for (const name of family.members) {
    const spec = specs.find((row) => row.name === name);
    if (!spec) {
      console.log(`  ${name}: not in the registry, skipped`);
      continue;
    }
    placed.add(spec.id);

    const already = db
      .select()
      .from(schema.strategyIdentity)
      .where(eq(schema.strategyIdentity.strategySpecId, spec.id))
      .get();
    if (already) {
      console.log(`  ${name}: already placed in ${already.strategyFamilyId}, left untouched`);
      continue;
    }

    const dsl = parse(spec.dsl);
    if (!dsl) {
      console.log(`  ${name}: DSL does not parse, cannot fingerprint — left unplaced`);
      continue;
    }

    db.insert(schema.strategyIdentity)
      .values({
        strategySpecId: spec.id,
        researchCampaignId: CAMPAIGN.id,
        strategyFamilyId: family.id,
        parentSpecId: null,
        semanticFingerprint: semanticFingerprint(dsl),
        validationEligible: 1,
        classifiedBy: "owner:backfill-2026-08-09",
        classifiedAt: now,
        classification: "SAME_FAMILY",
        classificationReason:
          "Structurally identical to its sibling under semanticFingerprint — same entry shape, " +
          "same exit kinds, differing only in thresholds. Confirmed by the owner.",
      })
      .run();
    console.log(`  ${name}: placed in ${family.id}, validation-eligible`);
  }
}

// ---- everything else: unclassified, ineligible, and recorded as such -------
let unclassified = 0;
for (const spec of specs) {
  if (placed.has(spec.id)) continue;

  const already = db
    .select()
    .from(schema.strategyIdentity)
    .where(eq(schema.strategyIdentity.strategySpecId, spec.id))
    .get();
  if (already) continue;

  unclassified += 1;
  db.insert(schema.auditEvents)
    .values({
      actor: "owner:backfill-2026-08-09",
      action: "classify_research_identity",
      decision: "refused",
      denialCode: "UNCLASSIFIED",
      subject: spec.id,
      detail:
        `${spec.name} was examined and deliberately left unplaced. Its structure is unique, which ` +
        "settles nothing — a distinct shape may still be adaptive refinement of an earlier idea. " +
        "Placing it requires a stated economic hypothesis. Until then it has no identity row, so " +
        "validationStanding() refuses it and no trial or holdout budget can be charged to it.",
      learningMode: null,
      createdAt: now,
    })
    .run();
  console.log(`  ${spec.name}: UNCLASSIFIED — recorded, validation-ineligible`);
}

console.log(`\n${placed.size} spec(s) placed, ${unclassified} left unclassified by instruction.`);
console.log("Unclassified specs may still be rehearsed — rehearsal spends nothing. They cannot be validated.");

/** Stable hash of the family declaration, so redefinition after the fact is detectable. */
function semanticFingerprintOfDeclaration(family: (typeof DECLARED_FAMILIES)[number]): string {
  return createHash("sha256")
    .update(
      [family.id, family.name, family.economicHypothesis, family.mechanism, family.allowedVariantDimensions].join(" "),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
}
