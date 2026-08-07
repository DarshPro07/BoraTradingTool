import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { nextStep } from "./next-step";

/**
 * The requirement, in the owner's words: *"a user does not know what to do, how to trade, but
 * with this system it will be able to."*
 *
 * Every other panel reports state. This is the only one that says what to do about it, so its
 * obligations are different: the language has to be plain, the step has to be single, and it
 * must never invent progress to seem encouraging.
 *
 * Run against an empty database on purpose. `nextStep` is at its most load-bearing for someone who
 * has just installed this and has nothing — and reading the owner's real database, as this file
 * used to, meant the first-run path was never the one under test.
 */

useTemporaryDatabase();

describe("the guidance is always answerable", () => {
  it("always returns exactly one step", () => {
    // A checklist of nine things is another way of saying "work it out yourself".
    const step = nextStep();
    expect(step.id).toBeTruthy();
    expect(step.title.length).toBeGreaterThan(0);
    expect(step.href.startsWith("/")).toBe(true);
  });

  it("keeps the title short enough to act on", () => {
    expect(nextStep().title.split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it("explains why, not only what", () => {
    // Someone who has never traded needs the reason, or the instruction is a ritual.
    const step = nextStep();
    expect(step.why.length).toBeGreaterThan(80);
    expect(step.action.length).toBeGreaterThan(40);
  });

  it("points somewhere that exists", () => {
    const routes = ["/command", "/strategies", "/paper", "/trades", "/premarket", "/memory", "/dashboard"];
    expect(routes).toContain(nextStep().href);
  });
});

describe("it does not use jargon the reader has not been given", () => {
  const UNEXPLAINED = ["Sharpe", "PBO", "bootstrap", "p-value", "autocorrelation", "quantile", "DSL"];

  it("avoids unexplained technical terms in the reason", () => {
    const step = nextStep();
    for (const term of UNEXPLAINED) {
      expect(step.why.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("avoids them in the action too", () => {
    const step = nextStep();
    for (const term of UNEXPLAINED) {
      expect(step.action.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

describe("it never invents progress", () => {
  it("reports counts that agree with each other", () => {
    const { progress } = nextStep();
    // Testable is a subset of authored; a strategy cannot be testable without existing.
    expect(progress.evaluable).toBeLessThanOrEqual(progress.authored);
    for (const value of Object.values(progress)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("asks for a first strategy when none exists", () => {
    const step = nextStep();
    if (step.progress.authored === 0) {
      expect(step.id).toBe("author_first");
      expect(step.needsYou).toBe(true);
    }
  });

  it("says a strategy needing absent data can never run, rather than to keep waiting", () => {
    const step = nextStep();
    if (step.progress.authored > 0 && step.progress.evaluable === 0) {
      expect(step.id).toBe("fix_unsupported");
      expect(step.why).toMatch(/never/);
    }
  });

  it("marks whether the step is on the owner or on the system", () => {
    // "Needs you" and "running on its own" are different states, and a user who cannot tell
    // them apart will either wait forever or interrupt work that was proceeding.
    expect(typeof nextStep().needsYou).toBe("boolean");
  });
});

describe("it is honest about cost", () => {
  it("says rehearsal is free wherever it recommends one", () => {
    const step = nextStep();
    if (step.id === "run_cycle") {
      expect(`${step.why} ${step.action}`.toLowerCase()).toMatch(/costs nothing|free|changes nothing/);
    }
  });

  it("warns that a trial is irreversible before recommending one", () => {
    const step = nextStep();
    if (step.id === "spend_trial") {
      expect(step.why.toLowerCase()).toMatch(/once|permanently|spent/);
    }
  });

  it("states that the software cannot place the order", () => {
    const step = nextStep();
    if (step.id === "review_proposals") {
      expect(step.action.toLowerCase()).toMatch(/cannot place|yourself/);
    }
  });
});
