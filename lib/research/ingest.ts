import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordClaim, recordHypothesis, recordSource } from "@/lib/knowledge/repository";
import type { SourceKind } from "@/lib/knowledge/types";
import type { JobKind } from "./queue";

export interface IngestPayload {
  kind: SourceKind;
  title: string;
  content: string;
  url?: string;
  locator?: string;
  license?: string;
  authors?: string[];
  /** Pre-extracted claims. The worker never invents claims from raw text. */
  claims?: { statement: string; locator?: string; epistemicStatus?: string; confidence?: number }[];
  hypotheses?: { title: string; statement: string; rationale?: string; market?: string }[];
}

export interface IngestResult {
  sourceId: string;
  sourceCreated: boolean;
  claimIds: string[];
  hypothesisIds: string[];
  duplicateHypotheses: string[];
  notes: string[];
}

const KIND_FOR_JOB: Readonly<Partial<Record<JobKind, SourceKind>>> = Object.freeze({
  ingest_paper: "paper",
  ingest_video: "video",
  ingest_repository: "repository",
  ingest_web: "web",
});

export function sourceKindForJob(jobKind: JobKind): SourceKind | null {
  return KIND_FOR_JOB[jobKind] ?? null;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Jaccard similarity over word sets — cheap, deterministic, and good enough to catch restatements. */
export function similarity(a: string, b: string): number {
  const left = new Set(normalise(a).split(" ").filter(Boolean));
  const right = new Set(normalise(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.8;

export function findDuplicateHypothesis(statement: string): string | null {
  const existing = getDb().select().from(schema.researchHypotheses).all();
  for (const row of existing) {
    if (row.status === "duplicate") continue;
    if (similarity(statement, row.statement) >= DUPLICATE_THRESHOLD) return row.id;
  }
  return null;
}

/**
 * Deterministic ingestion. Claims and hypotheses must be supplied by the caller —
 * typically Claude Code, which reasons over the source. The worker archives, links,
 * and deduplicates but never fabricates a claim from raw text on its own.
 */
export function ingestSource(jobKind: JobKind, payload: IngestPayload, createdBy = "research_worker"): IngestResult {
  const kind = payload.kind ?? sourceKindForJob(jobKind) ?? "web";
  const notes: string[] = [];

  const source = recordSource({
    kind,
    title: payload.title,
    content: payload.content,
    url: payload.url,
    locator: payload.locator,
    license: payload.license,
    authors: payload.authors,
  });
  if (!source.created) notes.push("Source content already archived; reused the existing record.");

  const claimIds: string[] = [];
  for (const claim of payload.claims ?? []) {
    claimIds.push(
      recordClaim({
        sourceId: source.id,
        statement: claim.statement,
        locator: claim.locator,
        epistemicStatus: (claim.epistemicStatus as never) ?? "inferred",
        confidence: claim.confidence,
      }),
    );
  }

  const hypothesisIds: string[] = [];
  const duplicateHypotheses: string[] = [];
  for (const hypothesis of payload.hypotheses ?? []) {
    const duplicateOf = findDuplicateHypothesis(hypothesis.statement);
    const id = recordHypothesis({
      claimId: claimIds[0],
      title: hypothesis.title,
      statement: hypothesis.statement,
      rationale: hypothesis.rationale,
      market: hypothesis.market,
      createdBy,
    });
    if (duplicateOf && duplicateOf !== id) {
      getDb()
        .update(schema.researchHypotheses)
        .set({ status: "duplicate", duplicateOf })
        .where(eq(schema.researchHypotheses.id, id))
        .run();
      duplicateHypotheses.push(id);
      notes.push(`Hypothesis "${hypothesis.title}" restates ${duplicateOf}.`);
    } else {
      hypothesisIds.push(id);
    }
  }

  if (!payload.claims?.length) {
    notes.push("No claims supplied. The source is archived but has produced no extracted knowledge yet.");
  }

  return {
    sourceId: source.id,
    sourceCreated: source.created,
    claimIds,
    hypothesisIds,
    duplicateHypotheses,
    notes,
  };
}
