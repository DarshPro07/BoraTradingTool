import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { consumeSeal, verifySealIntegrity, activeSealFor, type HoldoutSealRow } from "@/lib/research-data/holdout-seal";
import { snapshotWindow } from "@/lib/research-data/snapshot";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { StrategyDslSchema } from "./dsl";
import { recordHoldoutOutcome } from "./holdout";
import { currentStage } from "./promotion";
import { requestHoldoutAccess } from "./selection-ledger";
import { profitFactor } from "./statistics";

/**
 * The Holdout Evaluator — a deterministic capability, never a model.
 *
 * One controlled look at the sealed window, in this order, each gate refusing with a coded
 * reason BEFORE anything downstream happens:
 *
 *   seal exists → seal AUTHORIZED → sealed bars unchanged (fingerprint) → strategy at the rung a
 *   holdout judges (validated: rehearsed + gauntlet-passed, i.e. AFTER the DSR/PBO gates — the
 *   holdout never replaces robust validation) → development never saw the window
 *   (the qualifying gauntlet experiment must POSTDATE the seal, because pre-seal snapshots
 *   contained the window by construction) → the family/campaign budget permits
 *   (`requestHoldoutAccess` — the gates that make renaming worthless).
 *
 * Only then does the engine run — the SAME `runPortfolioBacktest`, the spec's own declared
 * costs, the sealed window's snapshot — and the verdict comes from the rule PINNED AT SEAL TIME,
 * never from a number chosen after seeing the result. Everything is persisted: the full
 * economics in `holdout_results`, the `sealed_holdout` trial for the ladder, and the seal's
 * transition to CONSUMED.
 *
 * Crash window honesty: the access grant is consumed before the engine runs, so a crash between
 * grant and result leaves "budget spent, no verdict" — which `holdoutStanding` already treats as
 * exhausted-and-buried rather than re-queryable. Conservative by design: the one thing this
 * apparatus must never do is look twice.
 */

export interface HoldoutEvaluation {
  ok: true;
  resultId: string;
  holdoutId: string;
  specId: string;
  familyId: string;
  passed: boolean;
  tradeCount: number;
  netProfitFactor: number;
  degradationRatio: number | null;
  reasonCodes: string[];
  detail: string;
}

export interface HoldoutEvaluationRefusal {
  ok: false;
  code:
    | "SPEC_NOT_FOUND"
    | "DSL_INVALID"
    | "NO_ACTIVE_SEAL"
    | "SEAL_NOT_AUTHORIZED"
    | "SEAL_INTEGRITY"
    | "WRONG_STAGE"
    | "CONTAMINATED_DEVELOPMENT"
    | "NO_IDENTITY"
    | "ACCESS_REFUSED"
    | "RESULT_EXISTS"
    | "WINDOW_SNAPSHOT_FAILED"
    | "ENGINE_FAILED";
  message: string;
}

export type HoldoutEvaluationResult = HoldoutEvaluation | HoldoutEvaluationRefusal;

function familyFor(specId: string): { familyId: string; campaignId: string } | null {
  const row = getDb()
    .select()
    .from(schema.strategyIdentity)
    .where(eq(schema.strategyIdentity.strategySpecId, specId))
    .get();
  if (!row) return null;
  return { familyId: row.strategyFamilyId, campaignId: row.researchCampaignId };
}

