import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { compileStrategy, roundTripCostBps, type StrategyDsl } from "./dsl";
import {
  createRandom,
  deflatedSharpeRatio,
  expectedMaxSharpe,
  monteCarlo,
  normalCdf,
  normalInverse,
  probabilityOfBacktestOverfitting,
  profitFactor,
  sharpeRatio,
} from "./statistics";
import { GATES, holdoutUsage, requestHoldout, runGauntlet } from "./gauntlet";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-strategy-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "strategy.db");
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

const VALID_DSL = {
  name: "gap_quality",
  universe: { market: "NSE" as const, maxPositions: 10 },
  entry: { all: [{ feature: "gap_pct", op: "gt" as const, value: 2 }, { feature: "rvol", op: "gte" as const, value: 1.5 }] },
  exit: { afterDays: 5, stopLossPct: 3 },
  sizing: { maxPositionPct: 10 },
  costs: { commissionBps: 3, slippageBps: 7 },
};

describe("strategy DSL compiler", () => {
  it("compiles a valid strategy and reports its features", () => {
    const result = compileStrategy(VALID_DSL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.features).toEqual(["gap_pct", "rvol"]);
    expect(result.hash).toHaveLength(32);
  });

  it("produces a stable hash regardless of key order", () => {
    const a = compileStrategy(VALID_DSL);
    const b = compileStrategy({ ...VALID_DSL, description: undefined });
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true);
  });

  it("refuses a strategy that references the future", () => {
    const result = compileStrategy({
      ...VALID_DSL,
      entry: { feature: "future_return", op: "gt", value: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOOKAHEAD_FEATURE");
    expect(result.message).toMatch(/not knowable at decision time/);
  });

  it("catches a lookahead feature nested deep inside a condition", () => {
    const result = compileStrategy({
      ...VALID_DSL,
      entry: { all: [{ feature: "rvol", op: "gt", value: 1 }, { any: [{ not: { feature: "next_close", op: "gt", value: 1 } }] }] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOOKAHEAD_FEATURE");
  });

  it("rejects an unknown feature rather than assuming it exists", () => {
    const result = compileStrategy({ ...VALID_DSL, entry: { feature: "moon_phase", op: "gt", value: 0 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_FEATURE");
  });

  it("refuses an exit that never closes a position", () => {
    const result = compileStrategy({ ...VALID_DSL, exit: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SCHEMA_INVALID");
    expect(result.message).toMatch(/never close/);
  });

  it("warns about zero costs and concentration without blocking", () => {
    const result = compileStrategy({
      ...VALID_DSL,
      exit: { afterDays: 5 },
      sizing: { maxPositionPct: 20 },
      costs: { commissionBps: 0, slippageBps: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/Zero modelled costs/);
    expect(result.warnings.join(" ")).toMatch(/concentrated/);
    expect(result.warnings.join(" ")).toMatch(/No stop loss/);
  });

  it("computes round-trip cost in basis points", () => {
    expect(roundTripCostBps(VALID_DSL as StrategyDsl)).toBe(20);
    expect(roundTripCostBps(VALID_DSL as StrategyDsl, 2)).toBe(40);
  });
});

describe("statistics", () => {
  it("matches known normal distribution values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalInverse(0.975)).toBeCloseTo(1.96, 2);
    expect(normalInverse(0.5)).toBeCloseTo(0, 5);
  });

  it("raises the Sharpe bar as the number of trials grows", () => {
    const few = expectedMaxSharpe(5);
    const many = expectedMaxSharpe(500);
    expect(many).toBeGreaterThan(few);
  });

  it("deflates a strong Sharpe found after many trials", () => {
    const returns = Array.from({ length: 100 }, (_, index) => (index % 3 === 0 ? -0.01 : 0.012));
    const honest = deflatedSharpeRatio({ returns, trials: 1 });
    const dredged = deflatedSharpeRatio({ returns, trials: 5_000 });

    expect(honest.sharpe).toBe(dredged.sharpe);
    expect(dredged.threshold).toBeGreaterThan(honest.threshold);
    expect(dredged.deflatedSharpe).toBeLessThan(honest.deflatedSharpe);
  });

  it("computes profit factor and handles the no-loss case", () => {
    expect(profitFactor([1, 1, -1])).toBeCloseTo(2, 5);
    expect(profitFactor([1, 2])).toBe(Number.POSITIVE_INFINITY);
    expect(profitFactor([])).toBe(0);
  });

  it("produces reproducible Monte Carlo results from a seed", () => {
    const returns = [0.02, -0.01, 0.03, -0.02, 0.01, 0.015, -0.005];
    const first = monteCarlo(returns, 200, 7);
    const second = monteCarlo(returns, 200, 7);
    expect(first).toEqual(second);
    expect(monteCarlo(returns, 200, 8)).not.toEqual(first);
  });

  it("reports a losing strategy as likely to lose", () => {
    const losing = Array.from({ length: 50 }, (_, index) => (index % 4 === 0 ? 0.01 : -0.01));
    expect(monteCarlo(losing, 300, 1).probabilityOfLoss).toBeGreaterThan(0.8);
  });

  it("generates deterministic pseudo-random numbers in range", () => {
    const random = createRandom(123);
    const values = Array.from({ length: 100 }, () => random());
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRandom(123)()).toBe(values[0]);
  });

  it("detects overfitting when in-sample winners fail out of sample", () => {
    // Config 0 is tuned to the first half and collapses in the second.
    const overfit = [
      [5, 5, 5, 5, -5, -5, -5, -5],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 2, 2, 2, 2],
    ];
    expect(probabilityOfBacktestOverfitting(overfit)).toBeGreaterThan(0.4);
  });

  it("reports low overfitting for a genuinely consistent configuration", () => {
    const consistent = [
      [3, 3, 3, 3, 3, 3, 3, 3],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    expect(probabilityOfBacktestOverfitting(consistent)).toBeLessThan(0.2);
  });

  it("returns zero Sharpe for a constant series", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBe(0);
  });
});

function seedSpec(name = "gap_quality"): string {
  return recordStrategySpec({ name, version: 1, dsl: VALID_DSL, createdBy: "test" });
}

function goodReturns(count = 60): number[] {
  return Array.from({ length: count }, (_, index) => (index % 5 === 0 ? -0.01 : 0.014));
}

describe("validation gauntlet", () => {
  it("rejects a strategy whose edge disappears out of sample", () => {
    const specId = seedSpec();
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: goodReturns(),
      outOfSampleReturns: Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 0.005 : -0.01)),
    });

    expect(report.passed).toBe(false);
    expect(report.stages.find((stage) => stage.kind === "walk_forward")?.verdict).toBe("fail");
    expect(report.summary).toMatch(/Rejected/);
  });

  it("marks a small sample inconclusive rather than passing it", () => {
    const specId = seedSpec();
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: goodReturns(10),
      outOfSampleReturns: goodReturns(10),
    });

    const replay = report.stages.find((stage) => stage.kind === "replay");
    expect(replay?.verdict).toBe("inconclusive");
    expect(report.passed).toBe(false);
  });

  it("records every stage as a trial in the ledger", () => {
    const specId = seedSpec();
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: goodReturns(),
      outOfSampleReturns: goodReturns(),
    });

    const trials = getDb().select().from(schema.trials).all();
    expect(trials.length).toBe(report.stages.length);
    expect(trials.every((trial) => trial.strategySpecId === specId)).toBe(true);
  });

  it("writes a validation result and updates the strategy status", () => {
    const specId = seedSpec();
    runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: goodReturns(),
      outOfSampleReturns: Array.from({ length: 60 }, () => -0.01),
    });

    const results = getDb().select().from(schema.validationResults).all();
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(0);

    const spec = getDb().select().from(schema.strategySpecs).all()[0];
    expect(spec.status).toBe("rejected");
  });

  it("records failure memory so the same dead end is visible later", () => {
    const specId = seedSpec();
    runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: goodReturns(),
      outOfSampleReturns: Array.from({ length: 60 }, () => -0.01),
    });

    const failures = getDb().select().from(schema.failureMemory).all();
    expect(failures).toHaveLength(1);
    expect(failures[0].subjectId).toBe(specId);
  });

  it("fails a strategy that cannot survive double costs", () => {
    const specId = seedSpec();
    // Thin edge: 20bps round trip doubled wipes it out.
    const thin = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 0.0022 : -0.0012));
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: thin,
      outOfSampleReturns: thin,
    });

    expect(report.stages.find((stage) => stage.kind === "cost_stress")?.verdict).toBe("fail");
  });

  it("fails a strategy that does not beat not trading", () => {
    const specId = seedSpec();
    const flat = Array.from({ length: 60 }, () => 0);
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: flat,
      outOfSampleReturns: flat,
      noTradeReturns: Array.from({ length: 60 }, () => 0.001),
    });

    expect(report.stages.find((stage) => stage.kind === "no_trade_comparison")?.verdict).toBe("fail");
  });

  it("refuses an unpaired benchmark instead of comparing it", () => {
    const specId = seedSpec();
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: goodReturns(),
      outOfSampleReturns: goodReturns(),
      noTradeReturns: Array.from({ length: 10 }, () => 0),
    });

    expect(report.stages.find((stage) => stage.kind === "no_trade_comparison")?.verdict).toBe("inconclusive");
    expect(report.passed).toBe(false);
  });

  it("fails an edge indistinguishable from luck even when the mean is positive", () => {
    const specId = seedSpec();
    // Mean of +1bp per trade riding on ±1% swings: positive, but statistically pure noise.
    const noisy = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 0.0102 : -0.01));
    const report = runGauntlet(specId, VALID_DSL as StrategyDsl, {
      inSampleReturns: noisy,
      outOfSampleReturns: noisy,
    });

    expect(report.stages.find((stage) => stage.kind === "no_trade_comparison")?.verdict).toBe("fail");
  });

  it("raises the bar as prior trials accumulate", () => {
    const specId = seedSpec();
    const returns = goodReturns();

    runGauntlet(specId, VALID_DSL as StrategyDsl, { inSampleReturns: returns, outOfSampleReturns: returns });
    const firstDsr = getDb().select().from(schema.validationResults).all()[0].deflatedSharpe;

    for (let round = 0; round < 4; round += 1) {
      runGauntlet(specId, VALID_DSL as StrategyDsl, { inSampleReturns: returns, outOfSampleReturns: returns });
    }
    const results = getDb().select().from(schema.validationResults).all();
    const lastDsr = results[results.length - 1].deflatedSharpe;

    expect(lastDsr).toBeLessThan(firstDsr ?? 1);
  });

  it("exposes its gate thresholds", () => {
    expect(GATES.minOutOfSampleProfitFactor).toBeGreaterThan(1);
    expect(GATES.maxPbo).toBeLessThanOrEqual(0.5);
  });
});

describe("locked holdout guard", () => {
  it("grants the first query and refuses the second", () => {
    const specId = seedSpec();

    const first = requestHoldout("holdout_2026", specId, "autonomous_worker");
    expect(first.granted).toBe(true);

    const second = requestHoldout("holdout_2026", specId, "autonomous_worker");
    expect(second.granted).toBe(false);
    if (second.granted) return;
    expect(second.code).toBe("HOLDOUT_BUDGET_EXHAUSTED");
    expect(second.message).toMatch(/unbiased estimate/);
  });

  it("tracks budgets per strategy, not globally", () => {
    const first = seedSpec("alpha_one");
    const second = seedSpec("alpha_two");

    expect(requestHoldout("holdout_2026", first, "worker").granted).toBe(true);
    expect(requestHoldout("holdout_2026", second, "worker").granted).toBe(true);
  });

  it("cannot be reset by deleting ledger rows", () => {
    const specId = seedSpec();
    requestHoldout("holdout_2026", specId, "worker");

    expect(() => getDb().delete(schema.holdoutLedger).run()).toThrow(/append-only/i);
    expect(holdoutUsage(specId)).toHaveLength(1);
    expect(requestHoldout("holdout_2026", specId, "worker").granted).toBe(false);
  });
});
