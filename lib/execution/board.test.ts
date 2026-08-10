import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import type { Candle } from "@/lib/providers/types";
import { DEFAULT_RULES } from "@/lib/risk/gate";
import { requiredCostBps } from "@/lib/strategy/cost-gate";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { openForwardObservation, resolveForwardObservation } from "@/lib/strategy/forward";
import { recordHoldoutOutcome } from "@/lib/strategy/holdout";
import { currentStage } from "@/lib/strategy/promotion";
import { boardSummary, buildTradeBoard, eligibleMarkets } from "./board";

useTemporaryDatabase();

/**
 * The conveyor, end to end.
 *
 * Every rung of this ladder existed before these tests and none of them connected: the holdout
 * verdict had nowhere to live, so nothing could leave `validated`, so nothing reached
 * `owner_review`, so the board that reads `owner_review` would have been dead code shipped green.
 * These tests walk a strategy the whole way and then check what comes out the end.
 */

const NOW = new Date("2026-08-07T14:00:00.000Z"); // 10:00 New York — inside the trading window.
const INSTRUMENT = "US:XNAS:AAPL";

function dsl(overrides: Record<string, unknown> = {}): StrategyDsl {
  return StrategyDslSchema.parse({
    name: "sma_cross_demo",
    universe: { market: "US", maxPositions: 10 },
    entry: { crossover: ["sma20", "sma50"] },
    exit: { afterDays: 10, stopLossPct: 5, takeProfitPct: 10 },
    sizing: { maxPositionPct: 5 },
    // Derived, not a literal. `lib/strategy/cost-gate.ts` holds any strategy whose declared cost
    // is below what the owner's capital actually pays, so a hardcoded figure here would make
    // these tests fail whenever the fee schedule or the owner's capital moves — and the failure
    // would look like a broken board rather than a stale fixture.
    costs: { commissionBps: Math.ceil(requiredCostBps() / 2), slippageBps: 0 },
    ...overrides,
  });
}

/**
 * Bars whose SMA20 crosses above SMA50 on the final bar.
 *
 * A long flat run puts both averages at the same value, then one sharp bar lifts the faster one
 * through the slower. Built rather than fixtured so the crossing is visible in the test.
 */
function crossingBars(finalClose = 100): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < 60; i += 1) {
    const close = 50;
    bars.push({ time: 1_700_000_000 + i * 86_400, open: close, high: close, low: close, close, volume: 1_000 });
  }
  bars.push({
    time: 1_700_000_000 + 60 * 86_400,
    open: finalClose,
    high: finalClose,
    low: finalClose,
    close: finalClose,
    volume: 1_000,
  });
  return bars;
}

function seedSpec(specDsl: StrategyDsl = dsl()): string {
  return recordStrategySpec({ name: specDsl.name, dsl: specDsl, createdBy: "test" });
}

function passGauntlet(specId: string): void {
  getDb()
    .insert(schema.validationResults)
    .values({
      id: `val_${specId}`,
      strategySpecId: specId,
      oosProfitFactor: 1.4,
      pbo: 0.2,
      deflatedSharpe: 0.9,
      costMultiplePf: 1.2,
      trialsCounted: 1,
      passed: 1,
      detail: null,
      evaluatedAt: new Date("2026-07-01T00:00:00.000Z"),
    })
    .run();
}

/** Twenty resolved observations, each a clean +1R. Enough to be evidence, and deterministic. */
function accumulateForwardEvidence(specId: string, count = 20): void {
  for (let i = 0; i < count; i += 1) {
    const openedAt = new Date(Date.UTC(2026, 6, 1 + i));
    const opened = openForwardObservation({
      strategySpecId: specId,
      instrumentId: INSTRUMENT,
      entryPrice: 100,
      stopPrice: 95,
      openedAt,
    });
    if (!("id" in opened)) throw new Error(opened.error);
    resolveForwardObservation(opened.id, 105, "target", new Date(openedAt.getTime() + 86_400_000));
  }
}

/** Walks one strategy to the top of the ladder. */
function promotedSpec(specDsl: StrategyDsl = dsl()): string {
  const specId = seedSpec(specDsl);
  passGauntlet(specId);
  const outcome = recordHoldoutOutcome({
    holdoutId: "holdout_2026_h1",
    specId,
    actor: "test",
    passed: true,
    reason: "Cleared the sealed holdout.",
  });
  expect(outcome.recorded).toBe(true);
  accumulateForwardEvidence(specId);
  return specId;
}

describe("the holdout rung is now climbable", () => {
  it("stops at validated while the holdout has not been queried", () => {
    const specId = seedSpec();
    passGauntlet(specId);
    const { stage, advance } = currentStage(specId, JSON.stringify(dsl()));
    expect(stage).toBe("validated");
    expect(advance.because).toMatch(/sealed holdout has not been queried/i);
  });

  it("reaches owner_review once the holdout clears and forward evidence accumulates", () => {
    const specId = promotedSpec();
    expect(currentStage(specId, JSON.stringify(dsl())).stage).toBe("owner_review");
  });

  it("buries a strategy the holdout rejected rather than leaving it to accumulate", () => {
    const specId = seedSpec();
    passGauntlet(specId);
    recordHoldoutOutcome({
      holdoutId: "holdout_2026_h1",
      specId,
      actor: "test",
      passed: false,
      reason: "Out-of-sample profit factor below 1.",
    });
    expect(currentStage(specId, JSON.stringify(dsl())).stage).toBe("graveyard");
  });
});

