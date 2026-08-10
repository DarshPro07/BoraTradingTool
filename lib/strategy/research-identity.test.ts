import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Schema-install-per-test suite: under full-suite parallel load the 5s default timed out once
// (7.8s) and read as a flake. The ceiling now matches the cycle suites; isolation is per-test
// temp databases, so the budget is CPU, not correctness.
vi.setConfig({ testTimeout: 30_000 });
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema, type StrategyDsl } from "./dsl";
import {
  configurationFingerprint,
  identityFor,
  researchIdentityReady,
  semanticFingerprint,
  validationStanding,
  classificationConflicts,
} from "./research-identity";
import { recordSelectionTrial, requestHoldoutAccess, selectionTrialCount } from "./selection-ledger";

/**
 * The adversarial suite for research identity.
 *
 * Each test here is an attack. The invariant under attack is always the same one:
 *
 *   Changing the name, id, version, parameters or representation of an idea must never erase the
 *   statistical history that informed its selection.
 *
 * ## Why this file still applies its own migration
 *
 * `0008_research_identity.sql` is registered in `MIGRATIONS` as of 2026-08-09, so `migrateDatabase()`
 * already creates these tables in every temporary database these tests open. `installIdentitySchema()`
 * is therefore usually a harmless re-application — every statement is `IF NOT EXISTS`.
 *
 * It is kept deliberately. It pins the tests to the *schema* rather than to the migration runner,
 * so this suite keeps its meaning if the registration is ever reverted, and a failure here points
 * at the logic instead of at the plumbing.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;
let databaseFile: string;

/**
 * Registered in `MIGRATIONS` on 2026-08-09, so `migrateDatabase()` now applies it to every
 * database it opens — including the temporary ones these tests create.
 *
 * `installIdentitySchema()` below is therefore usually a no-op re-application. It is kept because
 * every statement in the migration is `IF NOT EXISTS`, and because it keeps this suite meaningful
 * if the file is ever unregistered again: the logic under test is proven against the schema, not
 * against the migration runner.
 */
const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), "drizzle", "0008_research_identity.sql"),
  "utf8",
);

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-identity-"));
  temporaryDirectories.push(directory);
  databaseFile = path.join(directory, "identity.db");
  process.env.MARKETPULSE_DB_PATH = databaseFile;
  closeDbForTests();
  // Force the baseline migrations to run before layering 0008 on top.
  getDb();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Apply 0008 to the current test database, standing in for the owner's migrate.ts line. */
function installIdentitySchema(): void {
  closeDbForTests();
  const sqlite = new Database(databaseFile);
  sqlite.exec(MIGRATION);
  sqlite.close();
  getDb();
}

function dsl(overrides: Record<string, unknown> = {}): StrategyDsl {
  return StrategyDslSchema.parse({
    name: "orb_variant",
    universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
    entry: { compare: ["close", "opening_range_high"], op: "gt" },
    exit: { stopLossPct: 0.5, takeProfitPct: 1 },
    sizing: { maxPositionPct: 25 },
    costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
    ...overrides,
  });
}

const CAMPAIGN = "camp_intraday_momentum";
const FAMILY = "fam_opening_range";

function declareCampaignAndFamily(): void {
  const now = new Date();
  getDb()
    .insert(schema.researchCampaigns)
    .values({
      id: CAMPAIGN,
      name: "Intraday momentum, NSE",
      question: "Do intraday continuation patterns clear costs at the owner's capital?",
      createdAt: now,
      createdBy: "test",
    })
    .run();
  getDb()
    .insert(schema.strategyFamilies)
    .values({
      id: FAMILY,
      researchCampaignId: CAMPAIGN,
      name: "Opening range continuation",
      economicHypothesis: "Early price discovery creates short-lived continuation.",
      mechanism: "Break of the session's opening range, held intraday.",
      allowedVariantDimensions: JSON.stringify({ range_window: "10m-30m", stop: "0.25-1.0%" }),
      declarationHash: "decl_test",
      createdAt: now,
      createdBy: "test",
    })
    .run();
}

