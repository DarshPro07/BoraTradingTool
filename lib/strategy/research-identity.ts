import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { stableStringify } from "@/lib/util/stable-json";
import type { Condition, StrategyDsl } from "./dsl";

/**
 * Who a strategy is, statistically.
 *
 * ## The invariant
 *
 *   Changing the name, id, version, parameters or representation of an idea must never erase the
 *   statistical history that informed its selection.
 *
 * Before this existed, identity was the `strategy_specs` primary key. Every spec had
 * `hypothesis_id = NULL`, so `countSelectionTrials` walked a family of one and deflated the Sharpe
 * ratio against a denominator of 1 — and the sealed-holdout budget was keyed per spec id, so a
 * rename bought a second look at data that may only be looked at once.
 *
 * ## Two things that must not be conflated
 *
 * A **family** is methodological lineage: one economic hypothesis and its variants. A **selection
 * trial** is one configuration that was actually tested and allowed to influence which candidate
 * was chosen. Ten opening-range variants are *one family* and *ten selection trials*.
 *
 * Keying the deflated-Sharpe denominator to the family label would understate N exactly as badly
 * as keying it to the spec id does today — the same bug wearing better clothes. So the two live in
 * separate tables and are counted by separate functions, and this module deals only with identity.
 *
 * ## Declared identity, derived check
 *
 * The family a strategy belongs to is **declared** by a human, because it is a claim about an
 * economic hypothesis and no amount of structural analysis can recover intent. The fingerprint
 * below is an independent consistency signal: it catches a variant declared as a new family
 * (evasion, deliberate or accidental) and a genuinely new idea filed under an old one. It is never
 * the identity itself — `EMA(9,21)` and `EMA(10,22)` fingerprint differently while plainly being
 * one family, and one fingerprint can appear in two unrelated hypotheses.
 */

/** The shape of a condition with every tunable threshold removed. */
function shapeOf(condition: Condition): unknown {
  if ("feature" in condition) return { cmp: condition.op, on: condition.feature };
  if ("compare" in condition) return { cmp: condition.op, between: [...condition.compare].sort() };
  if ("crossover" in condition) return { cross: "over", between: condition.crossover };
  if ("crossunder" in condition) return { cross: "under", between: condition.crossunder };
  if ("not" in condition) return { not: shapeOf(condition.not) };
  const kind = "all" in condition ? "all" : "any";
  const children = ("all" in condition ? condition.all : condition.any).map(shapeOf);
  // Sorted: reordering the same conjunction is not a different strategy, and a fingerprint that
  // said otherwise would let a trivial rewrite look like a new idea.
  children.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  return { [kind]: children };
}

/**
 * Structural identity, **ignoring every parameter value**.
 *
 * Stop 0.5% and stop 0.7% share a fingerprint, because they are variants of one idea. That is the
 * point: it makes "rename and re-tune" visible as the same thing it always was.
 */
export function semanticFingerprint(dsl: StrategyDsl): string {
  /**
   * Cross-sectional strategies have no `entry` condition to shape — their selection is a RANK over
   * the universe, not a predicate on one symbol. So their structural identity is the shape of the
   * ranking itself: what is scored, in which direction, and on what cadence — with the tunable
   * magnitudes (lookback length, how many names, how many days between rotations) removed, exactly
   * as parameter values are removed from a DSL's thresholds.
   *
   * Reached through the same function rather than a parallel one, so a cross-sectional variant
   * cannot dodge the duplicate check by travelling a path that never applies it.
   */
  const asRecord = dsl as unknown as Record<string, unknown>;
  if (asRecord.kind === "CROSS_SECTIONAL") {
    const ranking = {
      market: dsl.universe.market,
      resolution: dsl.universe.resolution,
      rank: {
        score: asRecord.ranking,
        direction: asRecord.direction,
        skipsRecent: Number(asRecord.skipRecentDays) > 0,
        rotates: true,
      },
    };
    return createHash("sha256").update(stableStringify(ranking), "utf8").digest("hex").slice(0, 16);
  }

  const payload = {
    market: dsl.universe.market,
    resolution: dsl.universe.resolution,
    entry: shapeOf(dsl.entry),
    exitKinds: [
      dsl.exit.stopLossPct !== undefined ? "stop" : null,
      dsl.exit.takeProfitPct !== undefined ? "target" : null,
      dsl.exit.afterDays !== undefined ? "time" : null,
      dsl.exit.squareOffAt !== undefined ? "squareoff" : null,
      dsl.exit.condition ? "condition" : null,
    ].filter(Boolean),
  };
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex").slice(0, 16);
}

