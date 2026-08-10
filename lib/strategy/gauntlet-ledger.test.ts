import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { recordHypothesis, recordStrategySpec } from "@/lib/knowledge/repository";
import { FIXTURE_FAMILY, placeInTestFamily, registerTestSnapshot } from "./identity-fixture";
import type { StrategyDsl } from "./dsl";
import { DatasetIdentityMissing, HoldoutBudgetExhausted, holdoutUsage, runGauntlet } from "./gauntlet";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-ledger-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "ledger.db");
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const DSL = {
  name: "gap_quality",
  universe: { market: "NSE" as const, maxPositions: 10 },
  entry: { all: [{ feature: "gap_pct", op: "gt" as const, value: 2 }] },
  exit: { afterDays: 5, stopLossPct: 3 },
  sizing: { maxPositionPct: 10 },
  costs: { commissionBps: 3, slippageBps: 7 },
} as StrategyDsl;

const returns = () => Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? -0.01 : 0.014));

function evaluate(specId: string, holdoutId?: string) {
  return runGauntlet(specId, DSL, {
    inSampleReturns: returns(),
    outOfSampleReturns: returns(),
    datasetSnapshotId: "dss_ledger_test",
    datasetFingerprint: "fp_ledger_test",
    ...(holdoutId ? { holdoutId } : {}),
  });
}

/**
 * Seed a spec AND place it in a declared family.
 *
 * Placement is now a precondition of validation: `runGauntlet` throws `ResearchIdentityMissing`
 * without it. The family argument is what these tests are actually about — the denominator is
 * scoped to the family, so which family a spec is in *is* the behaviour under test.
 */
function seed(name: string, familyId = FIXTURE_FAMILY, extra: Record<string, unknown> = {}): string {
  const id = recordStrategySpec({ name, version: 1, dsl: DSL, createdBy: "test", ...extra });
  placeInTestFamily(id, DSL, familyId);
  // Evidence names this snapshot; the experiments ledger holds a real FK to it.
  registerTestSnapshot("dss_ledger_test", "fp_ledger_test");
  return id;
}

describe("multiple-testing denominator", () => {
  it("counts evaluations, not the gate rows each evaluation writes", () => {
    const specId = seed("solo");

    expect(evaluate(specId).trialsCounted).toBe(1);

    // One evaluation writes one row per gate. Reading those rows back as the denominator
    // made the statistical bar scale with how many gates happen to run.
    const rowsAfterFirst = getDb().select().from(schema.trials).all().length;
    expect(rowsAfterFirst).toBeGreaterThan(1);

    expect(evaluate(specId).trialsCounted).toBe(2);
    expect(getDb().select().from(schema.trials).all().length).toBe(rowsAfterFirst * 2);
  });

  it("deflates against sibling specs in the same declared family", () => {
    // A search that spawns many variants and reports the best previously showed a denominator of 1
    // for each, because each spec had been evaluated exactly once.
    //
    // This test used to key the family on `hypothesisId`. Every spec in the real registry had that
    // column null, so the mechanism was correct and inert — the bug this whole layer exists to fix.
    // The family is now declared explicitly and cannot be null.
    const first = seed("variant_a");
    const second = seed("variant_b");

    expect(evaluate(first).trialsCounted).toBe(1);
    expect(evaluate(second).trialsCounted).toBe(2);
  });

  it("does not let an unrelated strategy raise another's bar", () => {
    // Different families: one strategy's search must not penalise an unrelated one.
    const a = seed("unrelated_a", "fam_alpha");
    const b = seed("unrelated_b", "fam_beta");

    evaluate(a);
    expect(evaluate(b).trialsCounted).toBe(1);
  });

  it("writes the attempt to the selection ledger before computing anything from it", () => {
    // The ledger is the mechanism; the historical validation-row count is only a floor for
    // families that predate it. Asserted directly so a regression cannot leave the ledger empty
    // while the denominator still looks right for the wrong reason.
    const specId = seed("ledger_written");
    expect(getDb().select().from(schema.selectionTrials).all()).toHaveLength(0);

    evaluate(specId);

    const trials = getDb().select().from(schema.selectionTrials).all();
    expect(trials).toHaveLength(1);
    expect(trials[0].strategyFamilyId).toBe(FIXTURE_FAMILY);
    expect(trials[0].strategySpecId).toBe(specId);
  });

  it("does not inflate the bar when the identical configuration is re-run", () => {
    // Re-running a backtest is not a second search. A configuration fingerprint that counted it
    // twice would punish reproducibility.
    const specId = seed("rerun_same_config");
    evaluate(specId);
    evaluate(specId);
    expect(getDb().select().from(schema.selectionTrials).all()).toHaveLength(1);
  });

  it("stores the denominator it actually deflated by", () => {
    const specId = seed("stored");
    const report = evaluate(specId);
    const [row] = getDb().select().from(schema.validationResults).all();
    expect(row.trialsCounted).toBe(report.trialsCounted);
  });
});

