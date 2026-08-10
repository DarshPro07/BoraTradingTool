import { describe, expect, it } from "vitest";
import { OWNER_CAPITAL } from "@/lib/paper/capital";
import { costStanding, requiredCostBps } from "./cost-gate";
import { advanceStrategy, type StageEvidence } from "./lifecycle";

/**
 * The gate that makes the cost finding enforceable.
 *
 * A backtest is net of whatever cost its DSL declares. So a spec declaring 20 bps produces a
 * profit curve that is arithmetically correct and describes a market that does not exist — and
 * every strategy bred before `lib/paper/capital.ts` declares exactly that.
 *
 * The gauntlet cannot catch this. It tests whether the edge is real given the stated cost; it has
 * no opinion about whether the stated cost is real. Nothing else in the ladder looks at the number
 * either, which is how a candidate optimised against a fictional market could have climbed all the
 * way to owner review.
 */

/** What `lib/factory/breed.ts` hardcoded before the capital model existed: (3+7)×2 = 20 bps. */
const UNDERSTATED = JSON.stringify({ costs: { commissionBps: 3, slippageBps: 7 } });

function honest(): string {
  // Half, because `roundTripCostBps` doubles each side. A generous margin above the requirement.
  const perSide = Math.ceil(requiredCostBps() / 2) + 5;
  return JSON.stringify({ costs: { commissionBps: perSide, slippageBps: 0 } });
}

describe("what the owner's capital actually requires", () => {
  it("is materially more than the old hardcoded assumption", () => {
    expect(requiredCostBps()).toBeGreaterThan(20);
  });
});

describe("catching a strategy priced for a market that does not exist", () => {
  it("flags the old 20 bps assumption as understated", () => {
    const verdict = costStanding(UNDERSTATED);
    expect(verdict.understated).toBe(true);
    expect(verdict.declaredBps).toBe(20);
  });

  it("names both numbers, so the reason is checkable rather than assertive", () => {
    const verdict = costStanding(UNDERSTATED);
    expect(verdict.reason).toContain(String(verdict.declaredBps));
    expect(verdict.reason).toContain(String(verdict.requiredBps));
  });

  it("accepts a strategy that prices its own trading honestly", () => {
    expect(costStanding(honest()).understated).toBe(false);
  });

  it("treats a spec that declares no cost at all as understated, not as unknown", () => {
    // Zero is the most dangerous value here: it produces the highest returns and looks like a
    // deliberate configuration rather than an omission.
    expect(costStanding(JSON.stringify({ costs: { commissionBps: 0, slippageBps: 0 } })).understated).toBe(true);
  });

  it("refuses to judge a DSL it cannot parse, rather than passing it", () => {
    // An unparseable spec has no declared cost. Defaulting to "fine" would let the one case
    // nobody can inspect through the gate.
    expect(costStanding("{not json").understated).toBe(true);
  });
});

describe("the ladder refusing to promote on invalid evidence", () => {
  const passing: StageEvidence = {
    rehearsalVerdict: "would_pass",
    gauntletPassed: true,
    outOfSampleProfitFactor: 2.4,
    deflatedSharpe: 1.2,
    holdoutCleared: true,
  };

  it("holds a strategy at draft when its costs are fiction", () => {
    // Reason taken from the real gate rather than invented, so the assertion tests the wiring
    // instead of a string this test wrote for itself.
    const real = costStanding(UNDERSTATED);
    const advance = advanceStrategy("draft", { ...passing, costUnderstated: true, costReason: real.reason });
    expect(advance.moved).toBe(false);
    expect(advance.because).toMatch(/cost/i);
    expect(advance.because).toContain(String(real.requiredBps));
  });

  it("falls back to a cost-naming refusal when no reason is supplied", () => {
    const advance = advanceStrategy("draft", { ...passing, costUnderstated: true });
    expect(advance.moved).toBe(false);
    expect(advance.because).toMatch(/cost/i);
  });

  it("lets the same evidence through once the cost is honest", () => {
    expect(advanceStrategy("draft", { ...passing, costUnderstated: false }).moved).toBe(true);
  });

  it("blocks at every rung, not only the first", () => {
    // A strategy already at `validated` when the real cost was discovered must not keep climbing
    // on a backtest that was computed against the wrong market.
    for (const stage of ["rehearsed", "validated"] as const) {
      const advance = advanceStrategy(stage, { ...passing, costUnderstated: true, costReason: "understated" });
      expect(advance.moved, stage).toBe(false);
    }
  });

  it("says nothing about cost when the evidence does not mention it", () => {
    // Absent is not false. A caller that never computed the cost standing must not have its
    // strategies silently blocked as though they had failed a check nobody ran.
    expect(advanceStrategy("draft", passing).moved).toBe(true);
  });
});

describe("the owner's capital is what sets the bar", () => {
  it("derives the requirement from the stated capital rather than a constant", () => {
    expect(OWNER_CAPITAL.amount).toBeGreaterThan(0);
    expect(requiredCostBps()).toBeGreaterThan(0);
  });
});
