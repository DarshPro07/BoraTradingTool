import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordTrial } from "@/lib/knowledge/repository";
import { HOLDOUT_QUERY_BUDGET, holdoutUsage, requestHoldout, type HoldoutDenial } from "./gauntlet";

/**
 * The sealed holdout's *verdict*, which had nowhere to live.
 *
 * `holdout_ledger` answers "was it queried, and how often" — the budget accounting that stops the
 * one unbiased sample being turned into another training set. It carries no pass or fail. So
 * `StageEvidence.holdoutCleared` had no source anywhere in the schema, `advanceStrategy` could
 * never leave `validated`, and the two rungs above it — `paper_forward` and `owner_review` — were
 * unreachable by construction. Five strategies sitting at `draft` was the visible symptom; a
 * ladder whose top half nothing could climb was the cause.
 *
 * The verdict is recorded as a `sealed_holdout` trial rather than a new column because migrations
 * here are owner-reviewed and hardcoded in `lib/db/migrate.ts`: a table added without registering
 * it there appears applied and silently is not. `trials` already has `kind`, `verdict`, `reason`
 * and `metrics`, which is exactly the shape needed.
 *
 * ## The budget is enforced before the result is recorded
 *
 * `requestHoldout` is called first and its denial is returned unchanged. Recording a verdict for a
 * query that was refused would create evidence that the holdout cleared a strategy it never saw.
 */

export type HoldoutOutcome =
  | { recorded: true; passed: boolean; trialId: number; queriesUsed: number }
  | { recorded: false; denial: HoldoutDenial };

export interface HoldoutResultInput {
  holdoutId: string;
  specId: string;
  actor: string;
  passed: boolean;
  /** Why it passed or failed, in the reviewer's words. Stored on the trial. */
  reason: string;
  metrics?: Record<string, number | string | boolean>;
  /** Hash of the result, so the ledger row and the trial describe the same computation. */
  resultHash?: string;
}

export function recordHoldoutOutcome(input: HoldoutResultInput): HoldoutOutcome {
  const grant = requestHoldout(input.holdoutId, input.specId, input.actor, input.resultHash);
  if (!grant.granted) return { recorded: false, denial: grant };

  const trialId = recordTrial({
    strategySpecId: input.specId,
    kind: "sealed_holdout",
    verdict: input.passed ? "pass" : "fail",
    reason: input.reason,
    metrics: input.metrics,
    actor: input.actor,
  });

  return { recorded: true, passed: input.passed, trialId, queriesUsed: holdoutUsage(input.specId).length };
}

export interface HoldoutStanding {
  /** True once a verdict exists. Null-free: absence is `cleared === null`, not `false`. */
  cleared: boolean | null;
  /** True when the budget is spent with no verdict recorded — a query happened and was lost. */
  exhausted: boolean;
  queriesUsed: number;
}

/**
 * What the holdout says about one strategy.
 *
 * `cleared` is `null` when the holdout has not been queried — deliberately not `false`, which the
 * ladder reads as "failed the holdout" and buries on. An unasked question is not a negative answer.
 */
export function holdoutStanding(specId: string): HoldoutStanding {
  const queriesUsed = holdoutUsage(specId).length;
  const verdicts = getDb()
    .select()
    .from(schema.trials)
    .where(eq(schema.trials.strategySpecId, specId))
    .all()
    .filter((trial) => trial.kind === "sealed_holdout");

  if (verdicts.length === 0) {
    return {
      cleared: null,
      // The budget is spent but no verdict was written: the query happened and its result was
      // lost. Treated as exhausted so the ladder buries rather than re-queries, which is the one
      // thing the budget exists to prevent.
      exhausted: queriesUsed >= HOLDOUT_QUERY_BUDGET,
      queriesUsed,
    };
  }

  // Earliest verdict wins. A second one should be impossible — the budget is one — but if two
  // ever exist, the first is the one drawn against an unseen sample.
  const first = verdicts.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0];
  return { cleared: first.verdict === "pass", exhausted: false, queriesUsed };
}