describe("locked holdout", () => {
  it("consumes the budget when holdout evidence is supplied", () => {
    const specId = seed("holdout_spec");
    evaluate(specId, "holdout_2026");
    expect(holdoutUsage(specId)).toHaveLength(1);
  });

  it("refuses a second query rather than producing a number to discard", () => {
    const specId = seed("holdout_twice");
    evaluate(specId, "holdout_2026");
    expect(() => evaluate(specId, "holdout_2026")).toThrow(HoldoutBudgetExhausted);
  });

  it("refuses before writing a second validation result", () => {
    const specId = seed("holdout_atomic");
    evaluate(specId, "holdout_2026");
    expect(() => evaluate(specId, "holdout_2026")).toThrow();
    // The refused attempt left no trace beyond the original evaluation.
    expect(getDb().select().from(schema.validationResults).all()).toHaveLength(1);
  });

  it("leaves the budget untouched when no holdout is claimed", () => {
    const specId = seed("no_holdout");
    evaluate(specId);
    evaluate(specId);
    expect(holdoutUsage(specId)).toHaveLength(0);
  });
});

describe("validation identity", () => {
  it("gives every evaluation a distinct id even within one millisecond", () => {
    const specId = seed("rapid");
    for (let i = 0; i < 5; i += 1) evaluate(specId);
    const ids = getDb().select().from(schema.validationResults).all().map((row) => row.id);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("13b — a trial is pinned to the dataset it judged", () => {
  it("refuses evidence that carries no dataset snapshot identity", () => {
    // The fail-closed door. A provider window has no snapshot id, so this is also the test that
    // fails if anyone reintroduces provider bars into validation.
    const specId = seed("no_identity_evidence");
    expect(() =>
      runGauntlet(specId, DSL, { inSampleReturns: returns(), outOfSampleReturns: returns() }),
    ).toThrow(DatasetIdentityMissing);
    // And nothing was spent finding out: the refusal happens before the trial is recorded.
    expect(getDb().select().from(schema.selectionTrials).all()).toHaveLength(0);
  });

  it("persists the snapshot id on the selection trial", () => {
    const specId = seed("trial_pins_snapshot");
    evaluate(specId);
    const trials = getDb().select().from(schema.selectionTrials).all();
    expect(trials.length).toBeGreaterThan(0);
    for (const trial of trials) expect(trial.datasetSnapshotId).toBe("dss_ledger_test");
  });

  it("persists the snapshot id on the holdout access record", () => {
    const specId = seed("holdout_pins_snapshot");
    evaluate(specId, "gen_13b");
    const access = getDb().select().from(schema.holdoutAccess).all();
    expect(access).toHaveLength(1);
    expect(access[0].datasetSnapshotId).toBe("dss_ledger_test");
  });

  it("records a gauntlet experiment whose manifest names every reproducibility input", () => {
    const specId = seed("manifest_recorded");
    const report = evaluate(specId);
    expect(report.datasetSnapshotId).toBe("dss_ledger_test");
    const experiments = getDb().select().from(schema.experiments).all();
    const run = experiments.find((row) => row.kind === "gauntlet" && row.strategySpecId === specId);
    expect(run).toBeDefined();
    const manifest = JSON.parse(run!.manifest!) as Record<string, unknown>;
    for (const field of [
      "strategyVersionId",
      "datasetSnapshotId",
      "datasetFingerprint",
      "engineVersion",
      "feeModelId",
      "marketCalendarVersion",
      "codeFingerprint",
      "createdAt",
    ]) {
      expect(manifest[field], field).toBeTruthy();
    }
    expect(manifest.datasetSnapshotId).toBe("dss_ledger_test");
  });

  it("is deterministic: identical evidence in two fresh families produces identical verdicts", () => {
    // Not two runs on ONE spec — a second run there rightly changes the trial denominator. Two
    // independent families, each judging the same evidence for the first time, must agree exactly.
    const first = seed("det_a", "family_det_a");
    const second = seed("det_b", "family_det_b");
    const once = evaluate(first);
    const twice = evaluate(second);
    expect(twice.stages.map((entry) => [entry.kind, entry.verdict, entry.metrics])).toEqual(
      once.stages.map((entry) => [entry.kind, entry.verdict, entry.metrics]),
    );
    expect(twice.passed).toBe(once.passed);
  });
});
