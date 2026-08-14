import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { type LearningMode } from "@/lib/governance/policy";
import { breedingBasis } from "@/lib/paper/capital";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import type { ResearchDatasetSource } from "@/lib/learning/rehearsal";
import { costStanding, type CostVerdict } from "./cost-gate";
import { StrategyDslSchema, isIntradayResolution, type StrategyDsl } from "./dsl";
import { runGauntlet } from "./gauntlet";
import { costVerdictOrBlocked, currentStage } from "./promotion";
import {
  AUTONOMOUS_ACTOR,
  DEFAULT_DAILY_TRIAL_BUDGET,
  trialsSpentToday,
  withAuthorizedTrial,
} from "./trial-governor";

// Re-exported from their new home in the governor so existing importers (tests, the learning
// cycle) keep their import path. The trial-ledger primitives belong WITH the sole authorizer.
export { AUTONOMOUS_ACTOR, DEFAULT_DAILY_TRIAL_BUDGET, trialsSpentToday };

/**
 * Spending a validation trial without being asked — and the five things that must all be true first.
 *
 * ## Why this cannot simply run when idle
 *
 * `CLAUDE.md`: *"Do not run the validation gauntlet speculatively — every trial permanently raises
 * the statistical bar for that strategy."* That is not a style preference. The gauntlet's
 * significance test carries a multiple-testing denominator, so each trial makes every future
 * candidate in that family harder to validate, forever. A loop that ran it on a timer would burn
 * the family's budget on whatever happened to be in the registry.
 *
 * So "autonomous" here means *selective*, not *unsupervised*. A trial is spent automatically only
 * when all five guards hold, and every guard is reported whether it passed or not — a candidate
 * that was skipped is as interesting as one that ran.
 *
 * ## The governance boundary — the Trial Budget Governor, not the generic allowlist
 *
 * Authorization to spend a trial does NOT come from `AUTONOMOUS_PERMITTED`. `run_gauntlet` was
 * deliberately removed from that generic allowlist (owner decision 2026-08-14): a line there is
 * reachable by any autonomous actor, and soon by an Agent/Team layer, which is too coarse an
 * authority for spending statistical evidence. The sole authorizer is the deterministic
 * `authorizeTrial` governor (`lib/strategy/trial-governor.ts`), OFF by default and enabled only
 * by a dedicated owner-set switch (`MARKETPULSE_AUTONOMOUS_TRIALS=1`) — never a model, never the
 * learning mode.
 *
 * This module asks the governor, every time. Refused (the default), it evaluates every selection
 * guard anyway and persists a recommendation naming the candidate it *would* have spent a trial
 * on. With the lane switched on and every deterministic gate holding, the same code spends exactly
 * one trial at the configured budget — no per-trial human click. Both paths are tested.
 */

export interface TrialGuard {
  name: string;
  passed: boolean;
  detail: string;
}

export interface TrialCandidate {
  specId: string;
  name: string;
  guards: TrialGuard[];
  /** True only when every guard passed. */
  eligible: boolean;
  reason: string;
}

export interface AutoGauntletReport {
  ranAt: string;
  /** Whether policy permits an autonomous actor to spend a trial at all. */
  policyAllowed: boolean;
  policyReason: string;
  budget: { perDay: number; spentToday: number; remaining: number };
  /** Every draft/rehearsed candidate considered, with each guard's verdict. */
  candidates: TrialCandidate[];
  /** The trial actually spent, or null. Null with an eligible candidate means policy refused. */
  spent: { specId: string; name: string; passed: boolean; trialsCounted: number; summary: string } | null;
  /** The candidate that cleared every guard when no trial was spent on it, or null. */
  recommended: { specId: string; name: string } | null;
  summary: string;
}