/**
 * Identity of one *tested configuration*, **including** parameter values.
 *
 * This is what a selection trial is counted against. Two runs of the same configuration are one
 * trial — re-running a backtest does not constitute a second search. Two different stop values are
 * two trials, because both results were available when the winner was chosen.
 *
 * Excludes the strategy's name, so renaming cannot mint a fresh trial slot.
 */
export function configurationFingerprint(dsl: StrategyDsl): string {
  const { name: _ignored, description: _alsoIgnored, ...rest } = dsl;
  return createHash("sha256").update(stableStringify(rest), "utf8").digest("hex").slice(0, 16);
}

/**
 * Are the research-identity tables installed?
 *
 * `drizzle/0008_research_identity.sql` cannot register itself — the `MIGRATIONS` array lives in
 * the protected `lib/db/migrate.ts`. Until an owner adds the line the tables are absent, and this
 * returns false.
 *
 * Absence is treated as "no strategy has an identity", which blocks validation. That is the
 * correct interim state rather than a degradation: a system that cannot tell which strategies are
 * statistically related must not be computing multiple-testing corrections.
 */
export function researchIdentityReady(): boolean {
  try {
    getDb().select().from(schema.strategyIdentity).limit(1).all();
    return true;
  } catch {
    return false;
  }
}

export interface StrategyIdentity {
  specId: string;
  campaignId: string;
  familyId: string;
  semanticFingerprint: string;
  validationEligible: boolean;
  classification: string;
}

export function identityFor(specId: string): StrategyIdentity | null {
  if (!researchIdentityReady()) return null;

  const row = getDb()
    .select()
    .from(schema.strategyIdentity)
    .where(eq(schema.strategyIdentity.strategySpecId, specId))
    .get();
  if (!row) return null;

  return {
    specId: row.strategySpecId,
    campaignId: row.researchCampaignId,
    familyId: row.strategyFamilyId,
    semanticFingerprint: row.semanticFingerprint,
    // Compared explicitly rather than coerced: a future 2 must read as false, not as truthy.
    validationEligible: row.validationEligible === 1,
    classification: row.classification,
  };
}

export interface ValidationStanding {
  eligible: boolean;
  identity: StrategyIdentity | null;
  reason: string;
}

/**
 * May this strategy have statistical budget spent on it?
 *
 * **Fails closed at every branch.** Missing schema, missing identity and unconfirmed classification
 * are all refusals, and none of them falls back to a default. Defaulting a missing identity to a
 * family of one is the exact defect being repaired here, and a repair that reintroduces its own
 * bug under a new name is worse than no repair.
 */
export function validationStanding(specId: string): ValidationStanding {
  if (!researchIdentityReady()) {
    return {
      eligible: false,
      identity: null,
      reason:
        "The research-identity tables are not installed, so no strategy can be shown to belong to a " +
        "family. Register drizzle/0008_research_identity.sql in lib/db/migrate.ts (an owner edit) " +
        "before any trial is spent. Refused rather than defaulted: without identity the " +
        "multiple-testing denominator would silently be 1.",
    };
  }

  const identity = identityFor(specId);
  if (identity === null) {
    return {
      eligible: false,
      identity: null,
      reason:
        `${specId} has no research identity. A spec without a declared campaign and family may be ` +
        "rehearsed freely — rehearsal spends nothing — but it may not be validated, because there " +
        "is no way to know which other strategies its result should be corrected against.",
    };
  }

  if (!identity.validationEligible) {
    return {
      eligible: false,
      identity,
      reason:
        `${specId} is placed in family ${identity.familyId} as ${identity.classification}, but that ` +
        "placement has not been confirmed. Classification is proposed by analysis and confirmed by " +
        "a human; an unconfirmed placement is not evidence of lineage.",
    };
  }

  return {
    eligible: true,
    identity,
    reason: `Belongs to family ${identity.familyId} in campaign ${identity.campaignId}, confirmed.`,
  };
}

