import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { KnowledgeError, type ReproductionStatus } from "./types";

/**
 * A reproduction is the step that separates "the source says X" from "X is true here".
 * Nothing becomes durable knowledge on the strength of a claim alone: the claim has to be
 * re-derived locally and the observed result compared against what was reported.
 */
export interface ReproductionInput {
  sourceId: string;
  claimId?: string;
  equationId?: string;
  language: "typescript" | "python" | "sql" | "prose";
  codePath?: string;
  /** What the source reported. */
  expected: Record<string, unknown>;
  notes?: string;
  /** Relative tolerance for numeric comparison. Defaults to 1%. */
  tolerance?: number;
}

export interface ReproductionOutcome {
  id: string;
  status: ReproductionStatus;
  mismatches: string[];
  expected: Record<string, unknown>;
  observed: Record<string, unknown>;
}

function shortId(seed: string): string {
  return `rep_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

export function registerReproduction(input: ReproductionInput): string {
  const source = getDb()
    .select()
    .from(schema.knowledgeSources)
    .where(eq(schema.knowledgeSources.id, input.sourceId))
    .get();
  if (!source) throw new KnowledgeError("SOURCE_NOT_FOUND", `Unknown source "${input.sourceId}".`);

  const id = shortId(`${input.sourceId}:${input.codePath ?? randomUUID()}`);
  getDb()
    .insert(schema.knowledgeReproductions)
    .values({
      id,
      sourceId: input.sourceId,
      claimId: input.claimId ?? null,
      equationId: input.equationId ?? null,
      language: input.language,
      codePath: input.codePath ?? null,
      expected: JSON.stringify(input.expected),
      observed: null,
      tolerance: input.tolerance ?? 0.01,
      status: "pending",
      notes: input.notes ?? null,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
  return id;
}

function withinTolerance(expected: unknown, observed: unknown, tolerance: number): boolean {
  if (typeof expected === "number" && typeof observed === "number") {
    if (!Number.isFinite(expected) || !Number.isFinite(observed)) return expected === observed;
    if (expected === 0) return Math.abs(observed) <= tolerance;
    return Math.abs((observed - expected) / expected) <= tolerance;
  }
  return JSON.stringify(expected) === JSON.stringify(observed);
}

/**
 * Records what actually happened when the claim was re-derived. A mismatch is a result,
 * not a failure to be retried away — it is written down and the reproduction stays
 * `mismatch` so the claim above it cannot be treated as verified.
 */
export function recordObservation(
  id: string,
  observed: Record<string, unknown>,
  notes?: string,
): ReproductionOutcome {
  const db = getDb();
  const row = db
    .select()
    .from(schema.knowledgeReproductions)
    .where(eq(schema.knowledgeReproductions.id, id))
    .get();
  if (!row) throw new KnowledgeError("NODE_NOT_FOUND", `Unknown reproduction "${id}".`);

  const expected = JSON.parse(row.expected ?? "{}") as Record<string, unknown>;
  const tolerance = row.tolerance ?? 0.01;
  const mismatches: string[] = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!(key in observed)) {
      mismatches.push(`${key}: reported ${JSON.stringify(expectedValue)} but nothing was observed`);
      continue;
    }
    if (!withinTolerance(expectedValue, observed[key], tolerance)) {
      mismatches.push(
        `${key}: reported ${JSON.stringify(expectedValue)} but observed ${JSON.stringify(observed[key])}`,
      );
    }
  }

  const status: ReproductionStatus = mismatches.length === 0 ? "match" : "mismatch";
  db.update(schema.knowledgeReproductions)
    .set({
      observed: JSON.stringify(observed),
      status,
      notes: notes ?? row.notes,
      ranAt: new Date(),
    })
    .where(eq(schema.knowledgeReproductions.id, id))
    .run();

  return { id, status, mismatches, expected, observed };
}

export function markReproductionError(id: string, reason: string): void {
  getDb()
    .update(schema.knowledgeReproductions)
    .set({ status: "error", notes: reason, ranAt: new Date() })
    .where(eq(schema.knowledgeReproductions.id, id))
    .run();
}

export function listReproductions(sourceId?: string) {
  const db = getDb();
  const query = db.select().from(schema.knowledgeReproductions);
  const rows = sourceId
    ? query.where(eq(schema.knowledgeReproductions.sourceId, sourceId)).all()
    : query.orderBy(desc(schema.knowledgeReproductions.createdAt)).all();
  return rows.map((row) => ({
    ...row,
    expectedValues: row.expected ? (JSON.parse(row.expected) as Record<string, unknown>) : null,
    observedValues: row.observed ? (JSON.parse(row.observed) as Record<string, unknown>) : null,
  }));
}

export interface ReproductionSummary {
  total: number;
  match: number;
  mismatch: number;
  pending: number;
  error: number;
  /** Sources with at least one verified reproduction — the only ones fully earned. */
  verifiedSources: number;
}

export function reproductionSummary(): ReproductionSummary {
  const rows = listReproductions();
  const verified = new Set(rows.filter((row) => row.status === "match").map((row) => row.sourceId));
  return {
    total: rows.length,
    match: rows.filter((row) => row.status === "match").length,
    mismatch: rows.filter((row) => row.status === "mismatch").length,
    pending: rows.filter((row) => row.status === "pending").length,
    error: rows.filter((row) => row.status === "error").length,
    verifiedSources: verified.size,
  };
}
