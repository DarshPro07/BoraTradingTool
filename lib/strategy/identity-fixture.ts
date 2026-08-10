import { getDb, schema } from "@/lib/db";
import type { StrategyDsl } from "./dsl";
import { placeStrategy } from "./research-identity";

/**
 * Test scaffolding: declare a campaign and family, and place a spec in it.
 *
 * Lives beside the code it supports rather than in a test file, because three suites need it and a
 * third copy would eventually drift from the other two.
 *
 * ## Why the tests were changed rather than the guard relaxed
 *
 * `runGauntlet` now throws `ResearchIdentityMissing` for a spec with no declared family. That broke
 * twenty-one existing tests, every one of which validated a strategy that belonged to nothing.
 *
 * The tempting fix — make the guard tolerant when no identity exists — is the defect it was written
 * to remove. So the tests were updated to declare identity instead, which is what any real caller
 * must now do. A test that cannot express the new precondition is a test describing the old
 * contract.
 */

export const FIXTURE_CAMPAIGN = "camp_test";
export const FIXTURE_FAMILY = "fam_test";

/**
 * Idempotent. Suites call it per test against a fresh temporary database, and some call it more
 * than once per test; re-declaring must not throw.
 */
export function declareTestFamily(campaignId = FIXTURE_CAMPAIGN, familyId = FIXTURE_FAMILY): void {
  const db = getDb();
  const now = new Date();

  const campaign = db.select().from(schema.researchCampaigns).all().find((row) => row.id === campaignId);
  if (!campaign) {
    db.insert(schema.researchCampaigns)
      .values({
        id: campaignId,
        name: `Test campaign ${campaignId}`,
        question: "Fixture campaign for suites that need a statistically identified strategy.",
        createdAt: now,
        createdBy: "test",
      })
      .run();
  }

  const family = db.select().from(schema.strategyFamilies).all().find((row) => row.id === familyId);
  if (!family) {
    db.insert(schema.strategyFamilies)
      .values({
        id: familyId,
        researchCampaignId: campaignId,
        name: `Test family ${familyId}`,
        economicHypothesis: "Fixture hypothesis.",
        mechanism: "Fixture mechanism.",
        allowedVariantDimensions: null,
        declarationHash: `decl_${familyId}`,
        createdAt: now,
        createdBy: "test",
      })
      .run();
  }
}

/** Declare the family if needed, then place `specId` in it as validation-eligible. */
export function placeInTestFamily(
  specId: string,
  dsl: StrategyDsl,
  familyId = FIXTURE_FAMILY,
  campaignId = FIXTURE_CAMPAIGN,
): void {
  declareTestFamily(campaignId, familyId);
  placeStrategy({
    specId,
    campaignId,
    familyId,
    dsl,
    classification: "SAME_FAMILY",
    classifiedBy: "test",
    confirmed: true,
  });
}

/**
 * Register a synthetic dataset snapshot so gauntlet evidence in tests can name one.
 *
 * The experiments ledger enforces a real foreign key to dataset_snapshots — an experiment may not
 * reference a dataset that was never recorded, in tests or anywhere else. Idempotent.
 */
export function registerTestSnapshot(id = "dss_test", fingerprint = "fp_test"): void {
  getDb()
    .insert(schema.datasetSnapshots)
    .values({
      id,
      market: "NSE",
      resolution: "D",
      instruments: "[]",
      firstTime: 0,
      lastTime: 0,
      barCount: 0,
      fingerprint,
      sourceLineage: "test fixture",
      normalizationVersion: "test",
      createdAt: new Date(),
      createdBy: "test",
    })
    .onConflictDoNothing()
    .run();
}
