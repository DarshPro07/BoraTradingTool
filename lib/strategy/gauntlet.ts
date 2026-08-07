import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordFailure, recordTrial, setSpecStatus } from "@/lib/knowledge/repository";
import type { TrialKind, TrialVerdict } from "@/lib/knowledge/types";
import { roundTripCostBps, type StrategyDsl } from "./dsl";
import {
  deflatedSharpeRatio,
  mean,
  monteCarlo,
  pairedBootstrapEdge,
  probabilityOfBacktestOverfitting,
  profitFactor,
  sharpeRatio,
} from "./statistics";

/** How many times a locked holdout may ever be queried for one strategy. */
export const HOLDOUT_QUERY_BUDGET = 1;

export interface GauntletEvidence {
  /** Per-trade returns from in-sample replay, net of modelled costs. */
  inSampleReturns: number[];
  /** Per-trade returns from out-of-sample replay. */
  outOfSampleReturns: number[];
  /** Performance series per parameter configuration, for the overfitting estimate. */
  performanceByConfig?: number[][];
  /** Benchmark of doing nothing. Defaults to a flat zero series. */
  noTradeReturns?: number[];
  datasetFingerprint?: string;
  /**
   * Set when the out-of-sample returns were drawn from a locked holdout. Supplying it makes
   * the query consume the strategy's one-time budget; the gauntlet refuses to run if that
   * budget is already spent, so the only unbiased estimate cannot quietly become a second
   * in-sample result. Omitting it asserts this evidence is *not* from the holdout.
   */
  holdoutId?: string;
  /**
   * How many candidates this one was selected from in a Factory screen.
   *
   * The screen is where the search actually happened, and it leaves no trial rows behind, so
   * nothing else in the system can recover this number. Breeding two hundred candidates and
   * gauntleting the survivor is two hundred trials, not one; omitting this understates the bar
   * by exactly the amount that matters most. `screenPopulation` returns it as `selectionCost`.
   */
  screenedCandidates?: number;
}

export class HoldoutBudgetExhausted extends Error {
  readonly code = "HOLDOUT_BUDGET_EXHAUSTED";
  constructor(message: string) {
    super(message);
    this.name = "HoldoutBudgetExhausted";
  }
}

export interface StageResult {
  kind: TrialKind;
  verdict: TrialVerdict;
  reason: string;
  metrics: Record<string, number | string | boolean>;
}

export interface GauntletReport {
  specId: string;
  passed: boolean;
  stages: StageResult[];
  trialsCounted: number;
  summary: string;
}

export const GATES = Object.freeze({
  minOutOfSampleProfitFactor: 1.1,
  maxPbo: 0.5,
  minDeflatedSharpe: 0.95,
  minCostStressProfitFactor: 1.0,
  minTradesForEvidence: 30,
  maxProbabilityOfLoss: 0.35,
  /** Bootstrap probability above which an edge over not trading is treated as luck. */
  maxNoTradePValue: 0.1,
  /** One basis point per trade: below this an edge is statistically real but economically zero. */
  minNoTradeEdge: 0.0001,
});

function costStressReturns(returns: readonly number[], dsl: StrategyDsl, multiple: number): number[] {
  // Additional cost relative to the baseline already embedded in the returns.
  const extraBps = roundTripCostBps(dsl, multiple) - roundTripCostBps(dsl, 1);
  const perTrade = extraBps / 10_000;
  return returns.map((value) => value - perTrade);
}

function stage(kind: TrialKind, verdict: TrialVerdict, reason: string, metrics: StageResult["metrics"]): StageResult {
  return { kind, verdict, reason, metrics };
}

/**
 * The multiple-testing denominator: how many independent evaluations could this result have
 * been selected from?
 *
 * It deliberately does not count trial rows. Each gauntlet run writes one row per gate, so
 * counting rows made the bar scale with how many gates happen to execute — add a gate and
 * every strategy in the system suddenly faces a higher threshold for no statistical reason.
 *
 * It counts completed evaluations across the whole strategy family instead. That closes the
 * more dangerous hole: a search that spawns two hundred sibling specs and reports the best
 * one previously showed a denominator of 1 for each, because each spec had been evaluated
 * once. Deflating against the family is what actually controls false discovery.
 */