export async function evaluateHoldout(specId: string, actor: string, now = new Date()): Promise<HoldoutEvaluationResult> {
  const db = getDb();

  const spec = db.select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, specId)).get();
  if (!spec) return { ok: false, code: "SPEC_NOT_FOUND", message: `No strategy ${specId}.` };

  const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
  if (!parsed.success) {
    return { ok: false, code: "DSL_INVALID", message: "The stored specification no longer parses; it cannot be judged." };
  }
  const dsl = parsed.data;

  const seal = activeSealFor(dsl.universe.market, dsl.universe.resolution ?? "D");
  if (!seal) {
    return {
      ok: false,
      code: "NO_ACTIVE_SEAL",
      message:
        `No live sealed holdout covers ${dsl.universe.market}/${dsl.universe.resolution ?? "D"}. ` +
        "Seal a window first — evaluation without a sealed definition is exactly the improvised " +
        "holdout this apparatus exists to prevent.",
    };
  }
  if (seal.state !== "AUTHORIZED_FOR_EVALUATION") {
    return {
      ok: false,
      code: "SEAL_NOT_AUTHORIZED",
      message: `Seal ${seal.id} is ${seal.state}. Evaluation requires the owner's explicit authorization step.`,
    };
  }

  const integrity = await verifySealIntegrity(seal.id);
  if (!integrity.ok) return { ok: false, code: "SEAL_INTEGRITY", message: integrity.message };

  // The rung: a holdout judges a strategy that ALREADY survived rehearsal and the gauntlet's
  // DSR/PBO gates. Anything earlier has cheaper evidence to earn first.
  const { stage } = currentStage(spec.id, spec.dsl);
  if (stage !== "validated") {
    return {
      ok: false,
      code: "WRONG_STAGE",
      message: `${spec.name} is at ${stage}. The sealed holdout judges strategies at validated — after the gauntlet, never instead of it.`,
    };
  }

  // Contamination: development snapshots only began EXCLUDING the sealed region when the seal
  // was created, so a qualifying gauntlet experiment from before the seal was fitted on data
  // that included the window. Deterministic, no bar math: the experiment must postdate the seal.
  const gauntletExperiment = db
    .select()
    .from(schema.experiments)
    .where(and(eq(schema.experiments.strategySpecId, specId), eq(schema.experiments.kind, "gauntlet")))
    .orderBy(desc(schema.experiments.createdAt))
    .get();
  if (!gauntletExperiment || gauntletExperiment.createdAt.getTime() <= seal.sealedAt.getTime()) {
    return {
      ok: false,
      code: "CONTAMINATED_DEVELOPMENT",
      message: gauntletExperiment
        ? `${spec.name}'s qualifying gauntlet experiment (${gauntletExperiment.id}) predates seal ${seal.id} — ` +
          "its development saw the sealed window. Re-validate after the seal (a new governed trial) to become eligible."
        : `${spec.name} has no recorded gauntlet experiment; there is no qualifying evidence to compare a holdout against.`,
    };
  }

  const identity = familyFor(specId);
  if (!identity) {
    return {
      ok: false,
      code: "NO_IDENTITY",
      message: `${spec.name} has no research identity (family/campaign); a holdout read cannot be charged to anyone.`,
    };
  }

  const existing = db
    .select()
    .from(schema.holdoutResults)
    .where(
      and(eq(schema.holdoutResults.holdoutId, seal.id), eq(schema.holdoutResults.strategyFamilyId, identity.familyId)),
    )
    .get();
  if (existing) {
    return {
      ok: false,
      code: "RESULT_EXISTS",
      message: `Family ${identity.familyId} already holds result ${existing.id} for holdout ${seal.id}. There is no second look.`,
    };
  }

  // The family/campaign budget — consumed HERE, before the engine looks. A crash after this
  // point burns the budget with no verdict, which buries rather than re-queries (see header).
  const grant = requestHoldoutAccess({
    holdoutGenerationId: seal.id,
    specId,
    requestFingerprint: `${specId}:${actor}:${now.toISOString()}`,
    datasetSnapshotId: seal.datasetSnapshotId,
  });
  if (!grant.granted) {
    return { ok: false, code: "ACCESS_REFUSED", message: grant.reason };
  }

  const window = snapshotWindow(seal.market, seal.resolution, seal.startTime, seal.endTime, `holdout:${actor}`);
  if (!window.ok || window.fingerprint !== seal.fingerprint) {
    return {
      ok: false,
      code: "WINDOW_SNAPSHOT_FAILED",
      message: window.ok
        ? `Window fingerprint ${window.fingerprint} does not match the seal (${seal.fingerprint}).`
        : window.message,
    };
  }

  const run = runPortfolioBacktest(dsl, window.dataset, {
    datasetFingerprint: window.fingerprint,
    datasetSnapshotId: window.snapshotId,
  });
  if (!run.ok) {
    return {
      ok: false,
      code: "ENGINE_FAILED",
      message:
        `${run.code}: ${run.message} The access budget was already consumed; this family's holdout ` +
        "standing is now exhausted-without-verdict, which buries rather than re-queries.",
    };
  }

  return persistEvaluation(seal, spec.id, spec.name, identity.familyId, window.snapshotId, run.trades, actor, now);
}

