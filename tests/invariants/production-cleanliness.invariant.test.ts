import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { standings } from "@/lib/strategy/promotion";
import { evaluateTrialActivation, NSE_QC_001_ACTIVATION } from "@/lib/strategy/trial-activation";
import { NSE_QC_001 } from "@/lib/strategy/campaigns/nse-qc-001";
import { classifySpec } from "@/lib/strategy/research-eligibility";
import type { Standing } from "@/lib/strategy/promotion";

/**
 * **What MarketPulse claims can never happen:** a browser fixture, or a strategy for a market this
 * deployment does not serve, contributes to the campaign's readiness.
 *
 * Measured 2026-08-16: **14 of 22** strategy specs in the production database were Playwright
 * artifacts, and the pre-registered gate reported "2 strategies standing ready to spend a trial"
 * partly on their strength. A trial is a permanent statistical cost; authorising one because a
 * browser test left a row behind spends the multiple-testing budget on nothing.
 *
 * The second category cost as much as the first. `sma_cross_20_50` is a US strategy whose
 * `would_pass` verdict is dated 2026-08-09 and cannot be reproduced — the store holds no US daily
 * bars at all. Its verdict was preserved by a rule meant for a ten-second provider outage.
 *
 * Driven through the real gate, because a classifier that is correct in isolation while the gate
 * ignores it is precisely the failure this suite exists to catch.
 */

useTemporaryDatabase();

function standing(over: Partial<Standing>): Standing {
  return {
    specId: "stg_x",
    name: "spec",
    stage: "rehearsed",
    advance: { kind: "hold", reason: "t" } as never,
    blockedOn: "gauntlet",
    origin: "PRODUCTION_RESEARCH",
    researchEligible: true,
    eligibilityReason: "test fixture",
    ...over,
  };
}

const poolBlocker = (standings: Standing[]) =>
  evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION, {
    standings: () => standings,
  }).blockers.find((b) => b.startsWith("pool:")) ?? "";

describe("INVARIANT: only production research counts toward campaign readiness", () => {
  it("a browser fixture standing ready is not counted", () => {
    const counted = poolBlocker([
      standing({ specId: "stg_real", name: "real" }),
      standing({
        specId: "stg_fixture",
        name: "e2e_ladder_fixture",
        origin: "E2E_FIXTURE",
        researchEligible: false,
        eligibilityReason: "written by test actor e2e",
      }),
    ]);
    expect(counted, "only the research-eligible standing may count").toContain("1 strategy(ies)");
  });

  it("a strategy for an unsupported market is not counted", () => {
    const counted = poolBlocker([
      standing({
        specId: "stg_us",
        name: "sma_cross_20_50",
        origin: "UNSUPPORTED_MARKET",
        researchEligible: false,
        eligibilityReason: "declares market US",
      }),
    ]);
    expect(counted).toContain("0 strategy(ies)");
  });

  it("the classifier and the gate agree about the same spec", () => {
    // The composition that failed before: each side correct, neither consulting the other. A spec
    // the classifier calls ineligible must be one the gate declines to count.
    const verdict = classifySpec({
      name: "ledger_gap_screen_mspoa7oo_desktop_chromium",
      createdBy: "http-20124",
      market: "NSE",
    });
    expect(verdict.researchEligible).toBe(false);

    const counted = poolBlocker([
      standing({
        specId: "stg_same",
        name: "ledger_gap_screen_mspoa7oo_desktop_chromium",
        origin: verdict.origin,
        researchEligible: verdict.researchEligible,
        eligibilityReason: verdict.reason,
      }),
    ]);
    expect(counted).toContain("0 strategy(ies)");
  });
});

describe("INVARIANT: end to end, from real rows — fixtures never reach the pool", () => {
  /**
   * The stronger form of the same claim, and the one that closes this suite's own gap.
   *
   * The tests above construct `Standing` fixtures, so they prove the GATE respects a verdict. They
   * do not prove the verdict is derived from real persisted rows. This one starts where production
   * starts — actual `strategy_specs` — and runs the whole chain:
   *
   *   real spec rows -> classifySpec -> standings() -> evaluateTrialActivation -> pool count
   *
   * with nothing injected. That is the composition the 14-of-22 contamination lived in.
   */
  function seedRehearsedSpec(name: string, createdBy: string, market: string): string {
    const specId = recordStrategySpec({
      name,
      createdBy,
      dsl: {
        name,
        universe: { market, maxPositions: 4, resolution: "D" },
        entry: { feature: "close", op: "gt", value: 10 },
        exit: { afterDays: 5, stopLossPct: 4 },
        sizing: { maxPositionPct: 10 },
        // Priced at the DELIVERY schedule the training book pays (62 bps): a spec that declares
        // less is refused by the cost gate and would never reach the pool, which would make this
        // invariant pass for the wrong reason.
        costs: { commissionBps: 16, slippageBps: 16 },
      } as never,
    });
    // `would_pass` is what carries a draft to `rehearsed`, which is what puts it in the pool.
    getDb()
      .insert(schema.rehearsalOutcomes)
      .values({
        strategySpecId: specId,
        verdict: "would_pass",
        reason: "seeded for the invariant",
        trades: 100,
        instrumentsEvaluated: 20,
        rehearsedAt: new Date(),
        datasetSnapshotId: null,
      })
      .run();
    return specId;
  }

  it("counts the production spec and neither the fixture nor the unsupported market", () => {
    seedRehearsedSpec("qc_real_candidate", "claude-code:research", "NSE");
    seedRehearsedSpec("e2e_ledger_ui_mspoack3_desktop_chromium", "e2e", "NSE");
    seedRehearsedSpec("us_legacy_probe", "owner", "US");

    // Real classification over real rows — no fixture Standing anywhere in this path.
    const ladder = standings();
    expect(ladder.length, "all three specs must be visible in the ledger").toBe(3);
    expect(ladder.filter((s) => s.researchEligible).length).toBe(1);

    const pool = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION).blockers.find(
      (b) => b.startsWith("pool:"),
    );
    expect(pool, "only the production research spec may count toward a permanent trial").toContain(
      "1 strategy(ies)",
    );
  });
});