function countSelectionTrials(specId: string, screenedCandidates = 0): number {
  const db = getDb();
  const spec = db
    .select()
    .from(schema.strategySpecs)
    .where(eq(schema.strategySpecs.id, specId))
    .get();

  const familyIds = new Set<string>([specId]);
  if (spec?.hypothesisId) {
    for (const sibling of db
      .select()
      .from(schema.strategySpecs)
      .where(eq(schema.strategySpecs.hypothesisId, spec.hypothesisId))
      .all()) {
      familyIds.add(sibling.id);
    }
  }

  const completed = db
    .select()
    .from(schema.validationResults)
    .all()
    .filter((row) => familyIds.has(row.strategySpecId)).length;

  // +1 for the evaluation currently in progress: this attempt is itself a trial. The screened
  // population is added because those candidates were evaluated and discarded — the fact that
  // they left no row behind is precisely why they have to be declared.
  const screened = Number.isFinite(screenedCandidates) ? Math.max(0, Math.trunc(screenedCandidates)) : 0;
  return Math.max(1, completed + 1 + Math.max(0, screened - 1));
}

/**
 * Runs the full validation gauntlet against supplied evidence and records every stage as a
 * trial. The trial count includes prior attempts, so a strategy that has been reworked many
 * times faces a correspondingly higher statistical bar.
 *
 * Simulation itself lives in the Python quant core; this module owns the governance and the
 * statistics that decide whether a result counts as evidence.
 */
