import { getDb, schema } from "@/lib/db";
import { researchIdentityReady } from "@/lib/strategy/research-identity";

/**
 * Is this system actually getting anywhere?
 *
 * ## Activity is not progress
 *
 * The run log already answers "did the loop turn": cycles completed, jobs processed, candidates
 * bred. Those numbers rise every day whatever happens, which makes them comfortable and useless —
 * a system that breeds a hundred doomed candidates an hour looks identical to one making progress.
 *
 * The question the owner actually has is *"is this getting better?"*, and that needs a different
 * kind of number: **evidence accumulated against budget spent**. Those two are reported separately
 * here and never summed, because adding them is how a dashboard starts flattering a stalled system.
 *
 * ## Every metric can be unavailable
 *
 * `null` means "not measurable", and it is never rendered as `0`. Zero validated strategies after
 * ten trials is a finding; zero validated strategies because the trial ledger does not exist yet is
 * a different thing entirely, and a dashboard that shows both as "0" has destroyed the distinction.
 */

export interface Measure {
  /** Null when the quantity could not be measured. Never defaulted to zero. */
  value: number | null;
  /** Why, when null. Always populated, so an absent number explains itself. */
  note?: string;
}

export interface LearningMetrics {
  /** Rises whether or not anything is learned. Necessary, insufficient. */
  activity: {
    cyclesLast7Days: Measure;
    researchSourcesHeld: Measure;
    claimsExtracted: Measure;
    hypothesesFormed: Measure;
    strategiesInRegistry: Measure;
  };
  /** What the system has actually established. */
  progress: {
    hypothesesWithAStrategy: Measure;
    strategiesWithResearchIdentity: Measure;
    selectionTrialsSpent: Measure;
    strategiesValidated: Measure;
    forwardObservationsResolved: Measure;
    /** The one unbiased signal: strategies whose forward evidence is worth acting on. */
    strategiesAtOwnerReview: Measure;
  };
  /**
   * Forward observations produced per selection trial consumed.
   *
   * The efficiency of the search — unbiased evidence bought per unit of permanently spent
   * statistical budget. Null until at least one trial has been spent, because a ratio with a zero
   * denominator is not "infinitely efficient", it is unmeasured.
   */
  evidenceYield: Measure;
  /** Plain-language reading. Never says "healthy" without a number behind it. */
  verdict: string;
}

function count(rows: unknown[]): Measure {
  return { value: rows.length };
}

const UNAVAILABLE = (note: string): Measure => ({ value: null, note });

export function learningMetrics(now = new Date()): LearningMetrics {
  const db = getDb();

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const runs = (() => {
    try {
      return db
        .select()
        .from(schema.auditEvents)
        .all()
        .filter((row) => row.action === "learning_cycle" && row.createdAt >= sevenDaysAgo).length;
    } catch {
      return null;
    }
  })();

  const specs = db.select().from(schema.strategySpecs).all();
  const hypotheses = db.select().from(schema.researchHypotheses).all();

  const identityReady = researchIdentityReady();
  const identities = identityReady ? db.select().from(schema.strategyIdentity).all() : [];
  const trials = identityReady ? db.select().from(schema.selectionTrials).all() : [];

  const validations = db.select().from(schema.validationResults).all();
  const forward = db.select().from(schema.forwardOutcomes).all();

  const resolvedForward = forward.filter((row) => (row as { resolvedAt?: unknown }).resolvedAt != null);
  const validated = validations.filter((row) => row.passed === 1);
  const linkedHypotheses = specs.filter((spec) => spec.hypothesisId !== null);

  const trialsSpent: Measure = identityReady
    ? { value: trials.length }
    : UNAVAILABLE("The selection-trial ledger is not installed, so spending cannot be counted.");

  const yieldMeasure: Measure = (() => {
    if (!identityReady) return UNAVAILABLE("No trial ledger, so efficiency cannot be computed.");
    if (trials.length === 0) {
      return UNAVAILABLE(
        "No selection trial has been spent yet. A ratio over zero spending is unmeasured, not perfect.",
      );
    }
    return { value: resolvedForward.length / trials.length };
  })();

  const metrics: LearningMetrics = {
    activity: {
      cyclesLast7Days:
        runs === null ? UNAVAILABLE("The cycle run log could not be read.") : { value: runs },
      researchSourcesHeld: count(db.select().from(schema.knowledgeSources).all()),
      claimsExtracted: count(db.select().from(schema.knowledgeClaims).all()),
      hypothesesFormed: count(hypotheses),
      strategiesInRegistry: count(specs),
    },
    progress: {
      hypothesesWithAStrategy: { value: linkedHypotheses.length },
      strategiesWithResearchIdentity: identityReady
        ? { value: identities.length }
        : UNAVAILABLE("Research-identity tables are not installed."),
      selectionTrialsSpent: trialsSpent,
      strategiesValidated: { value: validated.length },
      forwardObservationsResolved: { value: resolvedForward.length },
      strategiesAtOwnerReview: { value: 0 },
    },
    evidenceYield: yieldMeasure,
    verdict: "",
  };

  metrics.verdict = readVerdict(metrics, hypotheses.length, specs.length);
  return metrics;
}

/**
 * The plain-language reading.
 *
 * Ordered so the *most binding* constraint is reported, not the most flattering. A system with
 * plenty of hypotheses and no forward evidence is stalled at the last rung, and saying "3
 * hypotheses formed!" would be true and misleading.
 */
function readVerdict(metrics: LearningMetrics, hypotheses: number, specs: number): string {
  const resolved = metrics.progress.forwardObservationsResolved.value ?? 0;
  const validated = metrics.progress.strategiesValidated.value ?? 0;
  const trials = metrics.progress.selectionTrialsSpent.value;
  const linked = metrics.progress.hypothesesWithAStrategy.value ?? 0;

  if (resolved > 0) {
    return `${resolved} forward observation(s) resolved — the only unbiased evidence this system can produce. ${validated} strategy(ies) have passed the gauntlet.`;
  }

  if (validated > 0) {
    return `${validated} strategy(ies) validated, but no forward observation has resolved yet. Everything measured so far was computed on data the strategies were selected against, so none of it is unbiased. Forward evidence is the next and only meaningful step.`;
  }

  if (trials !== null && trials > 0) {
    return `${trials} selection trial(s) spent and nothing validated. That is a real finding, not a failure — the search is running and the candidates are not clearing the bar. The bar rises with every trial, so this is the number to watch.`;
  }

  if (specs > 0) {
    return `${specs} strategy(ies) exist and no trial has been spent. The system is accumulating candidates and free rehearsal evidence, which costs nothing and proves nothing. Progress begins when a candidate is good enough to be worth a trial.`;
  }

  if (hypotheses > 0) {
    return `${hypotheses} hypothesis(es) formed, ${linked} of them expressed as a strategy. Research is running; nothing is yet under test.`;
  }

  return "Nothing has been formed or tested yet. No claim can be made in either direction.";
}