describe("the board only prices what has earned it", () => {
  it("proposes nothing when no strategy has reached owner review", () => {
    const specId = seedSpec();
    passGauntlet(specId); // validated, not owner_review
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars() }, now: NOW, equity: 100_000 });
    expect(board.eligible).toHaveLength(0);
    expect(board.entries).toHaveLength(0);
    expect(board.scanned).toBe(0);
    expect(boardSummary(board)).toMatch(/no strategy has reached owner review/i);
  });

  it("prices a fired signal from the strategy's own stop and target", () => {
    promotedSpec();
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars(100) }, now: NOW, equity: 100_000 });

    expect(board.eligible).toHaveLength(1);
    expect(board.entries).toHaveLength(1);
    const { proposal } = board.entries[0];
    expect(proposal.symbol).toBe("AAPL");
    expect(proposal.entryPrice).toBe(100);
    expect(proposal.stopPrice).toBe(95); // 5% below entry, from exit.stopLossPct
    expect(proposal.targetPrice).toBe(110); // 10% above entry, from exit.takeProfitPct
    expect(proposal.forwardObservations).toBe(20);
    expect(proposal.executable).toBe(false);
    expect(proposal.humanConfirmationRequired).toBe(true);
  });

  it("computes the maximum loss from the size it actually asks for", () => {
    promotedSpec();
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars(100) }, now: NOW, equity: 100_000 });
    const entry = board.entries[0];
    // 5% of 100_000 at 100 a unit is 50 units; risking 5 a unit is 250.
    expect(entry.requested).toBe(50);
    expect(entry.proposal.maxLoss).toBe(250);
    expect(entry.proposal.rewardToRisk).toBe(2);
  });

  it("refuses to write a ticket for a strategy with no stop", () => {
    promotedSpec(dsl({ name: "no_stop_demo", exit: { afterDays: 10 } }));
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars() }, now: NOW, equity: 100_000 });
    expect(board.entries).toHaveLength(0);
    expect(board.refusals.join(" ")).toMatch(/declares no stop loss/i);
    expect(board.refusals.join(" ")).toMatch(/unbounded/i);
  });

  it("leaves the target null rather than inventing one when the exit is time-based", () => {
    promotedSpec(dsl({ name: "time_exit_demo", exit: { afterDays: 10, stopLossPct: 5 } }));
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars() }, now: NOW, equity: 100_000 });
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0].proposal.targetPrice).toBeNull();
    expect(board.entries[0].proposal.rewardToRisk).toBeNull();
  });

  it("does not trim a size that exceeds the risk ceiling — it says so and lets the gate block", () => {
    promotedSpec();
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars(100) }, now: NOW, equity: 100_000 });
    expect(board.entries[0].requested).toBeGreaterThan(DEFAULT_RULES.maxContracts);
    expect(board.entries[0].proposal.gate.blockedBy).toContain("max_contracts");
    expect(board.notes.join(" ")).toMatch(/above the ceiling/i);
  });
});

describe("nothing is fetched for a board that cannot exist", () => {
  it("names no market while nothing has reached owner review", () => {
    const specId = seedSpec();
    passGauntlet(specId);
    // The page fetches per market returned here. An empty list is what stops a render of the
    // normal, empty state from costing two dozen provider calls.
    expect(eligibleMarkets()).toEqual([]);
  });

  it("names only the markets an eligible strategy actually trades", () => {
    promotedSpec();
    expect(eligibleMarkets()).toEqual(["US"]);
  });
});

describe("a missing input is distinguishable from a risk breach", () => {
  it("names the inputs this deployment cannot supply", () => {
    promotedSpec();
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars() }, now: NOW, equity: 100_000 });
    const { unavailable } = board.entries[0];

    // Both rules block. Only one of them is a risk finding; the other is a capability gap, and
    // the difference is the whole point of recording a reason per rule.
    expect(unavailable.news_blackout).toMatch(/no economic or earnings calendar/i);
    expect(unavailable.max_pairwise_correlation).toMatch(/no pair exists/i);
    expect(unavailable.daily_loss_limit_r).toBeUndefined(); // idle ledger: measured as zero
  });

  it("reports an empty scan as a scan, not as an absence of strategies", () => {
    promotedSpec();
    const board = buildTradeBoard({ dataset: { [INSTRUMENT]: crossingBars().slice(0, 1) }, now: NOW, equity: 100_000 });
    expect(board.eligible).toHaveLength(1);
    expect(board.entries).toHaveLength(0);
    expect(board.refusals.join(" ")).toMatch(/fewer than two bars/i);
  });
});
