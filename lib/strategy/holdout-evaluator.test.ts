import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { authorizeSeal, createSeal, type HoldoutDecisionRule } from "@/lib/research-data/holdout-seal";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema } from "./dsl";
import { evaluateHoldout } from "./holdout-evaluator";
import { currentStage } from "./promotion";

/**
 * The evaluator's gate ORDER is the contract: authorization before integrity before stage before
 * contamination before budget before engine — and the verdict comes from the rule pinned at seal
 * time. The happy path proves the full persistence set (result row, sealed_holdout trial, seal
 * CONSUMED, ladder movement); the refusal paths prove nothing downstream fires early.
 */

useTemporaryDatabase();

const RULE: HoldoutDecisionRule = { minNetProfitFactor: 1.1, minTrades: 30 };
const OPEN_UTC = Date.UTC(2025, 0, 6, 3, 45, 0) / 1000;

function seedDaily(ticker: string, days = 400): void {
  const db = getDb();
  for (let index = 0; index < days; index += 1) {
    db.insert(schema.priceCandles)
      .values({
        ticker,
        resolution: "D",
        time: OPEN_UTC + index * 86_400,
        open: 100,
        high: 103,
        low: 97,
        close: 100 + Math.sin(index / 7) * 4,
        volume: 1_000,
      })
      .run();
  }
}

const DSL = StrategyDslSchema.parse({
  name: "holdout_probe",
  universe: { market: "NSE", maxPositions: 4, resolution: "D" },
  entry: { feature: "close", op: "gt", value: 0 },
  exit: { afterDays: 3, stopLossPct: 5 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 5, slippageBps: 7 },
});

/** A validated-stage spec with identity and a POST-SEAL gauntlet experiment. */
function seedValidatedSpec(name: string, gauntletAt: Date): string {
  const db = getDb();
  const specId = recordStrategySpec({ name, dsl: { ...DSL, name }, createdBy: "test" });
  const now = new Date();

  db.insert(schema.researchCampaigns)
    .values({ id: "rc_test", name: "test campaign", question: "?", createdAt: now, createdBy: "test" })
    .onConflictDoNothing()
    .run();
  db.insert(schema.strategyFamilies)
    .values({
      id: `fam_${name}`,
      researchCampaignId: "rc_test",
      name: `family ${name}`,
      economicHypothesis: "test",
      mechanism: "test",
      declarationHash: name,
      createdAt: now,
      createdBy: "test",
    })
    .run();
  db.insert(schema.strategyIdentity)
    .values({
      strategySpecId: specId,
      researchCampaignId: "rc_test",
      strategyFamilyId: `fam_${name}`,
      semanticFingerprint: name,
      validationEligible: 1,
      classifiedBy: "test",
      classifiedAt: now,
      classification: "NEW_FAMILY",
    })
    .run();
  db.insert(schema.rehearsalOutcomes)
    .values({
      strategySpecId: specId,
      verdict: "would_pass",
      reason: "seeded",
      trades: 40,
      instrumentsEvaluated: 4,
      rehearsedAt: now,
    })
    .run();
  db.insert(schema.validationResults)
    .values({
      id: `vr_${specId}`,
      strategySpecId: specId,
      oosProfitFactor: 1.5,
      pbo: 0.2,
      deflatedSharpe: 1.2,
      costMultiplePf: 1.1,
      trialsCounted: 1,
      passed: 1,
      evaluatedAt: now,
    })
    .run();
  db.insert(schema.experiments)
    .values({
      id: `exp_g_${name}`,
      strategySpecId: specId,
      datasetSnapshotId: "dss_dev",
      kind: "gauntlet",
      engineVersion: "test",
      executionProfileId: null,
      tradeCount: 40,
      summary: "seeded gauntlet experiment",
      createdAt: gauntletAt,
      createdBy: "test",
    })
    .run();
  return specId;
}

