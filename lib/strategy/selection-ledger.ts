import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/brain/event-bus";
import type { StrategyDsl } from "./dsl";
import {
  configurationFingerprint,
  identityFor,
  researchIdentityReady,
  validationStanding,
} from "./research-identity";

/**
 * What has been spent, and what may still be.
 *
 * Two irreversible resources live here:
 *
 *   - **selection trials** — every configuration tested and permitted to influence which candidate
 *     was chosen. This is the `N` in the deflated Sharpe ratio, and it only ever grows.
 *   - **sealed-holdout entitlement** — the single look each family and each campaign gets at data
 *     that was never used for selection.
 *
 * Neither can be refunded. A trial permanently raises the bar for its family; a holdout read
 * permanently contaminates the only unbiased estimate available. So both are recorded before the
 * result they authorise is computed, and both are enforced by database constraints rather than by
 * application logic that a new caller could forget to consult.
 */

/** A trial that could not influence selection — a crash, an outage — still records, marked so. */
export interface RecordTrialInput {
  specId: string;
  dsl: StrategyDsl;
  experimentRunId?: string;
  selectionEligible?: boolean;
  reason?: string;
  evidenceHash?: string;
  /** 13b: the dataset snapshot the trial's evidence was replayed on. */
  datasetSnapshotId?: string;
  at?: Date;
}

export type RecordTrialResult =
  | { recorded: true; trialId: string; alreadyCounted: boolean }
  | { recorded: false; reason: string };

/**
 * Record one tested configuration against its family.
 *
 * Idempotent on `(campaign, family, configurationFingerprint)`: re-running an identical
 * configuration is not a second search and must not inflate `N`. Changing a single threshold is a
 * different fingerprint and does count, because both results were on the table when the winner was
 * picked.
 */
export function recordSelectionTrial(input: RecordTrialInput): RecordTrialResult {
  const standing = validationStanding(input.specId);
  if (standing.identity === null) {
    // Fail closed. A trial with no family cannot be counted against anything, and silently
    // dropping it would understate N for whichever family it really belonged to.
    return { recorded: false, reason: standing.reason };
  }

  const fingerprint = configurationFingerprint(input.dsl);
  const at = input.at ?? new Date();
  const db = getDb();

  const existing = db
    .select()
    .from(schema.selectionTrials)
    .where(
      and(
        eq(schema.selectionTrials.researchCampaignId, standing.identity.campaignId),
        eq(schema.selectionTrials.strategyFamilyId, standing.identity.familyId),
        eq(schema.selectionTrials.configurationFingerprint, fingerprint),
      ),
    )
    .get();

  if (existing) return { recorded: true, trialId: existing.id, alreadyCounted: true };

  // Hashed over the full (campaign, family, fingerprint) triple — the previous
  // `familyId.slice(0, 8)` prefix collided for families sharing an eight-character prefix that
  // test the same configuration, and the second family's legitimate trial then crashed on the
  // primary key. Found by the 13b determinism test; same defect class as the holdout accessId.
  const trialId = `trial_${createHash("sha256")
    .update(`${standing.identity.campaignId}|${standing.identity.familyId}|${fingerprint}`, "utf8")
    .digest("hex")
    .slice(0, 20)}`;
  db.insert(schema.selectionTrials)
    .values({
      id: trialId,
      researchCampaignId: standing.identity.campaignId,
      strategyFamilyId: standing.identity.familyId,
      strategySpecId: input.specId,
      configurationFingerprint: fingerprint,
      experimentRunId: input.experimentRunId ?? null,
      selectionEligible: input.selectionEligible === false ? 0 : 1,
      reason: input.reason ?? null,
      evidenceHash: input.evidenceHash ?? null,
      datasetSnapshotId: input.datasetSnapshotId ?? null,
      startedAt: at,
      completedAt: at,
    })
    .run();

  return { recorded: true, trialId, alreadyCounted: false };
}