/** Seed a spec and place it in the family, confirmed. */
function seedPlaced(name: string, spec: StrategyDsl, familyId = FAMILY): string {
  const id = recordStrategySpec({ name, dsl: spec, createdBy: "test" });
  getDb()
    .insert(schema.strategyIdentity)
    .values({
      strategySpecId: id,
      researchCampaignId: CAMPAIGN,
      strategyFamilyId: familyId,
      parentSpecId: null,
      semanticFingerprint: semanticFingerprint(spec),
      validationEligible: 1,
      classifiedBy: "test",
      classifiedAt: new Date(),
      classification: "SAME_FAMILY",
    })
    .run();
  return id;
}

describe("fingerprints separate an idea from its parameters", () => {
  it("gives one fingerprint to variants that differ only in thresholds", () => {
    // T-variant: stop 0.5% and stop 0.7% are the same idea. A fingerprint that disagreed would let
    // re-tuning look like a new hypothesis, and mint a fresh holdout budget.
    const a = semanticFingerprint(dsl({ exit: { stopLossPct: 0.5, takeProfitPct: 1 } }));
    const b = semanticFingerprint(dsl({ exit: { stopLossPct: 0.7, takeProfitPct: 1 } }));
    expect(a).toBe(b);
  });

  it("ignores the strategy name, so renaming changes nothing", () => {
    expect(semanticFingerprint(dsl({ name: "orb_v1" }))).toBe(semanticFingerprint(dsl({ name: "totally_new" })));
    expect(configurationFingerprint(dsl({ name: "orb_v1" }))).toBe(
      configurationFingerprint(dsl({ name: "totally_new" })),
    );
  });

  it("gives different configuration fingerprints to different thresholds", () => {
    // The counterpart: those two variants are one family but TWO selection trials, because both
    // results were on the table when a winner was chosen.
    const a = configurationFingerprint(dsl({ exit: { stopLossPct: 0.5, takeProfitPct: 1 } }));
    const b = configurationFingerprint(dsl({ exit: { stopLossPct: 0.7, takeProfitPct: 1 } }));
    expect(a).not.toBe(b);
  });

  it("is stable under reordering of an unordered conjunction", () => {
    const forward = dsl({
      entry: { all: [{ feature: "rvol", op: "gt", value: 1.2 }, { feature: "close", op: "gt", value: 1 }] },
    });
    const reversed = dsl({
      entry: { all: [{ feature: "close", op: "gt", value: 1 }, { feature: "rvol", op: "gt", value: 1.2 }] },
    });
    expect(semanticFingerprint(forward)).toBe(semanticFingerprint(reversed));
  });
});

describe("T1/T2 — the denominator counts configurations, not specs or stages", () => {
  it("counts every distinct configuration tried in the family", () => {
    installIdentitySchema();
    declareCampaignAndFamily();

    const stops = [0.4, 0.5, 0.6, 0.7, 0.8];
    let last = "";
    for (const stopLossPct of stops) {
      const spec = dsl({ exit: { stopLossPct, takeProfitPct: 1 } });
      last = seedPlaced(`orb_stop_${stopLossPct}`, spec);
      recordSelectionTrial({ specId: last, dsl: spec });
    }

    const count = selectionTrialCount(last);
    expect(count.known).toBe(true);
    if (!count.known) return;
    // Five attempted configurations, not one — and not five because there are five specs, but
    // because there are five fingerprints.
    expect(count.trials).toBe(5);
  });

  it("does not inflate when the same configuration is re-run", () => {
    installIdentitySchema();
    declareCampaignAndFamily();

    const spec = dsl();
    const specId = seedPlaced("orb_once", spec);
    const first = recordSelectionTrial({ specId, dsl: spec });
    const second = recordSelectionTrial({ specId, dsl: spec });

    expect(first.recorded && !first.alreadyCounted).toBe(true);
    expect(second.recorded && second.alreadyCounted).toBe(true);

    const count = selectionTrialCount(specId);
    expect(count.known && count.trials).toBe(1);
  });

  it("counts a sibling's trial against this strategy too", () => {
    // The hole the old per-spec key left open: two hundred siblings, each with a denominator of 1.
    installIdentitySchema();
    declareCampaignAndFamily();

    const specA = seedPlaced("orb_a", dsl({ exit: { stopLossPct: 0.4 } }));
    recordSelectionTrial({ specId: specA, dsl: dsl({ exit: { stopLossPct: 0.4 } }) });

    const specB = seedPlaced("orb_b", dsl({ exit: { stopLossPct: 0.9 } }));
    recordSelectionTrial({ specId: specB, dsl: dsl({ exit: { stopLossPct: 0.9 } }) });

    expect(selectionTrialCount(specA).known && selectionTrialCount(specA).valueOf()).toBeTruthy();
    const forA = selectionTrialCount(specA);
    const forB = selectionTrialCount(specB);
    expect(forA.known && forA.trials).toBe(2);
    expect(forB.known && forB.trials).toBe(2);
  });
});