export function runGauntlet(
  specId: string,
  dsl: StrategyDsl,
  evidence: GauntletEvidence,
  actor = "autonomous_worker",
): GauntletReport {
  const stages: StageResult[] = [];
  const startedAt = new Date();
  const { inSampleReturns, outOfSampleReturns } = evidence;
  const noTradeReturns = evidence.noTradeReturns ?? outOfSampleReturns.map(() => 0);

  // Consume the holdout budget before computing anything. Refusing here means a second query
  // is denied outright, rather than producing a number that must then be discarded — by which
  // point somebody has already read it and cannot unsee it.
  if (evidence.holdoutId) {
    const grant = requestHoldout(evidence.holdoutId, specId, actor);
    if (!grant.granted) throw new HoldoutBudgetExhausted(grant.message);
  }

  // 1. Sample adequacy — refuse to draw conclusions from too few trades.
  const tradeCount = outOfSampleReturns.length;
  stages.push(
    tradeCount >= GATES.minTradesForEvidence
      ? stage("replay", "pass", `${tradeCount} out-of-sample trades`, { trades: tradeCount })
      : stage("replay", "inconclusive", `Only ${tradeCount} out-of-sample trades; need ${GATES.minTradesForEvidence}.`, {
          trades: tradeCount,
          required: GATES.minTradesForEvidence,
        }),
  );

  // 2. Walk-forward — does the edge survive out of sample at all?
  const oosProfitFactor = profitFactor(outOfSampleReturns);
  const isProfitFactor = profitFactor(inSampleReturns);
  const decay = isProfitFactor > 0 ? oosProfitFactor / isProfitFactor : 0;
  stages.push(
    oosProfitFactor >= GATES.minOutOfSampleProfitFactor
      ? stage("walk_forward", "pass", `Out-of-sample profit factor ${oosProfitFactor.toFixed(2)}`, {
          oosProfitFactor,
          isProfitFactor,
          decay,
        })
      : stage("walk_forward", "fail", `Out-of-sample profit factor ${oosProfitFactor.toFixed(2)} below ${GATES.minOutOfSampleProfitFactor}`, {
          oosProfitFactor,
          isProfitFactor,
          decay,
        }),
  );

  // 3. Multiple-testing control — is this better than the best of N random attempts?
  const priorTrials = countSelectionTrials(specId, evidence.screenedCandidates ?? 0);
  const dsr = deflatedSharpeRatio({ returns: outOfSampleReturns, trials: priorTrials });
  stages.push(
    dsr.deflatedSharpe >= GATES.minDeflatedSharpe
      ? stage("parameter_stability", "pass", `Deflated Sharpe ${dsr.deflatedSharpe.toFixed(3)} over ${priorTrials} trials`, {
          deflatedSharpe: dsr.deflatedSharpe,
          sharpe: dsr.sharpe,
          threshold: dsr.threshold,
          trials: priorTrials,
        })
      : stage(
          "parameter_stability",
          "fail",
          `Deflated Sharpe ${dsr.deflatedSharpe.toFixed(3)} below ${GATES.minDeflatedSharpe} after ${priorTrials} trials. ` +
            "The observed Sharpe is within what luck would produce given this many attempts.",
          { deflatedSharpe: dsr.deflatedSharpe, sharpe: dsr.sharpe, threshold: dsr.threshold, trials: priorTrials },
        ),
  );

  // 4. Overfitting probability across parameter configurations.
  if (evidence.performanceByConfig && evidence.performanceByConfig.length >= 2) {
    const pbo = probabilityOfBacktestOverfitting(evidence.performanceByConfig);
    stages.push(
      pbo <= GATES.maxPbo
        ? stage("causality", "pass", `PBO ${(pbo * 100).toFixed(0)}%`, { pbo })
        : stage("causality", "fail", `PBO ${(pbo * 100).toFixed(0)}% exceeds ${GATES.maxPbo * 100}%; the chosen configuration is likely selection noise.`, { pbo }),
    );
  } else {
    stages.push(
      stage("causality", "inconclusive", "No parameter sweep supplied; overfitting probability was not estimated.", {
        configurations: evidence.performanceByConfig?.length ?? 0,
      }),
    );
  }

  // 5. Cost stress — survive double the modelled costs.
  const stressed = costStressReturns(outOfSampleReturns, dsl, 2);
  const stressedProfitFactor = profitFactor(stressed);
  stages.push(
    stressedProfitFactor >= GATES.minCostStressProfitFactor
      ? stage("cost_stress", "pass", `Profit factor ${stressedProfitFactor.toFixed(2)} at 2x costs`, { stressedProfitFactor })
      : stage("cost_stress", "fail", `Profit factor falls to ${stressedProfitFactor.toFixed(2)} at 2x costs.`, {
          stressedProfitFactor,
          modelledCostBps: roundTripCostBps(dsl),
        }),
  );

  // 6. Monte Carlo — how much depends on trade ordering and selection?
  const simulation = monteCarlo(outOfSampleReturns, 1_000, 42);
  stages.push(
    simulation.probabilityOfLoss <= GATES.maxProbabilityOfLoss
      ? stage("monte_carlo", "pass", `Probability of a losing run ${(simulation.probabilityOfLoss * 100).toFixed(0)}%`, {
          probabilityOfLoss: simulation.probabilityOfLoss,
          p05ProfitFactor: simulation.p05ProfitFactor,
          worstDrawdown: simulation.worstDrawdown,
        })
      : stage("monte_carlo", "fail", `Probability of a losing run ${(simulation.probabilityOfLoss * 100).toFixed(0)}% exceeds ${GATES.maxProbabilityOfLoss * 100}%.`, {
          probabilityOfLoss: simulation.probabilityOfLoss,
          p05ProfitFactor: simulation.p05ProfitFactor,
        }),
  );

  // 7. No-trade comparison — is acting *distinguishably* better than abstaining?
  // A bare mean comparison passed on any positive difference, however small and noisy.
  // The paired bootstrap asks how often resampling the same trades would have produced no
  // edge at all; the floor keeps "statistically real but economically zero" out.
  const strategyMean = mean(outOfSampleReturns);
  const noTradeMean = mean(noTradeReturns);
  if (noTradeReturns.length !== outOfSampleReturns.length) {
    stages.push(
      stage(
        "no_trade_comparison",
        "inconclusive",
        `Benchmark supplies ${noTradeReturns.length} returns against ${outOfSampleReturns.length} trades; unpaired series cannot be compared.`,
        { benchmarkLength: noTradeReturns.length, trades: outOfSampleReturns.length },
      ),
    );
  } else {
    const edgeTest = pairedBootstrapEdge(outOfSampleReturns, noTradeReturns, 2_000, 42);
    const material = edgeTest.edge >= GATES.minNoTradeEdge;
    const distinguishable = edgeTest.pValue <= GATES.maxNoTradePValue;
    stages.push(
      material && distinguishable
        ? stage("no_trade_comparison", "pass", `Edge over not trading ${edgeTest.edge.toFixed(4)}/trade (p=${edgeTest.pValue.toFixed(3)})`, {
            strategyMean,
            noTradeMean,
            edge: edgeTest.edge,
            pValue: edgeTest.pValue,
          })
        : stage(
            "no_trade_comparison",
            "fail",
            !material
              ? `Edge over not trading is ${edgeTest.edge.toFixed(5)}/trade — below the ${GATES.minNoTradeEdge} floor.`
              : `Edge ${edgeTest.edge.toFixed(4)}/trade is indistinguishable from luck (p=${edgeTest.pValue.toFixed(3)} > ${GATES.maxNoTradePValue}).`,
            { strategyMean, noTradeMean, edge: edgeTest.edge, pValue: edgeTest.pValue },
          ),
    );
  }

  const failures = stages.filter((result) => result.verdict === "fail");
  const inconclusive = stages.filter((result) => result.verdict === "inconclusive");
  const passed = failures.length === 0 && inconclusive.length === 0;

  // A UUID rather than a hash of specId+milliseconds: two evaluations of one spec inside the
  // same millisecond produced identical ids, and the loser vanished.
  const id = `val_${randomUUID()}`;

  // One transaction for the whole verdict. Previously a crash between the stage rows and the
  // status update could leave a strategy recorded as evaluated but never marked rejected —
  // and the ledger is append-only, so the half-written state could not be tidied away.
  getDb().transaction(() => {
    for (const result of stages) {
      recordTrial({
        strategySpecId: specId,
        kind: result.kind,
        verdict: result.verdict,
        reason: result.reason,
        metrics: result.metrics,
        datasetFingerprint: evidence.datasetFingerprint,
        actor,
        startedAt,
      });
    }

    getDb()
      .insert(schema.validationResults)
      .values({
        id,
        strategySpecId: specId,
        oosProfitFactor: Number.isFinite(oosProfitFactor) ? oosProfitFactor : null,
        pbo: typeof stages[3]?.metrics.pbo === "number" ? (stages[3].metrics.pbo as number) : null,
        deflatedSharpe: dsr.deflatedSharpe,
        costMultiplePf: Number.isFinite(stressedProfitFactor) ? stressedProfitFactor : null,
        // Record the denominator the Sharpe was actually deflated by, so the stored result
        // can be re-derived rather than merely believed.
        trialsCounted: priorTrials,
        passed: passed ? 1 : 0,
        detail: JSON.stringify(stages),
        evaluatedAt: new Date(),
      })
      .run();

    if (passed) {
      setSpecStatus(specId, "paper_challenger");
    } else if (failures.length > 0) {
      setSpecStatus(specId, "rejected");
      recordFailure(
        "strategy",
        failures[0].kind,
        failures.map((result) => `${result.kind}: ${result.reason}`).join(" | "),
        specId,
        "Recorded so this configuration is not retried without a change of substance.",
      );
    }
  });

  const summary = passed
    ? `Promoted to paper challenger after ${stages.length} stages.`
    : failures.length > 0
      ? `Rejected: ${failures.map((result) => result.kind).join(", ")} failed.`
      : `Inconclusive: ${inconclusive.map((result) => result.kind).join(", ")} lacked evidence.`;

  return { specId, passed, stages, trialsCounted: priorTrials, summary };
}