export type TrialCount =
  | { known: true; trials: number; campaignId: string; familyId: string; reason: string }
  | { known: false; reason: string };

/**
 * The multiple-testing denominator for a strategy.
 *
 * Counts **distinct configurations tried within the family**, not specs and not gauntlet stages.
 * Both of those have been the bug before: counting stage rows made the bar scale with how many
 * gates happen to execute, and counting specs gave a search that spawned two hundred siblings a
 * denominator of one apiece.
 *
 * Returns `known: false` rather than a number when identity is missing. A caller that wants a
 * number must handle not having one — `?? 1` is the defect this replaces, and returning 1 here
 * would let it back in at every call site at once.
 */
export function selectionTrialCount(specId: string): TrialCount {
  if (!researchIdentityReady()) {
    return {
      known: false,
      reason:
        "Research-identity tables are not installed, so trials cannot be counted against a family. " +
        "Refused rather than defaulted to 1.",
    };
  }

  const identity = identityFor(specId);
  if (identity === null) {
    return {
      known: false,
      reason:
        `${specId} has no declared family, so there is nothing to count its trials against. ` +
        "A denominator of 1 would claim this strategy was the only thing ever tried.",
    };
  }

  const trials = getDb()
    .select()
    .from(schema.selectionTrials)
    .where(
      and(
        eq(schema.selectionTrials.researchCampaignId, identity.campaignId),
        eq(schema.selectionTrials.strategyFamilyId, identity.familyId),
      ),
    )
    .all()
    .filter((row) => row.selectionEligible === 1).length;

  return {
    known: true,
    trials,
    campaignId: identity.campaignId,
    familyId: identity.familyId,
    reason:
      `${trials} distinct configuration(s) tested in family ${identity.familyId}. Every one of them ` +
      "was available when a winner was chosen, so every one belongs in the denominator.",
  };
}

export interface HoldoutRequest {
  holdoutGenerationId: string;
  specId: string;
  requestFingerprint: string;
  codeHash?: string;
  datasetHash?: string;
  /** 13b: the dataset snapshot the holdout query ran against. */
  datasetSnapshotId?: string;
  experimentRunId?: string;
  at?: Date;
}

export type HoldoutEntitlement =
  | { granted: true; accessId: string }
  | { granted: false; code: "NO_IDENTITY" | "FAMILY_BUDGET_SPENT" | "CAMPAIGN_BUDGET_SPENT" | "SCHEMA_MISSING"; reason: string };

/**
 * Consume one look at sealed data, or refuse.
 *
 * ## Two gates, and why one is not enough
 *
 * The **family** gate stops `v1 → peek → rename to v2 → peek again`. That is the attack the old
 * per-spec key permitted outright.
 *
 * The **campaign** gate stops the subtler one: `family A → peek → learn the result → invent family
 * B informed by what you learned → peek again`. Every family individually obeys its one-look rule
 * while the research programme as a whole overfits the holdout. Splitting a family must not mint
 * fresh entitlement, so both gates must permit.
 *
 * ## Why the insert *is* the check
 *
 * The budgets are `UNIQUE` indexes on `(holdout_generation_id, campaign)` and
 * `(holdout_generation_id, family)`. Two concurrent requests both pass an application-level "has it
 * been used?" query and then both try to insert; exactly one succeeds. That is what makes the
 * entitlement atomic without a lock, and it is why the pre-checks below are for *message quality*
 * only — the constraint is the enforcement, and it holds even if a future caller skips them.
 *
 * The row is written **before** the result is computed. A crash between consuming and computing
 * must lose the result, never the record of the look: a look that happened cannot be un-taken, and
 * the failure that costs a result is far cheaper than the one that hands out a second peek.
 */
