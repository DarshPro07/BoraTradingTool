/**
 * The Hypothesis Foundry — where an economic idea has to earn a test.
 *
 * ## What this replaces
 *
 * MarketPulse could already test exceptionally well and think poorly about where returns come
 * from. Its five canonical seeds were textbook indicator families, and the measured result was that
 * four of five had no positive gross expectancy *before* any friction
 * (`docs/plans/rehearsal-funnel/05-gross-vs-cost.md`). That is not a testing failure. Nothing in
 * the pipeline ever asked the question this module asks:
 *
 *   > Who keeps leaving this return available, and why can they not stop?
 *
 * ## Why the gate runs on the PRIOR, not the result
 *
 * `expectedGrossEffectBps` is what the mechanism predicts BEFORE anything is measured. Gating on it
 * is the whole point: an idea that cannot plausibly clear its own friction should never consume a
 * statistical trial, however good a backtest it might produce. Gating on a measured result instead
 * would be selection — it is exactly how "we happened to backtest +76 bps" becomes a strategy.
 *
 * ## Three levels, so ideas can be killed cheaply
 *
 * ```
 * HYPOTHESIS          an economic claim. Zero statistical budget. Free to reject.
 *   |  passes plausibility
 * RESEARCH_PROBE      one canonical implementation. Gross economics and basic robustness.
 *   |  earns promotion                                  Still NOT a campaign trial.
 * REGISTERED_CAMPAIGN frozen hash, trial accounting, PBO/DSR, gauntlet, holdout, forward, paper.
 * ```
 *
 * The Foundry may generate and kill freely at the first level. What it must never do is turn a
 * thousand speculative ideas into a thousand invisible backtests and register the best one — that
 * moves overfitting one level earlier and hides it.
 *
 * ## Mandatory control discipline (owner policy, 2026-08-17)
 *
 * > **No real-data probe result is trusted until the probe has both a known-positive synthetic
 * > world it detects, and a genuine null world in which it does not hallucinate an effect.**
 *
 * This is not ceremony. Building M02 produced two fixture defects that each would have yielded a
 * confident wrong conclusion: liquidity correlated with the engineered drift, so the positive
 * control read ~0 bps and the probe looked blind; and the first null re-randomised drift on the
 * holding period, so it showed +44 bps at t = 2.25 and would have licensed trusting a tool that
 * manufactures effects. A probe that cannot find a planted effect reports "nothing here" in exactly
 * the same words as a probe examining an empty market.
 */
import { createHash } from "node:crypto";

export type HypothesisClass =
  | "LIQUIDITY_CONDITIONED_MOMENTUM"
  | "LOTTERY_MAX_EFFECT"
  | "HIGHER_MOMENT_SKEWNESS"
  | "LIQUIDITY_CONDITIONED_REVERSAL"
  | "IDIOSYNCRATIC_VOLATILITY"
  | "RETURN_VOLUME_REGIME";

export type ResearchStage = "HYPOTHESIS" | "RESEARCH_PROBE" | "REGISTERED_CAMPAIGN";

/**
 * Where the idea's prior comes from.
 *
 * A mechanism supported by Indian empirical literature and one invented by a language model must
 * not enter the queue with equal weight, and without this field they are indistinguishable once
 * both are prose.
 */
export type EvidenceBasis =
  | "LITERATURE"
  | "MARKET_STRUCTURE"
  | "PRIOR_MARKETPULSE_RESULT"
  | "NEW_THEORY";

export interface EconomicHypothesis {
  id: string;
  klass: HypothesisClass;
  title: string;

  /** 1. Why should this effect exist at all? */
  mechanism: string;
  /** 2. Who keeps taking the other side, and what constrains them? */
  counterpartyOrConstraint: string;
  /** 3. Why has competition not removed it? */
  persistenceReason: string;
  /** 4. Why this much historical information? */
  formationHorizon: string;
  /** 5. Why should information diffuse over this period? */
  holdingHorizon: string;
  /** 6. What magnitude would make economic sense, before measuring anything? */
  expectedGrossEffectBps: number;
  /** 7. What friction must it overcome? */
  expectedAllInCostBps: number;
  /** 8. At what turnover / ADV participation / capital does it stop being executable? */
  capacityConstraint: string;
  /** 9. What result causes the idea to be abandoned? */
  falsificationCondition: string;

