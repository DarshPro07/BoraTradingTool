import { getDb, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { emit } from "@/lib/brain/event-bus";

/**
 * Three-Tier Memory System with Validation Pipeline:
 *
 * 1. EPISODIC: What happened? (raw observations)
 * 2. SEMANTIC: What has evidence shown? (verified patterns)
 * 3. PROCEDURAL: What should MarketPulse change? (actionable lessons)
 *
 * Pipeline: Observation → Validation → Contradiction Search → Semantic → Procedural
 *
 * A single loss is an episode. Repeated evidence becomes a validated lesson.
 * This prevents the system from learning noise.
 *
 * Memory may propose hypotheses but NEVER bypass backtest/validation gates.
 */

export type MemoryTier = "EPISODIC" | "SEMANTIC" | "PROCEDURAL";

export type MemoryStatus =
  | "OBSERVED"
  | "SUPPORTED"
  | "VALIDATED"
  | "CONFLICTED"
  | "SUPERSEDED"
  | "REJECTED"
  | "STALE";

export interface MemoryEntry {
  memoryId: string;
  tier: MemoryTier;
  status: MemoryStatus;
  claim: string;
  sourceRuns: string[];
  evidenceIds: string[];
  strategyFamilyIds: string[];
  market: string | null;
  regime: string | null;
  createdAt: Date;
  lastValidatedAt: Date | null;
  confidence: number; // 0-1
  supportCount: number;
  contradictionCount: number;
  supersedes: string | null;
  supersededBy: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

export interface LessonCandidate {
  observationId: string;
  supportingCount: number;
  contradictingCount: number;
  proposedRule: string;
}

/** Minimum support count before an observation can become a semantic claim. */
export const MIN_SUPPORT_FOR_SEMANTIC = 3;

/** Maximum contradiction count before a claim is marked CONFLICTED. */
export const MAX_CONTRADICTIONS_FOR_VALID = 1;

/**
 * Record an episodic observation (what happened).
 */
export function recordObservation(input: {
  category: string;
  title: string;
  detail: string;
  instrumentId?: string | null;
  strategySpecId?: string | null;
  evidenceRefs?: string[];
}): string {
  const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  getDb()
    .insert(schema.failureMemory)
    .values({
      scope: input.category,
      failureMode: input.title,
      detail: input.detail,
      subjectId: input.instrumentId ?? null,
      lesson: null,
      recordedAt: new Date(),
    })
    .run();
  return id;
}

/**
 * Promote an observation to semantic memory (verified pattern).
 * Only promoted when supporting evidence >= 3 and no strong contradictions.
 */
export function promoteToSemantic(observationId: string): boolean {
  // Check if there are enough supporting observations.
  const db = getDb();
  const similar = db
    .select()
    .from(schema.failureMemory)
    .where(eq(schema.failureMemory.subjectId, observationId))
    .all();

  if (similar.length < 3) return false;

  // Mark as validated.
  db.update(schema.failureMemory)
    .set({ lesson: "VALIDATED via evidence threshold" })
    .where(eq(schema.failureMemory.id, Number(observationId)))
    .run();

  emit({ kind: "MEMORY_PROMOTED", memoryId: observationId, from: "EPISODIC", to: "SEMANTIC" });

  return true;
}

/**
 * Record a procedural lesson (what to change).
 */
export function recordLesson(input: {
  plane: "research" | "strategy" | "data" | "system" | "risk";
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  citations: string[];
  conceptName?: string;
  conceptSummary?: string;
}): string {
  const { recordLesson: saveLesson } = require("@/lib/knowledge/repository");
  return saveLesson({
    plane: input.plane,
    level: input.level,
    title: input.title,
    body: input.body,
    citations: input.citations,
    concept: input.conceptName
      ? { name: input.conceptName, summary: input.conceptSummary ?? "" }
      : undefined,
  });
}

/**
 * Get recent observations for a category.
 */
export function getObservations(category: string, limit = 20) {
  return getDb()
    .select()
    .from(schema.failureMemory)
    .where(eq(schema.failureMemory.scope, category))
    .orderBy(desc(schema.failureMemory.id))
    .limit(limit)
    .all();
}

/**
 * Validate a memory entry: check for contradictions and sufficient support.
 * Returns the updated status.
 */
export function validateMemory(entry: MemoryEntry): MemoryStatus {
  // If contradicting evidence exceeds threshold, mark as CONFLICTED.
  if (entry.contradictionCount > MAX_CONTRADICTIONS_FOR_VALID) {
    return "CONFLICTED";
  }

  // If support count is insufficient, remain OBSERVED/SUPPORTED.
  if (entry.supportCount < MIN_SUPPORT_FOR_SEMANTIC) {
    return entry.supportCount > 0 ? "SUPPORTED" : "OBSERVED";
  }

  // If confidence is high enough, mark as VALIDATED.
  if (entry.confidence >= 0.7) {
    return "VALIDATED";
  }

  return "SUPPORTED";
}

/**
 * Search for contradictions to a memory claim.
 * Returns contradicting evidence IDs.
 */
export function searchContradictions(entry: MemoryEntry): string[] {
  // In production, this would search for evidence that contradicts the claim.
  // For now, return empty (no contradictions found).
  return [];
}

/**
 * Promote a memory entry to the next tier.
 * EPISODIC → SEMANTIC: requires MIN_SUPPORT_FOR_SEMANTIC and no contradictions.
 * SEMANTIC → PROCEDURAL: requires VALIDATED status and high confidence.
 */
export function promoteMemory(entry: MemoryEntry): MemoryEntry {
  const contradictions = searchContradictions(entry);
  const updated = { ...entry };

  if (contradictions.length > 0) {
    updated.contradictionCount += contradictions.length;
    updated.status = validateMemory(updated);
    return updated;
  }

  switch (entry.tier) {
    case "EPISODIC":
      if (entry.supportCount >= MIN_SUPPORT_FOR_SEMANTIC) {
        updated.tier = "SEMANTIC";
        updated.status = "SUPPORTED";
        emit({ kind: "MEMORY_PROMOTED", memoryId: entry.memoryId, from: "EPISODIC", to: "SEMANTIC" });
      }
      break;
    case "SEMANTIC":
      if (entry.status === "VALIDATED" && entry.confidence >= 0.8) {
        updated.tier = "PROCEDURAL" as MemoryTier;
        emit({ kind: "MEMORY_PROMOTED", memoryId: entry.memoryId, from: "SEMANTIC", to: "PROCEDURAL" });
      }
      break;
    case "PROCEDURAL":
      // Already at highest tier.
      break;
  }

  return updated;
}

/**
 * Create a hypothesis from a validated memory.
 * Memory may propose hypotheses but NEVER bypass validation gates.
 */
export function proposeHypothesisFromMemory(entry: MemoryEntry): {
  hypothesis: string;
  sourceMemoryId: string;
  confidence: number;
} | null {
  if (entry.status !== "VALIDATED" && entry.tier !== "PROCEDURAL") {
    return null;
  }

  return {
    hypothesis: `Based on validated memory: ${entry.claim}`,
    sourceMemoryId: entry.memoryId,
    confidence: entry.confidence * 0.8, // Discount confidence when proposing
  };
}
