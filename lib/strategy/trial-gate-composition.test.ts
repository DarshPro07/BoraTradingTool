import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { runAutonomousGauntlet } from "./auto-gauntlet";
import { REGISTERED_CRITERIA_HASH } from "./trial-governor";

/**
 * The composition, not the parts.
 *
 * The P0 found on 2026-08-17 existed precisely because every module passed its own tests. The gate
 * computed honestly. The governor guarded honestly. `evaluateTrialActivation` was imported by
 * exactly one file — `app/brain/page.tsx`, a display page — and the wire between the declaration
 * and the spend was never run. Unit tests could not see that, because the gap was *between* units.
 *
 * So these tests exercise the real production entry points with the real live gate, and they assert
 * the invariant that matters:
 *
 *   **No code path can permanently spend a statistical trial without passing the registered
 *   campaign gate.**
 */

useTemporaryDatabase();

/**
 * `runAutonomousGauntlet` takes no env seam — it reads `process.env` through the governor. That is
 * correct for production and means the composition test must set the real switch to exercise the
 * one configuration that matters: owner switch ON, registered criteria NOT satisfied.
 */
function withOwnerSwitchOn(): void {
  vi.stubEnv("MARKETPULSE_AUTONOMOUS_TRIALS", "1");
}

describe("the real gauntlet entry point cannot spend against an unsatisfied gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses with the owner switch ON, and spends nothing", async () => {
    // A temporary database has no registered campaign and no coverage, so the LIVE gate cannot be
    // satisfied. This is the exact configuration that would previously have authorized a spend:
    // switch on, criteria not met.
    withOwnerSwitchOn();
    const report = await runAutonomousGauntlet({
      mode: "evolving",
      researchData: () => ({
        ok: false,
        code: "NO_STORED_DATA",
        message: "no data in this fixture",
      }),
    } as never);

    expect(report.policyAllowed, "the switch alone must not authorize").toBe(false);
    expect(
      report.policyReason,
      "the refusal must come from the campaign gate, not merely from a disabled lane",
    ).toMatch(/campaign|criteria/i);

    // The assertions that actually matter: nothing permanent happened.
    expect(getDb().select().from(schema.trials).all().length).toBe(0);
    expect(getDb().select().from(schema.trialReservations).all().length).toBe(0);
    expect(getDb().select().from(schema.selectionTrials).all().length).toBe(0);
  });
});

describe("no production caller may supply its own campaign gate", () => {
  /**
   * The structural guard. The `gate` seam exists so tests can drive the branches; a production
   * caller passing `() => ({ criteriaSatisfied: true })` would reopen the hole this closed, and it
   * would look entirely reasonable in review.
   *
   * Source-level, deliberately: a runtime test cannot see a call site nobody exercised, which is
   * the same blind spot that let the original defect survive.
   */
  const PRODUCTION_CALLERS = [
    "lib/strategy/auto-gauntlet.ts",
    "lib/research/worker.ts",
  ];

  for (const relative of PRODUCTION_CALLERS) {
    it(`${relative} calls the governor without overriding the gate`, () => {
      const source = readFileSync(path.join(process.cwd(), relative), "utf8");
      expect(source).toMatch(/withAuthorizedTrial|authorizeTrial/);
      expect(
        source,
        `${relative} passes a gate override; production must evaluate the LIVE gate`,
      ).not.toMatch(/gate\s*:/);
    });
  }

  it("the registered hash is pinned in the governor, not just in the gate module", () => {
    // If the criteria move, the governor refuses rather than silently accepting a different
    // experiment. That check is worthless if the constant drifts, so it is asserted here too.
    expect(REGISTERED_CRITERIA_HASH).toBe("19e571a36128b1ef");
  });
});
