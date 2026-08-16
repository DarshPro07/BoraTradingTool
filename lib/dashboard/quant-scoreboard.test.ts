import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import type { Standing } from "@/lib/strategy/promotion";
import { familyComparison, quantScoreboard, rejectionDiagnosis, SCOREBOARD_QUESTION } from "./quant-scoreboard";

/**
 * The scoreboard is COUNTING, not semantics — rows are seeded directly into the ledger tables it
 * reads (the flows that write them are pinned by their own suites, and the FK chain
 * campaign → family → spec is honoured so the seeds are structurally real), and the ladder rungs
 * use the injectable standings seam (`costVerdictOrBlocked` precedent) so the rung arithmetic is
 * testable without authoring a full strategy. The live wiring is covered by the /brain e2e.
 */

const NOW = new Date("2026-08-15T10:00:00Z");
const EPOCH = Math.floor(NOW.getTime() / 1000);

function standing(specId: string, stage: Standing["stage"]): Standing {
  return {
    specId,
    name: specId,
    stage,
    advance: { kind: "hold", reason: "test" } as never,
    blockedOn: null,
    origin: "PRODUCTION_RESEARCH",
    researchEligible: true,
    eligibilityReason: "test fixture",
  };
}

/** Campaign → family → spec, FK-complete, so ledger rows can hang off something real. */
function seedChain(suffix: string): { campaignId: string; familyId: string; specId: string } {
  const db = getDb();
  const campaignId = `rc_${suffix}`;
  const familyId = `sf_${suffix}`;
  const specId = `spec_${suffix}`;
  db.insert(schema.researchCampaigns)
    .values({ id: campaignId, name: `campaign-${suffix}`, question: "does it survive costs?", createdAt: NOW, createdBy: "test" })
    .run();
  db.insert(schema.strategyFamilies)
    .values({ id: familyId, researchCampaignId: campaignId, name: `family-${suffix}`, economicHypothesis: "auction imbalance", mechanism: "range expansion", declarationHash: `dh_${suffix}`, createdAt: NOW, createdBy: "test" })
    .run();
  db.insert(schema.strategySpecs)
    .values({ id: specId, name: `spec-${suffix}`, dsl: "{}", dslHash: `h_${suffix}`, createdBy: "test", createdAt: NOW })
    .run();
  return { campaignId, familyId, specId };
}

