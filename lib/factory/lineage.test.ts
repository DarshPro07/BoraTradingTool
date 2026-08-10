import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { placeInTestFamily, FIXTURE_FAMILY } from "@/lib/strategy/identity-fixture";
import { identityFor, validationStanding } from "@/lib/strategy/research-identity";
import { breedGeneration } from "./breed";

/**
 * A bred strategy inherits its parent's research family.
 *
 * ## The defect this guards
 *
 * `runFactoryGeneration` wrote `hypothesisId: null, parentId: null` for every survivor, discarding
 * lineage the breeder had already computed. Two consequences, and the second is worse:
 *
 *   1. every bred candidate was an orphan, so once research identity became mandatory it could
 *      never be validated — the factory would have bred strategies that were unusable by
 *      construction;
 *   2. a search spawning two hundred siblings gave each of them a multiple-testing denominator of
 *      one, which is the precise mechanism by which a random search reports a discovery.
 *
 * A mutation or crossover of an existing strategy is a *variant of that idea*. It belongs to the
 * parent's family and it costs that family one more selection trial.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-lineage-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "lineage.db");
  closeDbForTests();
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

function parentDsl(name = "parent_strategy"): StrategyDsl {
  return StrategyDslSchema.parse({
    name,
    universe: { market: "NSE", maxPositions: 4, resolution: "D" },
    entry: { all: [{ feature: "rsi14", op: "lt", value: 30 }] },
    exit: { afterDays: 5, stopLossPct: 2 },
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 5, slippageBps: 7 },
  });
}

describe("the breeder carries parentage", () => {
  it("records which spec a mutated or crossed candidate descends from", () => {
    const dsl = parentDsl();
    const report = breedGeneration({
      parents: [{ name: dsl.name, dsl, specId: "spec_parent_1" }],
      buriedIdentities: new Set(),
      livingIdentities: new Set(),
      size: 12,
      generation: 1,
      seed: 7,
    });

    expect(report.candidates.length).toBeGreaterThan(0);

    const derived = report.candidates.filter((candidate) => candidate.lineage !== "gen");
    expect(derived.length).toBeGreaterThan(0);
    for (const candidate of derived) {
      expect(candidate.parentSpecId).toBe("spec_parent_1");
    }
  });

  it("leaves a freshly generated candidate with no parent", () => {
    // `gen` descends from nothing. Claiming a parent it does not have would attach it to a family
    // whose statistical history has nothing to do with it.
    const report = breedGeneration({
      parents: [],
      buriedIdentities: new Set(),
      livingIdentities: new Set(),
      size: 6,
      generation: 1,
      seed: 3,
    });

    for (const candidate of report.candidates) {
      expect(candidate.lineage).toBe("gen");
      expect(candidate.parentSpecId).toBeUndefined();
    }
  });
});

describe("a descendant inherits the family, and with it the bar", () => {
  it("is placed in its parent's family and becomes validation-eligible", () => {
    const dsl = parentDsl();
    const parentId = recordStrategySpec({ name: dsl.name, dsl, createdBy: "test" });
    placeInTestFamily(parentId, dsl);

    // What `runFactoryGeneration` does for each survivor, exercised directly: the placement is a
    // mechanical consequence of parentage, so it is confirmed without a human.
    const childDsl = parentDsl("child_strategy");
    const childId = recordStrategySpec({ name: childDsl.name, dsl: childDsl, createdBy: "test" });
    const parentIdentity = identityFor(parentId);
    expect(parentIdentity).not.toBeNull();

    getDb()
      .insert(schema.strategyIdentity)
      .values({
        strategySpecId: childId,
        researchCampaignId: parentIdentity!.campaignId,
        strategyFamilyId: parentIdentity!.familyId,
        parentSpecId: parentId,
        semanticFingerprint: "fp_child",
        validationEligible: 1,
        classifiedBy: "factory:test",
        classifiedAt: new Date(),
        classification: "SAME_FAMILY",
      })
      .run();

    expect(identityFor(childId)?.familyId).toBe(FIXTURE_FAMILY);
    expect(validationStanding(childId).eligible).toBe(true);
  });

  it("an orphan candidate cannot be validated, rather than being given a family of its own", () => {
    // The fail-closed half. A generated candidate with no placeable parent is rehearsable — that
    // costs nothing — but it may not be validated until a human states its hypothesis. Inventing a
    // family for a machine-generated rule is exactly how a denominator of one is manufactured.
    const dsl = parentDsl("orphan_candidate");
    const orphanId = recordStrategySpec({ name: dsl.name, dsl, createdBy: "factory:test" });

    expect(identityFor(orphanId)).toBeNull();
    const standing = validationStanding(orphanId);
    expect(standing.eligible).toBe(false);
    expect(standing.reason).toMatch(/no research identity/i);
  });
});