function persistEvaluation(
  seal: HoldoutSealRow,
  specId: string,
  specName: string,
  familyId: string,
  snapshotId: string,
  trades: { grossReturn: number; netReturn: number }[],
  actor: string,
  now: Date,
): HoldoutEvaluationResult {
  const db = getDb();
  const returns = trades.map((trade) => trade.netReturn);
  const tradeCount = trades.length;
  const netPf = profitFactor(returns);
  const grossPnl = trades.reduce((sum, trade) => sum + trade.grossReturn, 0);
  const netPnl = returns.reduce((sum, value) => sum + value, 0);
  const fees = grossPnl - netPnl;
  const wins = returns.filter((value) => value > 0).length;
  const winRate = tradeCount > 0 ? wins / tradeCount : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const validation = db
    .select()
    .from(schema.validationResults)
    .where(eq(schema.validationResults.strategySpecId, specId))
    .orderBy(desc(schema.validationResults.evaluatedAt))
    .get();
  const validationOosPf = validation?.oosProfitFactor ?? null;
  const degradationRatio =
    validationOosPf !== null && Number.isFinite(validationOosPf) && validationOosPf > 0
      ? netPf / validationOosPf
      : null;

  // THE PINNED RULE — copied at seal time, applied verbatim. Nothing here reads current GATES.
  const rule = seal.decisionRule;
  const reasonCodes: string[] = [];
  reasonCodes.push(tradeCount >= rule.minTrades ? "TRADES_SUFFICIENT" : "TRADES_INSUFFICIENT");
  reasonCodes.push(netPf >= rule.minNetProfitFactor ? "NET_PF_MEETS_RULE" : "NET_PF_BELOW_RULE");
  const passed = tradeCount >= rule.minTrades && netPf >= rule.minNetProfitFactor;

  const detail =
    `${specName}: ${tradeCount} trade(s) on the sealed window, net PF ${netPf.toFixed(3)} vs pinned ` +
    `rule ≥ ${rule.minNetProfitFactor} with ≥ ${rule.minTrades} trades` +
    (degradationRatio !== null ? `; degradation vs validation OOS PF: ${(degradationRatio * 100).toFixed(0)}%` : "") +
    `. ${passed ? "PASS" : "FAIL"}.`;

  const resultId = `hr_${createHash("sha256")
    .update(`${seal.id}|${familyId}|${specId}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;

  db.insert(schema.holdoutResults)
    .values({
      id: resultId,
      holdoutId: seal.id,
      strategySpecId: specId,
      strategyFamilyId: familyId,
      datasetSnapshotId: snapshotId,
      fingerprint: seal.fingerprint,
      tradeCount,
      netProfitFactor: Number.isFinite(netPf) ? netPf : null,
      grossPnl,
      fees,
      netPnl,
      winRate,
      maxDrawdown,
      validationOosPf,
      degradationRatio,
      passed: passed ? 1 : 0,
      reasonCodes: JSON.stringify(reasonCodes),
      detail,
      evaluatedAt: now,
      evaluatedBy: actor,
    })
    .run();

  // The ladder's source of truth: the sealed_holdout trial, through the same per-spec budget
  // path everything else reads (`holdoutStanding`).
  recordHoldoutOutcome({
    holdoutId: seal.id,
    specId,
    actor,
    passed,
    reason: detail,
    metrics: { tradeCount, netProfitFactor: netPf, degradationRatio: degradationRatio ?? Number.NaN },
    resultHash: resultId,
  });

  consumeSeal(seal.id, `Evaluated ${specName} (${specId}) for family ${familyId}: ${passed ? "PASS" : "FAIL"}.`, now);

  return {
    ok: true,
    resultId,
    holdoutId: seal.id,
    specId,
    familyId,
    passed,
    tradeCount,
    netProfitFactor: netPf,
    degradationRatio,
    reasonCodes,
    detail,
  };
}
