import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { MIN_FORWARD_OBSERVATIONS, openForwardObservation, resolveForwardObservation } from "./forward";
import { STAGE_ORDER, advanceStrategy, isActionable, type Stage } from "./lifecycle";

useTemporaryDatabase();

const SPEC = "spec_ladder";

// `offset` shifts the opening minute so two batches in one test do not produce identical ids —
// `forward_outcomes` carries a UNIQUE (source, external_id) and the second batch would be
// rejected, which reads as a code failure rather than a test that reused a timestamp.
function forwardSample(count: number, exit: number, offset = 0, spec = SPEC) {
  for (let index = 0; index < count; index += 1) {
    const result = openForwardObservation({
      strategySpecId: spec,
      instrumentId: `US:XNAS:T${offset + index}`,
      entryPrice: 100,
      stopPrice: 98,
      openedAt: new Date(2026, 7, 6, 10, offset + index),
    });
    if ("error" in result) throw new Error(result.error);
    resolveForwardObservation(result.id, exit, exit > 100 ? "target" : "stop");
  }
}

describe("a strategy advances one rung at a time", () => {
  it("never skips a stage", () => {
    // The temptation is real: a spectacular backtest looks ready for paper. It is not a
    // formality — the gauntlet exists *because* spectacular backtests are what overfitting
    // produces, and the holdout exists because the gauntlet can be gamed by repetition.
    const advance = advanceStrategy("draft", { rehearsalVerdict: "would_pass", gauntletPassed: true, holdoutCleared: true });
    expect(advance.to).toBe("rehearsed");
  });

  it("walks the whole ladder given evidence at each rung", () => {
    let stage: Stage = "draft";
    const evidence = { rehearsalVerdict: "would_pass" as const, gauntletPassed: true, holdoutCleared: true };
    for (const expected of STAGE_ORDER.slice(1)) {
      if (expected === "owner_review") break;
      stage = advanceStrategy(stage, evidence, SPEC).to;
      expect(stage).toBe(expected);
    }
    expect(stage).toBe("paper_forward");
  });

  it("always explains itself, moving or not", () => {
    expect(advanceStrategy("draft", {}).because.length).toBeGreaterThan(20);
    expect(advanceStrategy("draft", { rehearsalVerdict: "would_pass" }).because.length).toBeGreaterThan(20);
  });
});

describe("what does and does not end a strategy", () => {
  it("does not bury on a failed rehearsal, which costs no trial", () => {
    // Too cheap a signal for a permanent decision.
    const advance = advanceStrategy("draft", { rehearsalVerdict: "would_fail" });
    expect(advance.to).toBe("draft");
    expect(advance.because).toMatch(/too cheap a signal/);
  });

  it("does not bury a strategy that cannot be evaluated here", () => {
    // A deployment gap, not a bad idea. Burying it would discard a legitimate strategy for
    // lacking data that may arrive tomorrow.
    const advance = advanceStrategy("draft", { rehearsalVerdict: "not_evaluable" });
    expect(advance.moved).toBe(false);
    expect(advance.because).toMatch(/deployment is incomplete/);
  });

  it("buries a rediscovery immediately", () => {
    const advance = advanceStrategy("draft", { rehearsalVerdict: "rediscovered" });
    expect(advance.to).toBe("graveyard");
  });

  it("buries on a failed gauntlet, because the trial was spent either way", () => {
    const advance = advanceStrategy("rehearsed", { gauntletPassed: false, deflatedSharpe: 0.936 });
    expect(advance.to).toBe("graveyard");
    expect(advance.because).toMatch(/0\.936/);
  });

  it("buries when the holdout budget is exhausted rather than querying again", () => {
    // Querying a spent holdout turns it into another training set — the one thing it cannot be.
    const advance = advanceStrategy("validated", { holdoutExhausted: true });
    expect(advance.to).toBe("graveyard");
    expect(advance.because).toMatch(/another training set/);
  });

  it("never revives a graveyard entry", () => {
    const advance = advanceStrategy("graveyard", { rehearsalVerdict: "would_pass", gauntletPassed: true });
    expect(advance.moved).toBe(false);
  });
});

describe("forward evidence is the last gate and the strictest", () => {
  it("holds at paper_forward below the observation threshold", () => {
    forwardSample(3, 104);
    const advance = advanceStrategy("paper_forward", {}, SPEC);
    expect(advance.moved).toBe(false);
    expect(advance.because).toMatch(/cannot separate an edge from chance/);
  });

  it("buries a strategy whose only unbiased sample is negative", () => {
    forwardSample(MIN_FORWARD_OBSERVATIONS, 98);
    const advance = advanceStrategy("paper_forward", {}, SPEC);
    expect(advance.to).toBe("graveyard");
    expect(advance.because).toMatch(/the edge is not there/);
  });

  it("promotes on a positive mean that exceeds its own standard error", () => {
    forwardSample(MIN_FORWARD_OBSERVATIONS, 104);
    const advance = advanceStrategy("paper_forward", {}, SPEC);
    expect(advance.to).toBe("owner_review");
    expect(advance.because).toMatch(/Unbiased and positive/);
  });

  it("holds when the mean is smaller than its own uncertainty", () => {
    // Positive but indistinguishable from noise that happened to land above zero. Asking for
    // more observations is the honest response; promoting would dress up variance as an edge.
    // 11 wins at +1R and 9 losses at −1R: mean 0.10R, standard error ≈ 0.23. Positive, and
    // entirely inside its own noise. Promoting this would dress up variance as an edge.
    forwardSample(11, 102);
    forwardSample(9, 98, 11);
    const advance = advanceStrategy("paper_forward", {}, SPEC);
    expect(advance.moved).toBe(false);
    expect(advance.because).toMatch(/smaller than its own uncertainty/);
  });
});

describe("only unbiased evidence is actionable", () => {
  it("treats everything below owner_review as research", () => {
    // `validated` is where a system wanting to look impressive would draw the line — the gauntlet
    // is genuinely hard. But everything up to it is measured on data the strategy was selected
    // against, and only forward observations are not.
    for (const stage of ["draft", "rehearsed", "validated", "holdout_cleared", "paper_forward"] as Stage[]) {
      expect(isActionable(stage), stage).toBe(false);
    }
    expect(isActionable("owner_review")).toBe(true);
  });

  it("stops at owner review and hands the decision over", () => {
    const advance = advanceStrategy("owner_review", {}, SPEC);
    expect(advance.moved).toBe(false);
    expect(advance.because).toMatch(/a human either acts or does not/);
  });
});
