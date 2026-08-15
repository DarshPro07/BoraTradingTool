import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import type { Standing } from "@/lib/strategy/promotion";
import { quantScoreboard, SCOREBOARD_QUESTION } from "./quant-scoreboard";

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
  return { specId, name: specId, stage, advance: { kind: "hold", reason: "test" } as never, blockedOn: null };
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
