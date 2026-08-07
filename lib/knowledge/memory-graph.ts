import { getDb, schema } from "@/lib/db";
import type { GraphEdge, GraphNode } from "./types";

/**
 * Whole-graph projection of what the system knows.
 *
 * `traceForward` / `traceBack` in the repository answer "why do we believe this one thing?"
 * and need a root to start from. This answers the different question the memory screen asks:
 * what is in here at all, and what is connected to nothing?
 *
 * Orphans are the point. A claim nobody turned into a hypothesis, or a hypothesis nobody
 * implemented, is knowledge that was ingested and then quietly ignored — invisible in any
 * view that starts from a root and walks outward, because nothing links to it.
 */

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Node count by type, for the summary strip. */
  counts: Record<string, number>;
  /** Nodes with no edge in either direction. */
  orphans: GraphNode[];
  /** Failure modes seen more than once, most frequent first. */
  repeatedFailures: Array<{ failureMode: string; occurrences: number; lastSeen: Date }>;
  generatedAt: string;
}

export function buildMemoryGraph(limitPerType = 250): MemoryGraph {
  const db = getDb();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const sources = db.select().from(schema.knowledgeSources).limit(limitPerType).all();
  for (const row of sources) {
    nodes.push({
      id: row.id,
      type: "source",
      label: row.title,
      detail: row.kind,
      status: row.status,
      createdAt: row.ingestedAt,
    });
  }

  const claims = db.select().from(schema.knowledgeClaims).limit(limitPerType).all();
  for (const row of claims) {
    nodes.push({
      id: row.id,
      type: "claim",
      label: row.statement.slice(0, 140),
      detail: row.locator ?? undefined,
      status: row.epistemicStatus,
      createdAt: row.createdAt,
    });
    edges.push({ from: row.sourceId, to: row.id, relation: "asserts" });
  }

  const hypotheses = db.select().from(schema.researchHypotheses).limit(limitPerType).all();
  for (const row of hypotheses) {
    nodes.push({
      id: row.id,
      type: "hypothesis",
      label: row.title,
      detail: row.market ?? undefined,
      status: row.status,
      createdAt: row.createdAt,
    });
    if (row.claimId) edges.push({ from: row.claimId, to: row.id, relation: "motivates" });
  }

  const specs = db.select().from(schema.strategySpecs).limit(limitPerType).all();
  for (const row of specs) {
    nodes.push({
      id: row.id,
      type: "strategy",
      label: `${row.name} v${row.version}`,
      status: row.status,
      createdAt: row.createdAt,
    });
    if (row.hypothesisId) edges.push({ from: row.hypothesisId, to: row.id, relation: "implemented_as" });
  }

  const trials = db.select().from(schema.trials).limit(limitPerType).all();
  for (const row of trials) {
    nodes.push({
      id: `trl_${row.id}`,
      type: "trial",
      label: row.kind,
      detail: row.reason ?? undefined,
      status: row.verdict,
      createdAt: row.startedAt,
    });
    edges.push({ from: row.strategySpecId, to: `trl_${row.id}`, relation: "tested_by" });
  }

  const lessons = db.select().from(schema.knowledgeLessons).limit(limitPerType).all();
  for (const row of lessons) {
    nodes.push({
      id: row.id,
      type: "lesson",
      label: row.title,
      detail: row.level,
      status: row.plane,
      createdAt: row.createdAt,
    });
    // Lessons cite the evidence that taught them; a lesson citing nothing is an assertion.
    for (const citation of safeCitations(row.citations)) {
      edges.push({ from: citation, to: row.id, relation: "taught_as" });
    }
  }

  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }

  const counts: Record<string, number> = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;

  const failures = db.select().from(schema.failureMemory).all();
  const byMode = new Map<string, { occurrences: number; lastSeen: Date }>();
  for (const row of failures) {
    const existing = byMode.get(row.failureMode);
    byMode.set(row.failureMode, {
      occurrences: (existing?.occurrences ?? 0) + 1,
      lastSeen:
        existing && existing.lastSeen > row.recordedAt ? existing.lastSeen : row.recordedAt,
    });
  }

  return {
    nodes,
    edges,
    counts,
    orphans: nodes.filter((node) => !connected.has(node.id)),
    repeatedFailures: [...byMode.entries()]
      .filter(([, value]) => value.occurrences > 1)
      .map(([failureMode, value]) => ({ failureMode, ...value }))
      .sort((a, b) => b.occurrences - a.occurrences),
    generatedAt: new Date().toISOString(),
  };
}

/** A malformed citations column is a data fault, not a reason to fail the whole graph. */
function safeCitations(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