export type HoldoutDenialCode = "HOLDOUT_BUDGET_EXHAUSTED";

export interface HoldoutGrant {
  granted: true;
  queriesUsed: number;
  remaining: number;
}

export interface HoldoutDenial {
  granted: false;
  code: HoldoutDenialCode;
  message: string;
  queriesUsed: number;
  firstQueriedAt: Date | null;
}

/**
 * The locked holdout may be queried once per strategy, ever. The ledger is append-only at
 * the database level, so the budget cannot be reset by deleting rows — which is exactly the
 * shortcut an optimiser under pressure would otherwise take.
 */
export function requestHoldout(
  holdoutId: string,
  specId: string,
  actor: string,
  resultHash?: string,
): HoldoutGrant | HoldoutDenial {
  const db = getDb();
  const priorQueries = db
    .select()
    .from(schema.holdoutLedger)
    .where(
      and(eq(schema.holdoutLedger.holdoutId, holdoutId), eq(schema.holdoutLedger.strategySpecId, specId)),
    )
    .all();

  if (priorQueries.length >= HOLDOUT_QUERY_BUDGET) {
    return {
      granted: false,
      code: "HOLDOUT_BUDGET_EXHAUSTED",
      message:
        `Holdout "${holdoutId}" has already been queried ${priorQueries.length} time(s) for this strategy. ` +
        "Querying it again would turn the only unbiased estimate into another in-sample result. " +
        "Build a new strategy or collect forward evidence instead.",
      queriesUsed: priorQueries.length,
      firstQueriedAt: priorQueries[0]?.queriedAt ?? null,
    };
  }

  db.insert(schema.holdoutLedger)
    .values({
      holdoutId,
      strategySpecId: specId,
      actor,
      resultHash: resultHash ?? null,
      queriedAt: new Date(),
    })
    .run();

  return {
    granted: true,
    queriesUsed: priorQueries.length + 1,
    remaining: HOLDOUT_QUERY_BUDGET - priorQueries.length - 1,
  };
}

export function holdoutUsage(specId: string) {
  return getDb()
    .select()
    .from(schema.holdoutLedger)
    .where(eq(schema.holdoutLedger.strategySpecId, specId))
    .all();
}

export { sharpeRatio };
