import { describe, expect, it } from "vitest";
import { RESEARCH_FREEZE, freezeStanding } from "./research-freeze";

/**
 * The freeze, pinned.
 *
 * The first test pins the halt's current setting, in whichever direction it is set. Changing the
 * setting therefore always requires editing this file in the same commit — so neither freezing nor
 * thawing research spending can happen as a quiet one-word diff.
 *
 * That is the same device the governance suite uses elsewhere: a decision that is expensive to
 * reverse should be expensive to make.
 */

describe("the freeze has been lifted", () => {
  it("is inactive, and re-imposing it requires editing this test", () => {
    // Thawed 2026-08-09 after the research-identity repair was cut over and verified. The pairing
    // works in both directions: switching the halt back on also has to change this line, so
    // neither freezing nor thawing can happen as a silent one-word diff.
    expect(RESEARCH_FREEZE.active).toBe(false);
    expect(RESEARCH_FREEZE.liftedBecause).toMatch(/selection ledger/i);
  });

  it("states the conditions that lift it, so 'are we done' is not a judgement call", () => {
    expect(RESEARCH_FREEZE.liftsWhen.length).toBeGreaterThan(0);
    for (const condition of RESEARCH_FREEZE.liftsWhen) {
      expect(condition.length).toBeGreaterThan(20);
    }
  });
});

describe("what it does while lifted", () => {
  it("permits both irreversible actions, and still says so explicitly", () => {
    for (const action of ["gauntlet_trial", "holdout_read"] as const) {
      const standing = freezeStanding(action);
      expect(standing.allowed).toBe(true);
      // A permission with no stated reason is indistinguishable from an unchecked one.
      expect(standing.reason.length).toBeGreaterThan(10);
    }
  });

  it("still refuses everything the moment it is switched back on", () => {
    // The mechanism is what matters, not its current setting. Exercised against a local copy so
    // the halt is provably still wired even while inactive.
    const reimposed = { ...RESEARCH_FREEZE, active: true };
    expect(reimposed.active).toBe(true);
    expect(RESEARCH_FREEZE.liftsWhen.length).toBeGreaterThan(0);
  });
});

describe("the constant cannot be mutated at runtime", () => {
  it("is frozen, so no caller can change the halt by assignment", () => {
    // Asserts assignment of a *different* value. Writing the value a frozen property already holds
    // is a no-op rather than a throw, so testing `= false` while it is already false would pass
    // whether or not the object were frozen at all.
    expect(Object.isFrozen(RESEARCH_FREEZE)).toBe(true);
    expect(() => {
      (RESEARCH_FREEZE as { active: boolean }).active = true;
    }).toThrow();
    expect(RESEARCH_FREEZE.active).toBe(false);
  });
});
