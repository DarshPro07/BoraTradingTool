import { GATES } from "./gauntlet";
import { MIN_FORWARD_OBSERVATIONS, forwardRecord } from "./forward";

/**
 * The promotion ladder — the thing that walks a strategy from idea to owner review.
 *
 * Every stage of the reference loop already existed here as a separate capability: a compiler, a
 * backtest engine, a seven-stage gauntlet, a sealed holdout, a forward record, a proposal queue.
 * Nothing *connected* them. That is why five strategies sat at `draft` for weeks — not because
 * any stage was missing, but because nothing ever carried a candidate from one to the next, and
 * a pipeline with no conveyor is a pile of machines.
 *
 * ## The rule that makes it worth having
 *
 * **A strategy advances exactly one rung at a time, and only on evidence that rung requires.**
 * No skipping. The temptation is real — a candidate with a spectacular backtest looks ready for
 * paper, and moving it straight there feels like removing a formality. It is not a formality:
 * the gauntlet exists because spectacular backtests are what overfitting produces, and the
 * sealed holdout exists because the gauntlet can be gamed by repetition.
 *
 * Demotion, by contrast, may skip any distance. Evidence that a strategy is broken is worth more
 * than evidence it works, because the first kind is far harder to manufacture by accident.
 */

export type Stage =
  /** Compiled and stored. No evidence of any kind. */
  | "draft"
  /** Replayed against real bars. Not a trial — costs nothing, proves little. */
  | "rehearsed"
  /** Survived the gauntlet. A trial was spent; the family's bar is permanently higher. */
  | "validated"
  /** Cleared the sealed holdout. One query only, ever. */
  | "holdout_cleared"
  /** Accumulating forward observations — the only unbiased evidence available. */
  | "paper_forward"
  /** Enough forward evidence to be worth the owner's attention. */
  | "owner_review"
  /** Failed somewhere and kept on record so it is never rediscovered. */
  | "graveyard";

export const STAGE_ORDER: readonly Stage[] = [
  "draft",
  "rehearsed",
  "validated",
  "holdout_cleared",
  "paper_forward",
  "owner_review",
];

export interface StageEvidence {
  /** From the rehearsal pass: would it survive the battery? */
  rehearsalVerdict?: "would_pass" | "would_fail" | "not_evaluable" | "rediscovered";
  /** From the gauntlet. */
  gauntletPassed?: boolean;
  outOfSampleProfitFactor?: number;
  deflatedSharpe?: number;
  /** True once the sealed holdout has been queried and cleared. */
  holdoutCleared?: boolean;
  /** Set when the holdout budget for this strategy is spent. */
  holdoutExhausted?: boolean;
  /**
   * True when the spec's declared round-trip cost is below what the owner's capital actually
   * pays. See `lib/strategy/cost-gate.ts`.
   *
   * Deliberately optional, and `undefined` is *not* treated as `true`: a caller that never
   * computed the cost standing must not have its strategies blocked as though they had failed a
   * check nobody ran. Missing is not zero here either.
   */
  costUnderstated?: boolean;
  /** Why, when `costUnderstated` is true. Carried so the refusal names both figures. */
  costReason?: string;
}

export interface Advance {
  from: Stage;
  to: Stage;
  /** True when the stage changed. False carries the reason in `because`. */
  moved: boolean;
  /** Why it moved, or why it did not. Always populated. */
  because: string;
}

function next(stage: Stage): Stage | null {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0 || index === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[index + 1];
}

/**
 * Decide the single next move for one strategy.
 *
 * Pure: takes evidence, returns a decision. The caller persists it. That separation is
 * deliberate — a promotion function that also writes is one that cannot be exhaustively tested
 * without a database, and this is the code that decides what the owner eventually risks money on.
 */
