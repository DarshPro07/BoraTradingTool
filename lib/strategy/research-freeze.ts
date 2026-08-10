/**
 * A deliberate halt on spending statistical budget, while research identity is repaired.
 *
 * ## Why a freeze, and why before the repair rather than after
 *
 * Two resources in this system are **irreversible**: a gauntlet trial permanently raises the
 * multiple-testing bar for everything related to it, and a sealed-holdout read permanently
 * contaminates the only unbiased estimate a strategy will ever have.
 *
 * Both are currently being spent against a broken accounting model:
 *
 *   - every strategy spec has `hypothesisId = NULL`, so `countSelectionTrials` walks a family of
 *     one and the deflated Sharpe denominator is 1 where it should be the number of configurations
 *     actually tried;
 *   - the holdout budget is keyed on `(holdoutId, strategySpecId)`, so a rename, a copy or a new
 *     version yields a fresh look at the same sealed data. `strategy.test.ts` asserts this as
 *     intended behaviour under the name "tracks budgets per strategy, not globally".
 *
 * Repairing the schema afterwards cannot undo a read. A holdout result that has been computed has
 * been seen, and no migration makes it unseen. So the freeze comes **first**, and the repair
 * happens behind it.
 *
 * ## What is deliberately still allowed
 *
 * Rehearsals, replays, simulations and every read of existing evidence. None of them consume a
 * finite resource — that is the whole reason the rehearsal exists — so freezing them would stop
 * research for no protective gain. The freeze is narrow on purpose: a blunt one gets lifted early.
 *
 * ## Lifting it
 *
 * Set `active: false` **and** update `research-freeze.test.ts`, which pins the current state. The
 * paired test is not ceremony: it means thawing cannot happen as a quiet one-word diff, and it
 * forces whoever lifts it to state in the same commit that the repair is done.
 */

/** Resources whose spending is irreversible, and therefore freezable. */
export type FreezableAction = "gauntlet_trial" | "holdout_read";

export const RESEARCH_FREEZE = Object.freeze({
  // Lifted 2026-08-09, same day it was imposed, once every condition below was met and verified.
  // Kept in place rather than deleted: the next time an accounting defect is found, the halt
  // should already exist and simply be switched on.
  active: false,
  since: "2026-08-09",
  liftedOn: "2026-08-09",
  liftedBecause:
    "Research identity is installed and cut over. Trials are counted from the selection ledger, " +
    "holdout entitlement is gated at family and campaign level by UNIQUE constraints, missing " +
    "identity fails closed at every entry point, and the adversarial suite proves rename, copy, " +
    "re-version and new-uuid cannot reset either budget.",
  /** The condition that lifts it. Written as a checklist so "are we done" is not a judgement call. */
  liftsWhen: Object.freeze([
    "every validation-eligible spec carries a non-null campaign and family identity",
    "selection trials are counted from an immutable ledger of tested configurations",
    "holdout entitlement is gated at campaign and family level, not per spec id",
    "entitlement is consumed atomically, before the result is computed",
    "adversarial tests prove rename, copy, re-version and new-uuid cannot reset either budget",
  ]),
  reason:
    "Research identity is under repair. Trials are being counted against a family of one and the " +
    "holdout budget is keyed per strategy id, so both budgets are currently spendable by renaming " +
    "a strategy. Neither resource can be refunded once spent, so spending stops until the " +
    "accounting is correct.",
});

export interface FreezeStanding {
  allowed: boolean;
  /** Always populated, whether allowed or not. */
  reason: string;
}

/**
 * May this irreversible action proceed?
 *
 * Returns a verdict rather than throwing. The callers that matter — an API route and the
 * autonomous loop — both need to *report* the refusal rather than crash on it, and a refusal that
 * surfaces as a stack trace is one nobody reads.
 */
export function freezeStanding(action: FreezableAction): FreezeStanding {
  if (!RESEARCH_FREEZE.active) {
    return { allowed: true, reason: "No research freeze is in force." };
  }

  const what = action === "gauntlet_trial" ? "Running the gauntlet" : "Reading the sealed holdout";
  return {
    allowed: false,
    reason:
      `${what} is frozen (since ${RESEARCH_FREEZE.since}). ${RESEARCH_FREEZE.reason} ` +
      `Rehearsals, replays and every read of existing evidence remain available. ` +
      `Lifts when: ${RESEARCH_FREEZE.liftsWhen.join("; ")}.`,
  };
}