  evidenceBasis: EvidenceBasis;
  sourceReferences: readonly string[];
  /**
   * The sign the mechanism predicts, BEFORE any measurement — and `UNKNOWN` when the literature
   * genuinely disagrees.
   *
   * A hypothesis registered with a directional prior it does not have invites the sign to be chosen
   * after the result, which is unfalsifiable. Where the evidence conflicts, the honest registration
   * is a question, and the probe reports the spread signed exactly as written.
   */
  priorDirection: "POSITIVE" | "NEGATIVE" | "UNKNOWN";
  /**
   * Where the idea came from, when it came from an observation rather than from reasoning.
   *
   * `postHoc: true` is permanent and cannot be cleared by a later good result. A hypothesis read
   * off a dataset can never claim to have been invented before that dataset was seen, and the
   * genealogy is what stops H08 quietly presenting itself as an independent idea about liquidity
   * once V01 has faded from memory.
   */
  postHoc?: boolean;
  derivedFromProbeId?: string;
  parentObservationId?: string;
  /** Instrument conditioning — the axis that distinguishes economically different variants. */
  conditioning: string;
  direction: "LONG_WINNERS" | "SHORT_WINNERS" | "LONG_LOSERS" | "CROSS_SECTIONAL_SPREAD";
  requiredData: readonly string[];
}

/**
 * The prior must predict at least this multiple of its own modelled friction.
 *
 * Two, not one. An idea whose expected effect merely equals its cost has no margin for the estimate
 * being optimistic — and hypothesis priors are optimistic, because they are written by someone who
 * already finds the idea attractive.
 */
export const MIN_EFFECT_TO_COST_RATIO = 2;

/** Illiquid effects look larger and cost more; the gate rises to meet that. */
export const ILLIQUID_EFFECT_TO_COST_RATIO = 3;

export type PlausibilityCode =
  | "PLAUSIBLE"
  | "NO_MECHANISM"
  | "NO_COUNTERPARTY"
  | "NO_PERSISTENCE_REASON"
  | "EFFECT_BELOW_COST_HURDLE"
  | "NO_FALSIFICATION_CONDITION"
  | "NO_CAPACITY_CONSTRAINT"
  | "REQUIRED_DATA_UNAVAILABLE";

export interface PlausibilityVerdict {
  code: PlausibilityCode;
  admitted: boolean;
  requiredRatio: number;
  actualRatio: number;
  reason: string;
}

/** A field that is blank, or filled with a placeholder, is an unanswered question. */
function answered(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 24) return false;
  return !/^(tbd|todo|unknown|n\/a|none)\b/i.test(trimmed);
}

/**
 * May this idea consume research effort at all?
 *
 * Every refusal here is free. Every refusal one level later costs a backtest, and one level after
 * that costs a permanent statistical trial.
 */
export function assessPlausibility(
  hypothesis: EconomicHypothesis,
  availableData: ReadonlySet<string>,
): PlausibilityVerdict {
  const illiquid = /illiquid|low.?liquidity|small.?cap|bottom (quintile|decile)/i.test(
    hypothesis.conditioning,
  );
  const requiredRatio = illiquid ? ILLIQUID_EFFECT_TO_COST_RATIO : MIN_EFFECT_TO_COST_RATIO;
  const actualRatio =
    hypothesis.expectedAllInCostBps <= 0
      ? Infinity
      : hypothesis.expectedGrossEffectBps / hypothesis.expectedAllInCostBps;

  const refuse = (code: PlausibilityCode, reason: string): PlausibilityVerdict => ({
    code,
    admitted: false,
    requiredRatio,
    actualRatio,
    reason,
  });

  if (!answered(hypothesis.mechanism)) {
    return refuse("NO_MECHANISM", "No stated reason the effect should exist.");
  }
  if (!answered(hypothesis.counterpartyOrConstraint)) {
    return refuse(
      "NO_COUNTERPARTY",
      "No stated counterparty or constraint. An effect with nobody on the other side is an artifact.",
    );
  }
  if (!answered(hypothesis.persistenceReason)) {
    return refuse(
      "NO_PERSISTENCE_REASON",
      "No reason competition has not removed it — the default expectation for any published effect.",
    );
  }
  if (!answered(hypothesis.capacityConstraint)) {
    return refuse(
      "NO_CAPACITY_CONSTRAINT",
      "No capacity limit. An effect that needs 30% of daily volume is not tradeable at any size.",
    );
  }
  if (!answered(hypothesis.falsificationCondition)) {
    return refuse(
      "NO_FALSIFICATION_CONDITION",
      "No result would abandon the idea, so no test of it can fail.",
    );
  }

  const missing = hypothesis.requiredData.filter((d) => !availableData.has(d));
  if (missing.length > 0) {
    return refuse(
      "REQUIRED_DATA_UNAVAILABLE",
      `Needs data this deployment does not hold: ${missing.join(", ")}. Missing is not zero.`,
    );
  }

  if (actualRatio < requiredRatio) {
    return refuse(
      "EFFECT_BELOW_COST_HURDLE",
      `Predicts ${hypothesis.expectedGrossEffectBps} bps against ${hypothesis.expectedAllInCostBps} bps ` +
        `of friction (${actualRatio.toFixed(2)}x); this conditioning requires ${requiredRatio}x. ` +
        `The idea may be true and still not worth a trial.`,
    );
  }

  return {
    code: "PLAUSIBLE",
    admitted: true,
    requiredRatio,
    actualRatio,
    reason:
      `Mechanism, counterparty, persistence, capacity and falsification are all stated, and the ` +
      `prior clears ${requiredRatio}x friction at ${actualRatio.toFixed(2)}x.`,
  };
}

