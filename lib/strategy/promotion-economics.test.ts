import { describe, expect, it } from "vitest";
import { CostModelError } from "@/lib/paper/cost-model";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema } from "./dsl";
import { costVerdictOrBlocked, promotionPass } from "./promotion";

/**
 * Owner test 10 (13b): "Missing fee model prevents promotion."
 *
 * The inspector may abstain per-trade for DISPLAY; a promotion decision may not proceed on
 * unpriceable evidence. When the fee engine cannot price the market at all, the cost rung reports
 * understated=true with the block stated — and understated is the one direction the ladder never
 * forgives, so the strategy cannot climb.
 */

describe("promotion fails closed when realistic economics cannot be computed", () => {
  it("converts a fee-engine refusal into a stated promotion block", () => {
    const verdict = costVerdictOrBlocked("{}", () => {
      throw new CostModelError(
        "NO_SCHEDULE_IN_FORCE",
        "No US fee schedule covers US_EXCHANGE_ONLY on 2023-10-25.",
      );
    });
    expect(verdict.understated).toBe(true);
    expect(verdict.reason).toMatch(/Promotion is blocked/);
    expect(verdict.reason).toMatch(/No US fee schedule covers/);
  });

  it("does not swallow non-fee errors", () => {
    expect(() =>
      costVerdictOrBlocked("{}", () => {
        throw new Error("database on fire");
      }),
    ).toThrow(/database on fire/);
  });

  it("passes a working standing through untouched", () => {
    const verdict = costVerdictOrBlocked("{}", () => ({
      declaredBps: 30,
      requiredBps: 25,
      understated: false,
      reason: "fine",
    }));
    expect(verdict.understated).toBe(false);
  });
});

/**
 * The promotion pass NAMES the next action for gauntlet survivors.
 *
 * A `validated` strategy used to stall silently: the ladder held it (holdout apparatus absent),
 * the forward machinery waited for a manual route nobody was told about, and the cycle said
 * nothing. `forwardEnrollable` is the stated path — reported by the pass, rendered into cycle
 * actions, satisfiable through the durable `forward_enroll` kind.
 */
describe("gauntlet survivors carry a named next action", () => {
  useTemporaryDatabase();

  it("promotionPass lists a validated-stage strategy as forward-enrollable", async () => {
    const dsl = StrategyDslSchema.parse({
      name: "enrollable_probe",
      universe: { market: "NSE", maxPositions: 4, resolution: "D" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { afterDays: 5, stopLossPct: 2 },
      sizing: { maxPositionPct: 25 },
      costs: { commissionBps: 5, slippageBps: 7 },
    });
    const specId = recordStrategySpec({ name: dsl.name, dsl, createdBy: "test" });
    const db = getDb();
    db.insert(schema.rehearsalOutcomes)
      .values({
        strategySpecId: specId,
        verdict: "would_pass",
        reason: "seeded",
        trades: 40,
        instrumentsEvaluated: 6,
        rehearsedAt: new Date(),
      })
      .run();
    db.insert(schema.validationResults)
      .values({
        id: `vr_${specId}`,
        strategySpecId: specId,
        oosProfitFactor: 1.4,
        pbo: 0.2,
        deflatedSharpe: 1.1,
        costMultiplePf: 1.2,
        trialsCounted: 1,
        passed: 1,
        evaluatedAt: new Date(),
      })
      .run();

    const pass = promotionPass();
    const enrollable = pass.forwardEnrollable.find((entry) => entry.specId === specId);
    expect(enrollable, "a validated strategy must be named as forward-enrollable").toBeDefined();
  });
});