describe("T3/T4/T5/T6 — no reshaping of an idea restores its holdout budget", () => {
  const GENERATION = "holdout_2026_h1";

  function firstLook(): string {
    const spec = dsl();
    const specId = seedPlaced("orb_v1", spec);
    const grant = requestHoldoutAccess({
      holdoutGenerationId: GENERATION,
      specId,
      requestFingerprint: configurationFingerprint(spec),
    });
    expect(grant.granted).toBe(true);
    return specId;
  }

  it("T3 — renaming does not reset it", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    firstLook();

    const renamed = seedPlaced("a_completely_different_name", dsl());
    const second = requestHoldoutAccess({
      holdoutGenerationId: GENERATION,
      specId: renamed,
      requestFingerprint: "whatever",
    });
    expect(second.granted).toBe(false);
    if (second.granted) return;
    expect(second.code).toBe("FAMILY_BUDGET_SPENT");
  });

  it("T4 — copying does not reset it", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    firstLook();

    const copy = seedPlaced("orb_v1_copy", dsl());
    const second = requestHoldoutAccess({
      holdoutGenerationId: GENERATION,
      specId: copy,
      requestFingerprint: "copy",
    });
    expect(second.granted).toBe(false);
  });

  it("T5 — a new version does not reset it", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    firstLook();

    const v2 = seedPlaced("orb_v2", dsl({ exit: { stopLossPct: 0.9, takeProfitPct: 2 } }));
    const second = requestHoldoutAccess({
      holdoutGenerationId: GENERATION,
      specId: v2,
      requestFingerprint: "v2",
    });
    expect(second.granted).toBe(false);
  });

  it("T6 — a brand-new spec id with the same idea does not reset it", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    firstLook();

    const fresh = seedPlaced("orb_reincarnated", dsl());
    expect(requestHoldoutAccess({
      holdoutGenerationId: GENERATION,
      specId: fresh,
      requestFingerprint: "fresh",
    }).granted).toBe(false);
  });

  it("T8 — a new family in the same campaign does not get a clean slate", () => {
    // The subtler attack: family A looks, learns, and the researcher invents family B informed by
    // what they saw. Every family obeys its one-look rule while the campaign overfits the holdout.
    installIdentitySchema();
    declareCampaignAndFamily();
    firstLook();

    getDb()
      .insert(schema.strategyFamilies)
      .values({
        id: "fam_invented_later",
        researchCampaignId: CAMPAIGN,
        name: "Invented after seeing the result",
        economicHypothesis: "Something I thought of afterwards.",
        mechanism: "Suspiciously similar.",
        allowedVariantDimensions: null,
        declarationHash: "decl_late",
        createdAt: new Date(),
        createdBy: "test",
      })
      .run();

    const inNewFamily = seedPlaced("orb_but_different", dsl({ exit: { afterDays: 3, stopLossPct: 1 } }), "fam_invented_later");
    const second = requestHoldoutAccess({
      holdoutGenerationId: GENERATION,
      specId: inNewFamily,
      requestFingerprint: "new-family",
    });

    expect(second.granted).toBe(false);
    if (second.granted) return;
    expect(second.code).toBe("CAMPAIGN_BUDGET_SPENT");
  });

  it("a genuinely new holdout generation is a fresh sample", () => {
    // The control: the gates must not be so blunt that future data is unusable. Data that could
    // not have influenced prior research is a legitimate new sample.
    installIdentitySchema();
    declareCampaignAndFamily();
    const specId = firstLook();

    const later = requestHoldoutAccess({
      holdoutGenerationId: "holdout_2026_h2",
      specId,
      requestFingerprint: "later",
    });
    expect(later.granted).toBe(true);
  });
});

