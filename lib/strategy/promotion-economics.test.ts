import { describe, expect, it } from "vitest";
import { CostModelError } from "@/lib/paper/cost-model";
import { costVerdictOrBlocked } from "./promotion";

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