/** A spec stored under an older compiler is a fact to report, not a crash. */
function parseDsl(raw: string): StrategyDsl | null {
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Every candidate the loop would consider, with all five guards evaluated.
 *
 * Pure with respect to the gauntlet: it reads, it decides, it spends nothing. Separated from
 * `runAutonomousGauntlet` so the selection can be tested exhaustively without a trial ledger.
 */
export function selectTrialCandidates(
  now = new Date(),
  budget = DEFAULT_DAILY_TRIAL_BUDGET,
  /** Injectable like promotion's own wrapper, so the fail-closed branch is directly testable. */
  standing: (dslJson: string) => CostVerdict = costStanding,
): TrialCandidate[] {
  const specs = getDb().select().from(schema.strategySpecs).all();
  const basis = breedingBasis();
  const spentToday = trialsSpentToday(now);

  const candidates: TrialCandidate[] = [];

  for (const spec of specs) {
    const dsl = parseDsl(spec.dsl);
    const guards: TrialGuard[] = [];

    if (!dsl) {
      candidates.push({
        specId: spec.id,
        name: spec.name,
        guards: [{ name: "parses", passed: false, detail: "The stored DSL does not parse against the current compiler." }],
        eligible: false,
        reason: "Cannot be read, so cannot be judged.",
      });
      continue;
    }

    // 1. The rehearsal must say it would survive. This is free evidence and carries no statistical
    //    weight, which is exactly why it is the right filter for deciding what to spend weight on.
    const rehearsal = getDb()
      .select()
      .from(schema.rehearsalOutcomes)
      .where(eq(schema.rehearsalOutcomes.strategySpecId, spec.id))
      .orderBy(desc(schema.rehearsalOutcomes.rehearsedAt))
      .get();
    guards.push({
      name: "rehearsal_would_pass",
      passed: rehearsal?.verdict === "would_pass",
      detail:
        rehearsal === undefined
          ? "Never rehearsed. Nothing free has been learned about it yet."
          : `Rehearsal says ${rehearsal.verdict}.`,
    });

    // 2. It must be at the rung a trial advances. Spending one on a strategy already validated
    //    buys nothing and raises the family's bar for free.
    const { stage } = currentStage(spec.id, spec.dsl);
    guards.push({
      name: "awaiting_gauntlet",
      passed: stage === "rehearsed",
      detail: `At ${stage}. A trial only moves a strategy from rehearsed to validated.`,
    });

    // 3. Its declared cost must describe a market the owner can reach. A trial spent on a
    //    cost-understating spec measures a fictional market at a permanent price.
    //
    //    GUARDED: `costStanding` throws `CostModelError` when no fee schedule is in force for a
    //    spec's market/date, and unguarded that single spec killed the ENTIRE selection pass into
    //    the cycle's impairment — every other candidate unevaluated because one was unpriceable.
    //    The wrapper converts the throw into that one spec's own fail-closed refusal, exactly as
    //    the promotion ladder already does.
    const cost = costVerdictOrBlocked(spec.dsl, standing);
    guards.push({
      name: "cost_honest",
      passed: !cost.understated,
      detail: cost.reason,
    });

    // 4. It must be tradable at the owner's capital. A daily strategy needs delivery, which needs
    //    ₹23,000; the owner has ₹1,000, tradable only intraday. Validating a strategy the account
    //    cannot execute spends a permanent resource on a hypothetical one.
    const impliedProduct = isIntradayResolution(dsl.universe.resolution) ? "INTRADAY" : "DELIVERY";
    guards.push({
      name: "tradable_at_capital",
      passed: impliedProduct === basis.product,
      detail:
        impliedProduct === basis.product
          ? `${dsl.universe.resolution} implies ${impliedProduct.toLowerCase()}, which ${basis.capital} can trade.`
          : `${dsl.universe.resolution} implies ${impliedProduct.toLowerCase()}, but ${basis.capital} can only trade ${basis.product.toLowerCase()}. ${basis.reason}`,
    });

    // 5. The daily budget. Checked per candidate rather than once, so the report says plainly that
    //    an otherwise eligible strategy was held back by the budget and not by its own merits.
    guards.push({
      name: "budget_available",
      passed: spentToday < budget,
      detail: `${spentToday} of ${budget} trial(s) spent today.`,
    });

    const failed = guards.filter((guard) => !guard.passed);
    candidates.push({
      specId: spec.id,
      name: spec.name,
      guards,
      eligible: failed.length === 0,
      reason:
        failed.length === 0
          ? "Every guard holds. A trial spent here is spent on the best evidence available for free."
          : failed.map((guard) => guard.detail).join(" "),
    });
  }

  // Eligible first; otherwise the ones failing fewest guards, which are the nearest to ready.
  return candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return a.guards.filter((g) => !g.passed).length - b.guards.filter((g) => !g.passed).length;
  });
}