export function advanceStrategy(current: Stage, evidence: StageEvidence, specId?: string): Advance {
  const stay = (because: string): Advance => ({ from: current, to: current, moved: false, because });
  const bury = (because: string): Advance => ({ from: current, to: "graveyard", moved: true, because });

  if (current === "graveyard") {
    return stay("Buried. A graveyard entry is never revived — rediscovering it is what the graveyard exists to prevent.");
  }

  const target = next(current);
  if (target === null) {
    return stay("At owner review. Nothing beyond this is the system's to decide; a human either acts or does not.");
  }

  // Checked before any rung's own rules, and at every rung rather than only the first.
  //
  // The evidence behind a cost-understating strategy is not weak, it is void: the backtest is net
  // of a market that does not exist, so its profit factor, its deflated Sharpe and its holdout
  // result all answer a question nobody asked. A strategy already sitting at `validated` when the
  // real cost was discovered must stop climbing too — its evidence was computed the same way.
  if (evidence.costUnderstated === true) {
    return stay(
      evidence.costReason ??
        "This strategy's declared round-trip cost is below what the owner's capital actually pays, " +
          "so its backtest is net of a market that does not exist.",
    );
  }

  switch (current) {
    case "draft": {
      if (evidence.rehearsalVerdict === undefined) {
        return stay("Not yet rehearsed. A draft with no replay behind it has no evidence of any kind.");
      }
      if (evidence.rehearsalVerdict === "not_evaluable") {
        // Not a failure of the idea — a failure of the deployment. Burying it would discard a
        // legitimate strategy for lacking data that may arrive tomorrow.
        return stay("Cannot be evaluated here: the features it needs are not derivable from the data this deployment has. The strategy is not wrong; the deployment is incomplete.");
      }
      if (evidence.rehearsalVerdict === "rediscovered") {
        return bury("Already in the graveyard under a different name. Re-testing it would spend a trial to relearn a recorded fact.");
      }
      if (evidence.rehearsalVerdict === "would_fail") {
        // Deliberately not buried. A rehearsal spends no trial and therefore carries no
        // statistical weight — burying on it would be a permanent decision from free evidence.
        return stay("Rehearsal suggests it would not survive the battery. Not buried: a rehearsal costs no trial, so it is too cheap a signal to end a strategy on.");
      }
      return { from: current, to: "rehearsed", moved: true, because: "Rehearsal indicates it would survive the battery. Worth spending a trial on." };
    }

    case "rehearsed": {
      if (evidence.gauntletPassed === undefined) {
        return stay("The gauntlet has not run. Advancing needs a trial, and a trial is deliberate — it permanently raises the bar for every future candidate in this family.");
      }
      if (!evidence.gauntletPassed) {
        return bury(
          `Failed the gauntlet${
            evidence.deflatedSharpe !== undefined
              ? ` (deflated Sharpe ${evidence.deflatedSharpe.toFixed(3)} against a gate of ${GATES.minDeflatedSharpe})`
              : ""
          }. The trial is spent either way, so the result is recorded rather than discarded.`,
        );
      }
      return { from: current, to: "validated", moved: true, because: "Survived all gauntlet stages." };
    }

    case "validated": {
      if (evidence.holdoutExhausted) {
        return bury("The sealed holdout budget for this strategy is spent. Querying it again would turn the holdout into another training set, so the strategy stops here permanently.");
      }
      if (evidence.holdoutCleared === undefined) {
        return stay("The sealed holdout has not been queried. It may be queried once, ever — so it is drawn deliberately, not by a loop.");
      }
      if (!evidence.holdoutCleared) {
        return bury("Failed against the sealed holdout — the one sample it had never been fitted to.");
      }
      return { from: current, to: "holdout_cleared", moved: true, because: "Cleared the sealed holdout on its single permitted query." };
    }

    case "holdout_cleared": {
      return {
        from: current,
        to: "paper_forward",
        moved: true,
        because: "Promoted to paper forward. From here only observations recorded before their outcomes count — every number so far was computed on data the strategy was selected against.",
      };
    }

    case "paper_forward": {
      const record = forwardRecord(specId);
      if (!record.isEvidence) {
        return stay(record.summary);
      }
      if (record.meanR !== null && record.meanR <= 0) {
        return bury(
          `Forward evidence is negative: mean ${record.meanR.toFixed(2)}R across ${record.resolved} resolved observations. This is the only unbiased sample it has, and it says the edge is not there.`,
        );
      }
      // The standard error must not swamp the mean, or "positive" is indistinguishable from noise
      // that happened to land above zero.
      if (record.meanR !== null && record.standardError !== null && record.meanR < record.standardError) {
        return stay(
          `Mean ${record.meanR.toFixed(2)}R with a standard error of ${record.standardError.toFixed(2)}. Positive, but smaller than its own uncertainty — more observations, not a promotion.`,
        );
      }
      return {
        from: current,
        to: "owner_review",
        moved: true,
        because: `${record.resolved} forward observations, mean ${record.meanR?.toFixed(2)}R ± ${record.standardError?.toFixed(2)}. Unbiased and positive beyond its own error.`,
      };
    }

    default:
      return stay("No rule covers this stage.");
  }
}

/**
 * Whether a strategy at this stage may be shown to the owner as something to act on.
 *
 * Deliberately narrow. `validated` is where a system that wanted to look impressive would draw
 * the line — the gauntlet is genuinely hard — but everything up to and including it is computed
 * on data the strategy was selected against. Only forward observations are unbiased, so only
 * `owner_review` is actionable, and everything below it is labelled as research.
 */
export function isActionable(stage: Stage): boolean {
  return stage === "owner_review";
}

/** Human-readable rung, with what it is *not* — which is the part that gets forgotten. */
export const STAGE_MEANING: Readonly<Record<Stage, string>> = Object.freeze({
  draft: "Compiled and stored. No evidence of any kind.",
  rehearsed: "Replayed against real bars. Costs no trial, so it proves little.",
  validated: "Survived the gauntlet. Still measured on data it was selected against.",
  holdout_cleared: "Cleared the sealed holdout on its one permitted query.",
  paper_forward: `Accumulating forward observations. Needs ${MIN_FORWARD_OBSERVATIONS} resolved before the sample means anything.`,
  owner_review: "Unbiased forward evidence, positive beyond its own error. The only stage worth acting on.",
  graveyard: "Failed and kept on record so it is never rediscovered.",
});
