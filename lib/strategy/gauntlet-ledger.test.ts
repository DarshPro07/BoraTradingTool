import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { recordHypothesis, recordStrategySpec } from "@/lib/knowledge/repository";
import type { StrategyDsl } from "./dsl";
import { HoldoutBudgetExhausted, holdoutUsage, runGauntlet } from "./gauntlet";

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
    ...(holdoutId ? { holdoutId } : {}),
  });
}

describe("multiple-testing denominator", () => {
  it("counts evaluations, not the gate rows each evaluation writes", () => {
    const specId = recordStrategySpec({ name: "solo", version: 1, dsl: DSL, createdBy: "test" });

    expect(evaluate(specId).trialsCounted).toBe(1);

    // One evaluation writes one row per gate. Reading those rows back as the denominator
    // made the statistical bar scale with how many gates happen to run.
    const rowsAfterFirst = getDb().select().from(schema.trials).all().length;
    expect(rowsAfterFirst).toBeGreaterThan(1);

    expect(evaluate(specId).trialsCounted).toBe(2);
    expect(getDb().select().from(schema.trials).all().length).toBe(rowsAfterFirst * 2);
  });

  it("deflates against sibling specs from the same hypothesis", () => {
    // A search that spawns many variants and reports the best previously showed a
    // denominator of 1 for each, because each spec had been evaluated exactly once.
    const hypothesisId = recordHypothesis({
      title: "Gap continuation",
      statement: "Large opening gaps on high relative volume continue intraday.",
      createdBy: "test",
    });

    const first = recordStrategySpec({ name: "variant_a", version: 1, dsl: DSL, createdBy: "test", hypothesisId });
    const second = recordStrategySpec({ name: "variant_b", version: 1, dsl: DSL, createdBy: "test", hypothesisId });

    expect(evaluate(first).trialsCounted).toBe(1);
    expect(evaluate(second).trialsCounted).toBe(2);
  });

  it("does not let an unrelated strategy raise another's bar", () => {
    const a = recordStrategySpec({ name: "unrelated_a", version: 1, dsl: DSL, createdBy: "test" });
    const b = recordStrategySpec({ name: "unrelated_b", version: 1, dsl: DSL, createdBy: "test" });

    evaluate(a);
    expect(evaluate(b).trialsCounted).toBe(1);
  });

  it("stores the denominator it actually deflated by", () => {
    const specId = recordStrategySpec({ name: "stored", version: 1, dsl: DSL, createdBy: "test" });
    const report = evaluate(specId);
    const [row] = getDb().select().from(schema.validationResults).all();
    expect(row.trialsCounted).toBe(report.trialsCounted);
  });
});

describe("locked holdout", () => {
  it("consumes the budget when holdout evidence is supplied", () => {
    const specId = recordStrategySpec({ name: "holdout_spec", version: 1, dsl: DSL, createdBy: "test" });
    evaluate(specId, "holdout_2026");
    expect(holdoutUsage(specId)).toHaveLength(1);
  });

  it("refuses a second query rather than producing a number to discard", () => {
    const specId = recordStrategySpec({ name: "holdout_twice", version: 1, dsl: DSL, createdBy: "test" });
    evaluate(specId, "holdout_2026");
    expect(() => evaluate(specId, "holdout_2026")).toThrow(HoldoutBudgetExhausted);
  });

  it("refuses before writing a second validation result", () => {
    const specId = recordStrategySpec({ name: "holdout_atomic", version: 1, dsl: DSL, createdBy: "test" });
    evaluate(specId, "holdout_2026");
    expect(() => evaluate(specId, "holdout_2026")).toThrow();
    // The refused attempt left no trace beyond the original evaluation.
    expect(getDb().select().from(schema.validationResults).all()).toHaveLength(1);
  });

  it("leaves the budget untouched when no holdout is claimed", () => {
    const specId = recordStrategySpec({ name: "no_holdout", version: 1, dsl: DSL, createdBy: "test" });
    evaluate(specId);
    evaluate(specId);
    expect(holdoutUsage(specId)).toHaveLength(0);
  });
});

describe("validation identity", () => {
  it("gives every evaluation a distinct id even within one millisecond", () => {
    const specId = recordStrategySpec({ name: "rapid", version: 1, dsl: DSL, createdBy: "test" });
    for (let i = 0; i < 5; i += 1) evaluate(specId);
    const ids = getDb().select().from(schema.validationResults).all().map((row) => row.id);
    expect(new Set(ids).size).toBe(5);
  });
});