export interface AutoGauntletOptions {
  mode: LearningMode;
  /** 13b: recorded snapshots only. There is no provider-shaped thing this can accept. */
  researchData: ResearchDatasetSource;
  now?: Date;
  budget?: number;
}

/**
 * Select, check the policy, and spend at most one trial.
 *
 * The policy is consulted **before** any candidate is chosen and again gates the spend. A denial is
 * not an error and not a failure: it is the governance kernel answering the question it exists to
 * answer, and the report says so rather than falling silent.
 */
export async function runAutonomousGauntlet(options: AutoGauntletOptions): Promise<AutoGauntletReport> {
  const now = options.now ?? new Date();
  const budget = options.budget ?? DEFAULT_DAILY_TRIAL_BUDGET;
  const ranAt = now.toISOString();

  // The Trial Budget Governor is the single authority. It folds the lane switch, the freeze and
  // the daily budget into one deterministic decision, checked against the candidate that cleared
  // the selection guards. A denial is not an error and not a failure: it is the governor answering
  // the question it exists to answer, and the report says which gate refused.
  //
  // `withAuthorizedTrial` serializes the whole authorize→spend section under a single mutex, so
  // the budget check is ATOMIC with the eventual ledger write — a second concurrent authorizer
  // cannot slip past a budget that this run is about to consume.
  const candidates = selectTrialCandidates(now, budget);
  const eligible = candidates.find((candidate) => candidate.eligible) ?? null;

  return withAuthorizedTrial({ candidate: eligible, now, budget }, (authorization): AutoGauntletReport => {
    const base = {
      ranAt,
      policyAllowed: authorization.approved,
      policyReason: authorization.reason,
      budget: authorization.budget,
      candidates,
    };

    if (eligible === null) {
      return {
        ...base,
        spent: null,
        recommended: null,
        summary:
          candidates.length === 0
            ? "No strategy exists to consider."
            : `${candidates.length} candidate(s) considered, none eligible. No trial was spent, and none was wasted finding that out.`,
      };
    }

    if (!authorization.approved) {
      return {
        ...base,
        spent: null,
        recommended: { specId: eligible.specId, name: eligible.name },
        summary:
          `${eligible.name} clears every selection guard, but the Trial Budget Governor did not authorize a spend ` +
          `(${authorization.code}): ${authorization.reason} Recorded as a recommendation; no trial was spent.`,
      };
    }

    const spec = getDb().select().from(schema.strategySpecs).all().find((row) => row.id === eligible.specId);
    const dsl = spec ? parseDsl(spec.dsl) : null;
    if (!spec || !dsl) {
      return { ...base, spent: null, recommended: null, summary: "The selected candidate vanished between selection and execution." };
    }

    // Evidence from a real replay over a RECORDED snapshot (13b). A gauntlet fed anything else
    // grades whatever it was handed — and a provider window cannot even name what it was.
    const snapshot = options.researchData(dsl.universe.market, dsl.universe.resolution);
    if (!snapshot.ok) {
      return {
        ...base,
        spent: null,
        recommended: { specId: eligible.specId, name: eligible.name },
        summary:
          `${eligible.name} is eligible but the canonical store cannot serve its universe. ` +
          `${snapshot.message} No trial was spent — missing stored history is an ingestion task, not a verdict.`,
      };
    }

    const backtest = runPortfolioBacktest(dsl, snapshot.dataset, {
      datasetFingerprint: snapshot.fingerprint,
      datasetSnapshotId: snapshot.snapshotId,
    });
    if (!backtest.ok) {
      return {
        ...base,
        spent: null,
        recommended: { specId: eligible.specId, name: eligible.name },
        summary: `${eligible.name} could not be replayed (${backtest.code}), so no trial was spent. ${backtest.message}`,
      };
    }

    const report = runGauntlet(
      spec.id,
      dsl,
      { ...backtest.evidence, executionProfileId: backtest.execution?.profileId ?? null },
      AUTONOMOUS_ACTOR,
    );

    return {
      ...base,
      spent: {
        specId: spec.id,
        name: spec.name,
        passed: report.passed,
        trialsCounted: report.trialsCounted,
        summary: report.summary,
      },
      recommended: null,
      summary:
        `Spent one trial on ${spec.name}: ${report.passed ? "passed" : "failed"}. ${report.summary} ` +
        "That trial is permanent and has raised the bar for every future candidate in this family.",
    };
  });
}