describe("the quant scoreboard", () => {
  useTemporaryDatabase();

  it("renders an empty database as zeros with stated bases — ratios over nothing are null, not 0", () => {
    const board = quantScoreboard({ standings: () => [] });
    expect(board.question).toBe(SCOREBOARD_QUESTION);
    expect(board.campaigns).toEqual({ total: 0, open: 0 });
    expect(board.trialsSpent).toBe(0);
    expect(board.funnel).toHaveLength(12);
    expect(board.funnel.every((stage) => stage.count === 0)).toBe(true);
    expect(board.funnel.every((stage) => stage.basis.length > 0)).toBe(true);
    expect(board.gauntletRejections).toEqual([]);
    expect(board.survivors).toEqual([]);
    expect(board.paper.netExpectancyPerTrade, "no positions is null, never a fake break-even 0").toBeNull();
    expect(board.paper.costShareOfGross).toBeNull();
  });

  it("groups gauntlet rejections by typed stage kind, most frequent first", () => {
    const db = getDb();
    const { specId } = seedChain("rej");
    for (let i = 0; i < 3; i += 1) {
      db.insert(schema.trials)
        .values({ strategySpecId: specId, kind: "cost_stress", verdict: "fail", reason: "PF at 2x costs", actor: "validation", startedAt: NOW })
        .run();
    }
    db.insert(schema.trials)
      .values({ strategySpecId: specId, kind: "parameter_stability", verdict: "fail", reason: "DSR below gate", actor: "validation", startedAt: NOW })
      .run();
    db.insert(schema.trials)
      .values({ strategySpecId: specId, kind: "walk_forward", verdict: "pass", reason: "fine", actor: "validation", startedAt: NOW })
      .run();

    const board = quantScoreboard({ standings: () => [] });
    expect(board.gauntletRejections).toEqual([
      { kind: "cost_stress", count: 3 },
      { kind: "parameter_stability", count: 1 },
    ]);
  });

  it("counts ladder rungs at-or-beyond from standings, and the graveyard separately", () => {
    const ladder = [
      standing("s1", "draft"),
      standing("s2", "rehearsed"),
      standing("s3", "validated"),
      standing("s4", "holdout_cleared"),
      standing("s5", "paper_forward"),
      standing("s6", "owner_review"),
      standing("s7", "graveyard"),
    ];
    const board = quantScoreboard({ standings: () => ladder });
    const byKey = new Map(board.funnel.map((stage) => [stage.key, stage.count]));
    expect(byKey.get("rehearsed")).toBe(5);
    expect(byKey.get("validated")).toBe(4);
    expect(byKey.get("holdout")).toBe(3);
    expect(byKey.get("net_positive")).toBe(1);
    expect(board.graveyardCount).toBe(1);
  });

  it("lists only latest-validation survivors with their DSR/PBO, and does the paper NET arithmetic", () => {
    const db = getDb();
    const win = seedChain("win");
    const lose = seedChain("lose");
    // An older FAILED validation for the same spec — superseded, must not hide the survivor.
    db.insert(schema.validationResults)
      .values({ id: "v0", strategySpecId: win.specId, passed: 0, trialsCounted: 3, evaluatedAt: new Date(NOW.getTime() - 60_000) })
      .run();
    db.insert(schema.validationResults)
      .values({ id: "v1", strategySpecId: win.specId, passed: 1, deflatedSharpe: 1.12, pbo: 0.18, oosProfitFactor: 1.4, costMultiplePf: 1.1, trialsCounted: 7, evaluatedAt: NOW })
      .run();
    // A spec whose LATEST validation failed — not a survivor.
    db.insert(schema.validationResults)
      .values({ id: "v2", strategySpecId: lose.specId, passed: 0, trialsCounted: 4, evaluatedAt: NOW })
      .run();

    db.insert(schema.forwardChallengers)
      .values({
        id: "c1",
        strategySpecId: win.specId,
        strategyFamilyId: win.familyId,
        researchCampaignId: win.campaignId,
        activatedAt: NOW,
        codeFingerprint: "cf",
        engineVersion: "1",
        feeModelId: "fees-v1",
        market: "NSE",
        resolution: "5m",
        universe: "IN:XNSE:TCS",
        dslHash: "h_win",
        forwardPolicy: "shadow",
        forwardPolicyVersion: "1",
        status: "ACTIVE",
        createdBy: "test",
      })
      .run();
    // The paper ledger enforces its provenance chain: outcome → intent → signal → challenger.
    db.insert(schema.forwardSignals)
      .values([
        { id: "sig_i1", challengerId: "c1", instrumentId: "IN:XNSE:TCS", eventTime: EPOCH, observedAt: EPOCH, clauseEvidence: "{}", featureValues: "{}", entryPrice: 100, horizonBars: 10, costModelId: "fees-v1", dataQuality: "OK", fingerprint: "sg1" },
        { id: "sig_i2", challengerId: "c1", instrumentId: "IN:XNSE:TCS", eventTime: EPOCH + 60, observedAt: EPOCH + 60, clauseEvidence: "{}", featureValues: "{}", entryPrice: 100, horizonBars: 10, costModelId: "fees-v1", dataQuality: "OK", fingerprint: "sg2" },
      ])
      .run();
    const intent = (id: string) => ({
      id,
      signalId: `sig_${id}`,
      challengerId: "c1",
      instrumentId: "IN:XNSE:TCS",
      decisionTime: EPOCH,
      side: "BUY",
      desiredQuantity: 5,
      orderType: "MARKET",
      expectedPrice: 100,
      capitalBefore: 1000,
      riskBudget: 50,
      feeModelId: "fees-v1",
      decision: "EXECUTE",
      fingerprint: `fp_${id}`,
    });
    db.insert(schema.executionIntents).values([intent("i1"), intent("i2")]).run();
    db.insert(schema.paperPositionOutcomes)
      .values([
        { intentId: "i1", challengerId: "c1", instrumentId: "IN:XNSE:TCS", entryTime: EPOCH, entryPrice: 100, quantity: 5, exitTime: EPOCH + 60, exitPrice: 104, exitReason: "target", grossPnl: 20, fees: 6, netPnl: 14, capitalAfter: 1014, fingerprint: "f1" },
        { intentId: "i2", challengerId: "c1", instrumentId: "IN:XNSE:TCS", entryTime: EPOCH, entryPrice: 100, quantity: 5, exitTime: EPOCH + 120, exitPrice: 99, exitReason: "stop", grossPnl: -5, fees: 5, netPnl: -10, capitalAfter: 1004, fingerprint: "f2" },
      ])
      .run();

    const board = quantScoreboard({ standings: () => [] });
    expect(board.survivors).toHaveLength(1);
    expect(board.survivors[0]).toMatchObject({ specId: win.specId, name: "spec-win", deflatedSharpe: 1.12, pbo: 0.18 });
    expect(board.paper.closedPositions).toBe(2);
    expect(board.paper.grossPnl).toBe(15);
    expect(board.paper.fees).toBe(11);
    expect(board.paper.netPnl).toBe(4);
    expect(board.paper.netExpectancyPerTrade).toBe(2);
    expect(board.paper.costShareOfGross).toBeCloseTo(11 / 15, 10);
    // The forward-enrolled funnel rung counts the challenger just registered.
    expect(board.funnel.find((stage) => stage.key === "forward_enrolled")?.count).toBe(1);
  });

  it("family comparison: joins trials, gauntlet, holdout, forward, paper NET and max DD per family", () => {
    const db = getDb();
    const a = seedChain("fa");
    const b = seedChain("fb");

    // Family A: 3 selection trials, its spec's LATEST validation passed, a failed one before it.
    db.insert(schema.selectionTrials)
      .values([
        { id: "sta1", researchCampaignId: a.campaignId, strategyFamilyId: a.familyId, strategySpecId: a.specId, configurationFingerprint: "c1", startedAt: NOW },
        { id: "sta2", researchCampaignId: a.campaignId, strategyFamilyId: a.familyId, strategySpecId: a.specId, configurationFingerprint: "c2", startedAt: NOW },
        { id: "sta3", researchCampaignId: a.campaignId, strategyFamilyId: a.familyId, strategySpecId: a.specId, configurationFingerprint: "c3", startedAt: NOW },
      ])
      .run();
    db.insert(schema.strategyIdentity)
      .values([
        { strategySpecId: a.specId, researchCampaignId: a.campaignId, strategyFamilyId: a.familyId, semanticFingerprint: "sf_a", validationEligible: 1, classifiedBy: "test", classifiedAt: NOW, classification: "declared" },
        { strategySpecId: b.specId, researchCampaignId: b.campaignId, strategyFamilyId: b.familyId, semanticFingerprint: "sf_b", validationEligible: 1, classifiedBy: "test", classifiedAt: NOW, classification: "declared" },
      ])
      .run();
    db.insert(schema.validationResults)
      .values([
        { id: "fva0", strategySpecId: a.specId, passed: 0, trialsCounted: 1, evaluatedAt: new Date(NOW.getTime() - 60_000) },
        { id: "fva1", strategySpecId: a.specId, passed: 1, deflatedSharpe: 1.05, trialsCounted: 3, evaluatedAt: NOW },
        { id: "fvb1", strategySpecId: b.specId, passed: 0, trialsCounted: 1, evaluatedAt: NOW },
      ])
      .run();
    // Family A: one passed holdout evaluation carrying the family's worst drawdown.
    db.insert(schema.holdoutResults)
      .values([
        { id: "fh1", holdoutId: "hd1", strategySpecId: a.specId, strategyFamilyId: a.familyId, datasetSnapshotId: "ds1", fingerprint: "f1", tradeCount: 30, maxDrawdown: 0.07, passed: 1, reasonCodes: "[]", evaluatedAt: NOW, evaluatedBy: "test" },
        { id: "fh2", holdoutId: "hd2", strategySpecId: a.specId, strategyFamilyId: a.familyId, datasetSnapshotId: "ds2", fingerprint: "f2", tradeCount: 28, maxDrawdown: 0.11, passed: 0, reasonCodes: '["holdout_degradation"]', evaluatedAt: NOW, evaluatedBy: "test" },
      ])
      .run();
    // Family A: a challenger with one resolved forward signal and one closed paper position.
    db.insert(schema.forwardChallengers)
      .values({ id: "fc_a", strategySpecId: a.specId, strategyFamilyId: a.familyId, researchCampaignId: a.campaignId, activatedAt: NOW, codeFingerprint: "cf", engineVersion: "1", feeModelId: "fees-v1", market: "NSE", resolution: "5m", universe: "IN:XNSE:TCS", dslHash: "h_fa", forwardPolicy: "shadow", forwardPolicyVersion: "1", status: "ACTIVE", createdBy: "test" })
      .run();
    db.insert(schema.forwardSignals)
      .values([
        { id: "fs_1", challengerId: "fc_a", instrumentId: "IN:XNSE:TCS", eventTime: EPOCH, observedAt: EPOCH, clauseEvidence: "{}", featureValues: "{}", entryPrice: 100, horizonBars: 10, costModelId: "fees-v1", dataQuality: "OK", fingerprint: "s1" },
        { id: "fs_2", challengerId: "fc_a", instrumentId: "IN:XNSE:TCS", eventTime: EPOCH + 60, observedAt: EPOCH + 60, clauseEvidence: "{}", featureValues: "{}", entryPrice: 101, horizonBars: 10, costModelId: "fees-v1", dataQuality: "OK", fingerprint: "s2" },
      ])
      .run();
    db.insert(schema.forwardSignalOutcomes)
      .values({ signalId: "fs_1", resolvedAt: EPOCH + 600, entryFill: 100.1, exitPrice: 101.2, exitTime: EPOCH + 600, exitReason: "horizon", grossReturn: 0.011, fingerprint: "o1" })
      .run();
    db.insert(schema.executionIntents)
      .values({ id: "fi_1", signalId: "fs_2", challengerId: "fc_a", instrumentId: "IN:XNSE:TCS", decisionTime: EPOCH, side: "BUY", desiredQuantity: 5, orderType: "MARKET", expectedPrice: 100, capitalBefore: 1000, riskBudget: 50, feeModelId: "fees-v1", decision: "EXECUTE", fingerprint: "fpi1" })
      .run();
    db.insert(schema.paperPositionOutcomes)
      .values({ intentId: "fi_1", challengerId: "fc_a", instrumentId: "IN:XNSE:TCS", entryTime: EPOCH, entryPrice: 100, quantity: 5, exitTime: EPOCH + 300, exitPrice: 103, exitReason: "target", grossPnl: 15, fees: 4, netPnl: 11, capitalAfter: 1011, fingerprint: "fpo1" })
      .run();

    const rows = familyComparison({
      standings: () => [
        { specId: a.specId, name: "spec-fa", stage: "rehearsed", advance: { kind: "hold", reason: "t" } as never, blockedOn: "gauntlet", origin: "PRODUCTION_RESEARCH", researchEligible: true, eligibilityReason: "test fixture" },
        { specId: b.specId, name: "spec-fb", stage: "draft", advance: { kind: "hold", reason: "t" } as never, blockedOn: "rehearsal", origin: "PRODUCTION_RESEARCH", researchEligible: true, eligibilityReason: "test fixture" },
      ],
    });
    const rowA = rows.find((row) => row.familyId === a.familyId)!;
    const rowB = rows.find((row) => row.familyId === b.familyId)!;
    expect(rowA).toMatchObject({
      trials: 3,
      gauntletPass: 1,
      holdoutPass: 1,
      forwardResolved: 1,
      paperNet: 11,
      maxDrawdown: 0.11,
      campaignName: "campaign-fa",
      // The candidate pool: what AUTO prepared without spending — and what is worth budget.
      candidates: 1,
      rehearsed: 1,
      readyForGauntlet: 1,
    });
    expect(rowB).toMatchObject({ candidates: 1, rehearsed: 0, readyForGauntlet: 0 });
    expect(rowB).toMatchObject({ trials: 0, gauntletPass: 0, holdoutPass: 0, forwardResolved: 0 });
    expect(rowB.paperNet, "a family that never paper-traded shows —, not 0").toBeNull();
    expect(rowB.maxDrawdown).toBeNull();
    // Sorted: the family with a gauntlet pass leads.
    expect(rows.indexOf(rowA)).toBeLessThan(rows.indexOf(rowB));
  });

  it("diagnoses the rejection distribution with the owner's thresholds — and stays silent under 5 failures", () => {
    const db = getDb();
    const { specId } = seedChain("diag");
    expect(rejectionDiagnosis()).toEqual([]);

    // 4 of 5 failed trials are cost_stress (80%) → weak family economics.
    const fail = (kind: string, i: number) => ({ strategySpecId: specId, kind, verdict: "fail", reason: `${kind} ${i}`, actor: "validation", startedAt: NOW });
    db.insert(schema.trials)
      .values([fail("cost_stress", 1), fail("cost_stress", 2), fail("cost_stress", 3), fail("cost_stress", 4), fail("walk_forward", 5)])
      .run();
    // Two validations above the PBO gate → search too flexible.
    db.insert(schema.validationResults)
      .values([
        { id: "dgv1", strategySpecId: specId, passed: 0, pbo: 0.62, trialsCounted: 2, evaluatedAt: NOW },
        { id: "dgv2", strategySpecId: specId, passed: 0, pbo: 0.71, trialsCounted: 3, evaluatedAt: NOW },
      ])
      .run();
    // One failed family-level holdout → development overfit.
    db.insert(schema.holdoutResults)
      .values({ id: "dgh1", holdoutId: "hd9", strategySpecId: specId, strategyFamilyId: "sf_diag", datasetSnapshotId: "ds9", fingerprint: "f9", tradeCount: 25, passed: 0, reasonCodes: '["holdout_degradation"]', evaluatedAt: NOW, evaluatedBy: "test" })
      .run();

    const diagnoses = rejectionDiagnosis();
    const signals = diagnoses.map((diagnosis) => diagnosis.signal);
    expect(signals).toContain("cost-negative dominant");
    expect(signals).toContain("PBO repeatedly high");
    expect(signals).toContain("holdout degradation");
    expect(signals, "70% parameter-instability threshold not met — must not fire").not.toContain("parameter-instability dominant");
    for (const diagnosis of diagnoses) {
      expect(diagnosis.evidence.length).toBeGreaterThan(10);
      expect(diagnosis.reading.length).toBeGreaterThan(10);
    }
    // The rule the readings must carry: analysis, never survivor-optimization.
    expect(diagnoses.find((diagnosis) => diagnosis.signal === "PBO repeatedly high")?.reading).toMatch(/never widen/i);
  });

  it("counts the DSR denominator from the selection-trial ledger and campaigns open/closed", () => {
    const db = getDb();
    const chain = seedChain("dsr");
    db.insert(schema.researchCampaigns)
      .values({ id: "rc_closed", name: "swing-momo", question: "cross-sectional momo?", createdAt: NOW, createdBy: "test", closedAt: NOW })
      .run();
    db.insert(schema.selectionTrials)
      .values([
        { id: "st1", researchCampaignId: chain.campaignId, strategyFamilyId: chain.familyId, strategySpecId: chain.specId, configurationFingerprint: "cf1", startedAt: NOW },
        { id: "st2", researchCampaignId: chain.campaignId, strategyFamilyId: chain.familyId, strategySpecId: chain.specId, configurationFingerprint: "cf2", startedAt: NOW },
      ])
      .run();

    const board = quantScoreboard({ standings: () => [] });
    expect(board.campaigns).toEqual({ total: 2, open: 1 });
    expect(board.families).toBe(1);
    expect(board.trialsSpent).toBe(2);
  });
});
