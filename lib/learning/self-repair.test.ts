import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { OWNER_CAPITAL, TRAINING_CAPITAL } from "@/lib/paper/capital";
import { costStanding, requiredCostBps } from "@/lib/strategy/cost-gate";
import { runSelfRepair } from "./self-repair";

/**
 * Self-repair, and the line it must not cross.
 *
 * The useful half is obvious: a strategy declaring less cost than the published schedule charges
 * is wrong by arithmetic, and leaving it wrong means its backtest describes a market that does
 * not exist.
 *
 * The half that matters more is the refusal. A system that repairs whatever it judges to be wrong
 * can talk itself into rewriting anything, including the owner's own stated figures. The paper
 * account disagreeing with `OWNER_CAPITAL` is *equally* wrong and deliberately left alone, because
 * which number is current is a fact about the owner's intent that nothing here can read.
 */

useTemporaryDatabase();

const UNDERSTATED = {
  name: "sma_cross_cheap",
  universe: { market: "NSE", maxPositions: 4 },
  entry: { crossover: ["sma20", "sma50"] },
  exit: { afterDays: 10, stopLossPct: 5 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 1, slippageBps: 1 },
};

/** `recordStrategySpec` stringifies the DSL itself — handing it a string double-encodes it. */
function saveSpec(dsl: Record<string, unknown>, name: string): string {
  return recordStrategySpec({ name, dsl: dsl as never, createdBy: "test" });
}

/** Migrations seed an INR account, so tests set its balance rather than inserting a second one. */
function setPaperCapital(amount: number): void {
  getDb()
    .insert(schema.paperAccounts)
    .values({ currency: "INR", startingCash: amount, cash: amount, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.paperAccounts.currency,
      set: { startingCash: amount, cash: amount, updatedAt: new Date() },
    })
    .run();
}

describe("repairing what is provably wrong", () => {
  it("raises a declared cost that is below the published schedule", () => {
    saveSpec(UNDERSTATED, "sma_cross_cheap");
    const report = runSelfRepair();

    expect(report.repaired).toBeGreaterThanOrEqual(1);
    const spec = getDb().select().from(schema.strategySpecs).all()[0];
    expect(costStanding(spec.dsl).understated).toBe(false);
  });

  it("names both figures, so the change is checkable rather than asserted", () => {
    saveSpec(UNDERSTATED, "sma_cross_cheap");
    const repair = runSelfRepair().repairs.find((item) => item.defect === "cost_understated");
    expect(repair?.detail).toContain(String(requiredCostBps()));
  });

  it("records the repair as a governed action", () => {
    // A write the owner did not ask for must be answerable with what, when and why. An unlogged
    // self-repair is indistinguishable from a bug.
    saveSpec(UNDERSTATED, "sma_cross_cheap");
    runSelfRepair();

    const events = getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "self_repair"))
      .all();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("leaves an already-honest strategy alone", () => {
    const honest = { ...UNDERSTATED, costs: { commissionBps: 60, slippageBps: 7 } };
    saveSpec(honest, "sma_cross_honest");
    const before = getDb().select().from(schema.strategySpecs).all()[0].dsl;

    runSelfRepair();

    expect(getDb().select().from(schema.strategySpecs).all()[0].dsl).toBe(before);
  });

  it("does not delete the validation rows the repair invalidates", () => {
    // Evidence destroyed on a schedule cannot be reviewed before it goes. The stale rows are
    // reported for the owner to clear, not removed by a background loop.
    const id = saveSpec(UNDERSTATED, "sma_cross_cheap");
    getDb()
      .insert(schema.validationResults)
      .values({
        id: "val_test_1",
        strategySpecId: id,
        passed: 1,
        trialsCounted: 1,
        evaluatedAt: new Date(),
      })
      .run();

    runSelfRepair();

    expect(getDb().select().from(schema.validationResults).all()).toHaveLength(1);
  });
});

describe("refusing to repair the owner's judgement", () => {
  it("reports a paper account that disagrees with the stated capital, and does not rewrite it", () => {
    // The severe, silent one: results from an account ten thousand times too large describe a
    // regime where costs round to nothing — the one regime this owner is not in.
    const wrong = OWNER_CAPITAL.amount * 10_000;
    setPaperCapital(wrong);

    const report = runSelfRepair();
    const drift = report.repairs.find((item) => item.defect === "capital_drift");

    expect(drift?.outcome).toBe("reported");
    const account = getDb()
      .select()
      .from(schema.paperAccounts)
      .where(eq(schema.paperAccounts.currency, "INR"))
      .get();
    expect(account?.startingCash).toBe(wrong);
  });

  it("says nothing when the book holds the training basis, not the owner's real capital", () => {
    // The owner trains at 25,000 of paper and keeps the real 5,000 out of the machine, so the
    // book agreeing with TRAINING_CAPITAL is the intended state -- and agreeing with
    // OWNER_CAPITAL is not.
    setPaperCapital(TRAINING_CAPITAL.amount);
    expect(runSelfRepair().repairs.some((item) => item.defect === "capital_drift")).toBe(false);

    setPaperCapital(OWNER_CAPITAL.amount);
    expect(runSelfRepair().repairs.some((item) => item.defect === "capital_drift")).toBe(true);
  });
});

describe("a clean system", () => {
  it("reports finding nothing rather than inventing work", () => {
    // Aligned first: migrations seed an INR account whose balance is not the training basis, so a
    // fresh database legitimately has one thing to report. "Clean" has to be arranged.
    setPaperCapital(TRAINING_CAPITAL.amount);

    const report = runSelfRepair();
    expect(report.repairs).toHaveLength(0);
    expect(report.summary).toMatch(/nothing/i);
  });
});
