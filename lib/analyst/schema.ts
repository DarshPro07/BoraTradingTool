import { z } from "zod";
import { EPISTEMIC_STATUSES } from "@/lib/knowledge/types";
import { hasValidEvidenceHash, type EvidencePackage } from "@/lib/ai/evidence";

export const STANCES = ["bullish", "bearish", "neutral", "abstain"] as const;
export type Stance = (typeof STANCES)[number];

/**
 * A single piece of evidence behind an analysis. The epistemic status is mandatory:
 * the analyst must always distinguish what is known from what is inferred.
 */
export const EvidenceItemSchema = z
  .object({
    statement: z.string().trim().min(3).max(600),
    epistemicStatus: z.enum(EPISTEMIC_STATUSES),
    citation: z.string().trim().max(120).optional(),
    source: z.string().trim().max(200).optional(),
  })
  .strict();
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const DebateSchema = z
  .object({
    bull: z.array(z.string().trim().min(3).max(400)).max(10).default([]),
    bear: z.array(z.string().trim().min(3).max(400)).max(10).default([]),
    neutral: z.array(z.string().trim().min(3).max(400)).max(10).default([]),
  })
  .strict();

export const LevelsSchema = z
  .object({
    entry: z.number().finite().positive().optional(),
    stop: z.number().finite().positive().optional(),
    target: z.number().finite().positive().optional(),
  })
  .strict();

export const AnalystRecordSchema = z
  .object({
    instrumentId: z.string().trim().min(1).max(64),
    question: z.string().trim().max(500).optional(),
    stance: z.enum(STANCES),
    conviction: z.number().min(0).max(1),
    summary: z.string().trim().min(10).max(2_000),
    debate: DebateSchema,
    evidence: z.array(EvidenceItemSchema).max(30).default([]),
    risks: z.array(z.string().trim().min(3).max(400)).max(10).default([]),
    invalidation: z.array(z.string().trim().min(3).max(400)).max(10).default([]),
    levels: LevelsSchema.optional(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AnalystRecord = z.infer<typeof AnalystRecordSchema>;

export type AnalystRejectionCode =
  | "NO_INVALIDATION"
  | "UNSUPPORTED_STANCE"
  | "UNRESOLVED_CITATION"
  | "EVIDENCE_INSTRUMENT_MISMATCH"
  | "INVALID_EVIDENCE_HASH"
  | "UNTRUSTED_EPISTEMIC_STATUS"
  | "MISSING_COUNTERCASE"
  | "STOP_ABOVE_ENTRY"
  | "STOP_BELOW_ENTRY";

export interface AnalystValidation {
  ok: boolean;
  code?: AnalystRejectionCode;
  message?: string;
}

/**
 * Epistemic guardrails applied on top of schema validation. These encode the rules that
 * make an analysis trustworthy rather than merely well-formed.
 */
export function validateAnalystRecord(record: AnalystRecord, evidencePackage: EvidencePackage): AnalystValidation {
  if (record.snapshotHash !== evidencePackage.snapshotHash || evidencePackage.instrument.id !== record.instrumentId) {
    return {
      ok: false,
      code: "EVIDENCE_INSTRUMENT_MISMATCH",
      message: "The evidence package belongs to a different instrument.",
    };
  }
  if (!hasValidEvidenceHash(evidencePackage)) {
    return { ok: false, code: "INVALID_EVIDENCE_HASH", message: "The evidence package hash does not match its content." };
  }
  if (record.stance === "abstain") return { ok: true };

  if (record.evidence.some((item) => item.epistemicStatus === "known" || item.epistemicStatus === "historically_observed")) {
    return {
      ok: false,
      code: "UNTRUSTED_EPISTEMIC_STATUS",
      message: "Free-form analyst statements must remain inferred; only canonical server evidence is observed.",
    };
  }

  const packageItems = new Map(evidencePackage.items.map((item) => [item.id, item]));
  const cited = record.evidence;
  const unresolved = cited.find((item) => !item.citation || !packageItems.has(item.citation));
  if (unresolved) {
    return {
      ok: false,
      code: "UNRESOLVED_CITATION",
      message: "Every directional evidence statement must cite an item in the exact server evidence package.",
    };
  }
  const ineligibleQualities = new Set(["STALE", "CONFLICTED", "UNAVAILABLE", "AUTH_REQUIRED"]);
  const observed = cited.filter((item) => {
    const source = item.citation ? packageItems.get(item.citation) : undefined;
    return source && !ineligibleQualities.has(source.quality);
  });
  if (observed.length === 0) {
    return {
      ok: false,
      code: "UNSUPPORTED_STANCE",
      message:
        "A directional stance requires at least one eligible item from the server evidence package. " +
        "Unsupported interpretation alone is not enough — choose abstain instead.",
    };
  }

  if (record.invalidation.length === 0) {
    return {
      ok: false,
      code: "NO_INVALIDATION",
      message: "State at least one condition that would prove this analysis wrong.",
    };
  }

  const counterCase = record.stance === "bullish" ? record.debate.bear : record.debate.bull;
  if (record.stance !== "neutral" && counterCase.length === 0) {
    return {
      ok: false,
      code: "MISSING_COUNTERCASE",
      message: `A ${record.stance} stance must record the opposing case before it is accepted.`,
    };
  }

  const { entry, stop } = record.levels ?? {};
  if (entry !== undefined && stop !== undefined) {
    if (record.stance === "bullish" && stop >= entry) {
      return { ok: false, code: "STOP_ABOVE_ENTRY", message: "A long stop must sit below the entry." };
    }
    if (record.stance === "bearish" && stop <= entry) {
      return { ok: false, code: "STOP_BELOW_ENTRY", message: "A short stop must sit above the entry." };
    }
  }

  return { ok: true };
}

/** Distribution of epistemic statuses, rendered as a confidence strip in the UI. */
export function epistemicProfile(record: AnalystRecord): Record<string, number> {
  const profile: Record<string, number> = {};
  for (const status of EPISTEMIC_STATUSES) profile[status] = 0;
  for (const item of record.evidence) profile[item.epistemicStatus] += 1;
  return profile;
}