describe("T7/T11 — missing identity fails closed, evidence is permanent", () => {
  it("T7 — a spec with no family cannot be validated", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    const orphan = recordStrategySpec({ name: "orphan", dsl: dsl(), createdBy: "test" });

    const standing = validationStanding(orphan);
    expect(standing.eligible).toBe(false);
    expect(standing.reason).toMatch(/no research identity/i);

    // And critically, the count refuses rather than answering 1.
    const count = selectionTrialCount(orphan);
    expect(count.known).toBe(false);
    if (count.known) return;
    expect(count.reason).toMatch(/only thing ever tried/i);
  });

  it("T7 — an unconfirmed classification is not eligible either", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    const spec = dsl();
    const id = recordStrategySpec({ name: "proposed_only", dsl: spec, createdBy: "test" });
    getDb()
      .insert(schema.strategyIdentity)
      .values({
        strategySpecId: id,
        researchCampaignId: CAMPAIGN,
        strategyFamilyId: FAMILY,
        parentSpecId: null,
        semanticFingerprint: semanticFingerprint(spec),
        validationEligible: 0,
        classifiedBy: "analysis",
        classifiedAt: new Date(),
        classification: "UNKNOWN",
      })
      .run();

    expect(validationStanding(id).eligible).toBe(false);
    expect(validationStanding(id).reason).toMatch(/not been confirmed/i);
  });

  it("T11 — selection trials and holdout access cannot be deleted", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    const spec = dsl();
    const specId = seedPlaced("orb_permanent", spec);
    recordSelectionTrial({ specId, dsl: spec });
    requestHoldoutAccess({
      holdoutGenerationId: "holdout_2026_h1",
      specId,
      requestFingerprint: "x",
    });

    expect(() => getDb().delete(schema.selectionTrials).run()).toThrow(/append-only/i);
    expect(() => getDb().delete(schema.holdoutAccess).run()).toThrow(/append-only/i);
  });
});

describe("the derived check catches a variant filed as a new family", () => {
  it("flags one fingerprint spread across two declared families", () => {
    installIdentitySchema();
    declareCampaignAndFamily();
    getDb()
      .insert(schema.strategyFamilies)
      .values({
        id: "fam_second",
        researchCampaignId: CAMPAIGN,
        name: "Second",
        economicHypothesis: "Declared separately.",
        mechanism: "Identical in structure.",
        allowedVariantDimensions: null,
        declarationHash: "decl_second",
        createdAt: new Date(),
        createdBy: "test",
      })
      .run();

    seedPlaced("orb_here", dsl({ exit: { stopLossPct: 0.5, takeProfitPct: 1 } }), FAMILY);
    seedPlaced("orb_there", dsl({ exit: { stopLossPct: 0.6, takeProfitPct: 1 } }), "fam_second");

    const conflicts = classificationConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].families).toEqual(["fam_opening_range", "fam_second"].sort());
  });
});

describe("the state production is actually in", () => {
  it("has the schema installed, and an unplaced spec still fails closed everywhere", () => {
    // This test previously asserted `researchIdentityReady() === false` — true while
    // 0008_research_identity.sql sat in `drizzle/pending/` unregistered. It is registered now, so
    // the premise is gone and the assertion is inverted rather than deleted: the interesting
    // property was never "the schema is missing", it was "absence of identity refuses everywhere".
    expect(researchIdentityReady()).toBe(true);

    const orphan = recordStrategySpec({ name: "todays_reality", dsl: dsl(), createdBy: "test" });
    const standing = validationStanding(orphan);

    expect(standing.eligible).toBe(false);
    expect(standing.reason).toMatch(/no research identity/i);
    expect(identityFor(orphan)).toBeNull();

    // The important one: no number is produced. `?? 1` at a call site is the defect being repaired.
    const count = selectionTrialCount(orphan);
    expect(count.known).toBe(false);

    const access = requestHoldoutAccess({ holdoutGenerationId: "g", specId: orphan, requestFingerprint: "f" });
    expect(access.granted).toBe(false);
    if (access.granted) return;
    expect(access.code).toBe("NO_IDENTITY");
  });
});