/**
 * An identity over the ECONOMIC CONTENT of a hypothesis, not its wording.
 *
 * Deliberately excludes `title`, `mechanism` prose and `sourceReferences`: an agent that rewrites
 * "6-month momentum" as "medium-term price continuation" has generated the same idea, and must
 * collide with its own earlier rejection rather than slip past as novel. What it includes is what
 * actually makes two ideas different research: the class, what is conditioned on, which direction
 * the spread is taken, and over what horizons.
 */
export function semanticFingerprint(
  hypothesis: Pick<
    EconomicHypothesis,
    "klass" | "conditioning" | "direction" | "formationHorizon" | "holdingHorizon"
  >,
): string {
  // Normalized so casing, spacing and filler words cannot manufacture a distinct identity.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(the|a|an|of|on|in|by|with|and|to|for|at|over|per)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const canonical = [
    hypothesis.klass,
    norm(hypothesis.conditioning),
    hypothesis.direction,
    norm(hypothesis.formationHorizon),
    norm(hypothesis.holdingHorizon),
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export type PriorArtStatus =
  | "NEVER_TESTED"
  | "PREVIOUSLY_REJECTED"
  | "RELATED_EXISTING_HYPOTHESIS"
  | "ALREADY_ACTIVE";

/** Why an economically equivalent idea was abandoned, so it is not re-derived from scratch. */
export type RejectionReason =
  | "NO_GROSS_EDGE"
  | "FRICTION"
  | "DEPENDENCE_AWARE_INFERENCE"
  | "PARAMETER_INSTABILITY"
  | "PBO"
  | "DSR"
  | "HOLDOUT_FAILURE"
  | "INSUFFICIENT_EFFECTIVE_N"
  | "IMPLAUSIBLE_PRIOR";

export interface PriorArt {
  status: PriorArtStatus;
  fingerprint: string;
  rejectionReason?: RejectionReason;
  note?: string;
  relatedIds: readonly string[];
}

export interface HypothesisRecord {
  id: string;
  fingerprint: string;
  klass: HypothesisClass;
  stage: ResearchStage;
  rejectionReason?: RejectionReason;
  note?: string;
}

/**
 * Has an economically equivalent idea already been settled?
 *
 * This is where the system learns. Not by tuning parameters until something turns green — by
 * remembering why previous ideas died, so research budget is not spent re-deriving a known failure
 * under a new name.
 */
export function findPriorArt(
  hypothesis: Pick<
    EconomicHypothesis,
    "klass" | "conditioning" | "direction" | "formationHorizon" | "holdingHorizon"
  >,
  known: readonly HypothesisRecord[],
): PriorArt {
  const fingerprint = semanticFingerprint(hypothesis);
  const exact = known.find((k) => k.fingerprint === fingerprint);

  if (exact) {
    if (exact.rejectionReason) {
      return {
        status: "PREVIOUSLY_REJECTED",
        fingerprint,
        rejectionReason: exact.rejectionReason,
        note: exact.note,
        relatedIds: [exact.id],
      };
    }
    return { status: "ALREADY_ACTIVE", fingerprint, relatedIds: [exact.id] };
  }

  // Same class and direction is not the same hypothesis, but it is close enough that a reader
  // should see it before spending anything — 3m/1m and 6m/1m momentum are different protocol
  // choices, and knowing one already failed is relevant to prioritising the other.
  const related = known
    .filter((k) => k.klass === hypothesis.klass)
    .map((k) => k.id);

  return related.length > 0
    ? { status: "RELATED_EXISTING_HYPOTHESIS", fingerprint, relatedIds: related }
    : { status: "NEVER_TESTED", fingerprint, relatedIds: [] };
}