export function requestHoldoutAccess(request: HoldoutRequest): HoldoutEntitlement {
  if (!researchIdentityReady()) {
    return {
      granted: false,
      code: "SCHEMA_MISSING",
      reason:
        "Research-identity tables are not installed, so holdout entitlement cannot be gated by " +
        "family or campaign. Refused: an ungated read is exactly what corrupts a holdout.",
    };
  }

  const identity = identityFor(request.specId);
  if (identity === null) {
    return {
      granted: false,
      code: "NO_IDENTITY",
      reason:
        `${request.specId} has no declared family, so a read cannot be charged to anyone. ` +
        "Refused rather than charged to the spec id, which is the key that made renaming a loophole.",
    };
  }

  const db = getDb();
  const at = request.at ?? new Date();

  const priorForGeneration = db
    .select()
    .from(schema.holdoutAccess)
    .where(eq(schema.holdoutAccess.holdoutGenerationId, request.holdoutGenerationId))
    .all();

  const familySpent = priorForGeneration.find((row) => row.strategyFamilyId === identity.familyId);
  if (familySpent) {
    return {
      granted: false,
      code: "FAMILY_BUDGET_SPENT",
      reason:
        `Family ${identity.familyId} has already looked at holdout generation ` +
        `${request.holdoutGenerationId} (as ${familySpent.strategySpecId}). A second look would turn ` +
        "the only unbiased estimate this family has into another in-sample result. Renaming, " +
        "copying or re-versioning the strategy does not restore it.",
    };
  }

  const campaignSpent = priorForGeneration.find((row) => row.researchCampaignId === identity.campaignId);
  if (campaignSpent) {
    return {
      granted: false,
      code: "CAMPAIGN_BUDGET_SPENT",
      reason:
        `Campaign ${identity.campaignId} has already looked at holdout generation ` +
        `${request.holdoutGenerationId} (family ${campaignSpent.strategyFamilyId}). Creating a new ` +
        "family within a campaign that has already seen this data does not create a fresh sample — " +
        "the new family was conceived by someone who knew the result.",
    };
  }

  // Hashed, not built from truncated prefixes. `holdout_2026_h1` and `holdout_2026_h2` both slice
  // to `holdout_`, so a prefix id collided on the primary key and reported a *legitimate* second
  // holdout generation as a spent budget — silently making every future sample unusable. Caught by
  // the test that asserts the gates are not too blunt, which is why that test exists.
  const accessId = `hoa_${createHash("sha256")
    .update(`${request.holdoutGenerationId} ${identity.campaignId} ${identity.familyId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
  try {
    db.insert(schema.holdoutAccess)
      .values({
        id: accessId,
        holdoutGenerationId: request.holdoutGenerationId,
        researchCampaignId: identity.campaignId,
        strategyFamilyId: identity.familyId,
        strategySpecId: request.specId,
        experimentRunId: request.experimentRunId ?? null,
        requestFingerprint: request.requestFingerprint,
        codeHash: request.codeHash ?? null,
        datasetHash: request.datasetHash ?? null,
        datasetSnapshotId: request.datasetSnapshotId ?? null,
        requestedAt: at,
        consumedAt: at,
        resultDisclosed: 0,
        reason: null,
      })
      .run();
  } catch (caught) {
    // The UNIQUE index fired — another request won the race between the checks above and this
    // insert. Reported as a spent budget rather than a crash, because that is exactly what it is.
    const message = caught instanceof Error ? caught.message : String(caught);
    if (/UNIQUE constraint failed/i.test(message)) {
      return {
        granted: false,
        code: /family/i.test(message) ? "FAMILY_BUDGET_SPENT" : "CAMPAIGN_BUDGET_SPENT",
        reason:
          "Another request consumed this holdout entitlement concurrently. The database constraint " +
          "settled it, which is the point: exactly one look is possible however many callers ask at once.",
      };
    }
    throw caught;
  }

  emit({ kind: "HOLDOUT_ACCESSED", specId: request.specId, granted: true });

  return { granted: true, accessId };
}