/**
 * Specs whose declared family disagrees with their structure.
 *
 * Two directions, both worth knowing about:
 *   - one fingerprint spread across several declared families — a variant filed as a new idea,
 *     which is how a fresh holdout budget gets minted;
 *   - one declared family holding several fingerprints — usually fine, since variants legitimately
 *     differ, but worth seeing when a family has quietly become a dumping ground.
 */
export function classificationConflicts(): { fingerprint: string; families: string[] }[] {
  if (!researchIdentityReady()) return [];

  const rows = getDb().select().from(schema.strategyIdentity).all();
  const familiesByFingerprint = new Map<string, Set<string>>();
  for (const row of rows) {
    const held = familiesByFingerprint.get(row.semanticFingerprint) ?? new Set<string>();
    held.add(row.strategyFamilyId);
    familiesByFingerprint.set(row.semanticFingerprint, held);
  }

  return [...familiesByFingerprint.entries()]
    .filter(([, families]) => families.size > 1)
    .map(([fingerprint, families]) => ({ fingerprint, families: [...families].sort() }));
}

export interface PlacementInput {
  specId: string;
  campaignId: string;
  familyId: string;
  dsl: StrategyDsl;
  classification: "SAME_FAMILY" | "NEW_FAMILY" | "UNKNOWN";
  classifiedBy: string;
  reason?: string;
  parentSpecId?: string;
  /** Only a confirmed placement is validation-eligible. Proposals are recorded, not trusted. */
  confirmed?: boolean;
  at?: Date;
}

/**
 * Place a strategy in a family.
 *
 * Used by the backfill, by tests, and by the factory when it breeds a variant — a bred candidate
 * inherits its parent's family by construction, which is the case the whole design exists for: a
 * search that spawns siblings must not give each of them a denominator of one.
 *
 * Refuses to move an already-placed spec. A placement that has had trials counted against it
 * cannot be reassigned without rewriting history that other strategies' bars were computed from.
 */
export function placeStrategy(input: PlacementInput): { placed: boolean; reason: string } {
  if (!researchIdentityReady()) {
    return { placed: false, reason: "Research-identity tables are not installed." };
  }

  const existing = identityFor(input.specId);
  if (existing !== null) {
    return {
      placed: false,
      reason:
        `${input.specId} is already in family ${existing.familyId}. A placement is not moved once ` +
        "made: trials counted against the old family were part of other strategies' denominators.",
    };
  }

  getDb()
    .insert(schema.strategyIdentity)
    .values({
      strategySpecId: input.specId,
      researchCampaignId: input.campaignId,
      strategyFamilyId: input.familyId,
      parentSpecId: input.parentSpecId ?? null,
      semanticFingerprint: semanticFingerprint(input.dsl),
      validationEligible: input.confirmed === true ? 1 : 0,
      classifiedBy: input.classifiedBy,
      classifiedAt: input.at ?? new Date(),
      classification: input.classification,
      classificationReason: input.reason ?? null,
    })
    .run();

  return { placed: true, reason: `Placed in ${input.familyId} as ${input.classification}.` };
}

/** Every spec in a family, for counting and for reporting. */
export function specsInFamily(campaignId: string, familyId: string): string[] {
  if (!researchIdentityReady()) return [];
  return getDb()
    .select()
    .from(schema.strategyIdentity)
    .where(
      and(
        eq(schema.strategyIdentity.researchCampaignId, campaignId),
        eq(schema.strategyIdentity.strategyFamilyId, familyId),
      ),
    )
    .all()
    .map((row) => row.strategySpecId);
}