function seedDevSnapshot(): void {
  getDb()
    .insert(schema.datasetSnapshots)
    .values({
      id: "dss_dev",
      market: "NSE",
      resolution: "D",
      instruments: "[]",
      firstTime: 0,
      lastTime: 0,
      barCount: 0,
      fingerprint: "fp_dev",
      sourceLineage: "test",
      normalizationVersion: "test",
      createdAt: new Date(),
      createdBy: "test",
    })
    .onConflictDoNothing()
    .run();
}

describe("the evaluator's gates, in order", () => {
  it("evaluates once, persists everything, consumes the seal, moves the ladder — and never twice", async () => {
    seedDaily("IN:XNSE:HEVALA");
    seedDaily("IN:XNSE:HEVALB");
    seedDevSnapshot();

    const sealed = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    // Gauntlet experiment POSTDATES the seal — clean development.
    const specId = seedValidatedSpec("holdout_probe", new Date(Date.now() + 1_000));

    // Before authorization: refused, nothing downstream.
    const early = await evaluateHoldout(specId, "test");
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("SEAL_NOT_AUTHORIZED");

    authorizeSeal(sealed.seal.id, "owner:test");
    const outcome = await evaluateHoldout(specId, "test");
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (!outcome.ok) return;

    // The pinned rule decided — consistency, not direction.
    expect(outcome.passed).toBe(outcome.tradeCount >= RULE.minTrades && outcome.netProfitFactor >= RULE.minNetProfitFactor);
    expect(outcome.degradationRatio).not.toBeNull();

    const db = getDb();
    const result = db.select().from(schema.holdoutResults).where(eq(schema.holdoutResults.id, outcome.resultId)).get();
    expect(result).toBeDefined();
    expect(result!.passed).toBe(outcome.passed ? 1 : 0);
    expect(JSON.parse(result!.reasonCodes) as string[]).toContain(
      outcome.tradeCount >= RULE.minTrades ? "TRADES_SUFFICIENT" : "TRADES_INSUFFICIENT",
    );

    const trial = db
      .select()
      .from(schema.trials)
      .where(eq(schema.trials.strategySpecId, specId))
      .all()
      .find((row) => row.kind === "sealed_holdout");
    expect(trial, "the ladder's sealed_holdout trial must exist").toBeDefined();

    const seal = db.select().from(schema.holdoutDefinitions).where(eq(schema.holdoutDefinitions.id, sealed.seal.id)).get();
    expect(seal?.state).toBe("CONSUMED");

    // The ladder read the verdict: a PASS moves validated → holdout_cleared; a FAIL buries.
    const { stage } = currentStage(specId, JSON.stringify({ ...DSL, name: "holdout_probe" }));
    expect(outcome.passed ? stage === "holdout_cleared" || stage === "paper_forward" : stage === "graveyard").toBe(true);

    // No second look for the family — refused before any engine work, with the seal consumed.
    const again = await evaluateHoldout(specId, "test");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(["RESULT_EXISTS", "NO_ACTIVE_SEAL", "SEAL_NOT_AUTHORIZED"]).toContain(again.code);
  });

  it("a pre-seal gauntlet experiment is refused as contaminated development", async () => {
    seedDaily("IN:XNSE:HCONTA");
    seedDevSnapshot();
    const sealed = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    authorizeSeal(sealed.seal.id, "owner:test");

    // Gauntlet experiment BEFORE the seal — its development saw the window.
    const specId = seedValidatedSpec("contaminated_probe", new Date(Date.now() - 3_600_000));

    const outcome = await evaluateHoldout(specId, "test");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("CONTAMINATED_DEVELOPMENT");
      expect(outcome.message).toMatch(/Re-validate after the seal/);
    }
    // Nothing was consumed by the refusal.
    const seal = getDb()
      .select()
      .from(schema.holdoutDefinitions)
      .where(eq(schema.holdoutDefinitions.id, sealed.seal.id))
      .get();
    expect(seal?.state).toBe("AUTHORIZED_FOR_EVALUATION");
    expect(getDb().select().from(schema.holdoutResults).all().length).toBe(0);
  });
});
