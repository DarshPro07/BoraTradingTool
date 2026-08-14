import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/brain/event-bus";
import { stableStringify } from "@/lib/util/stable-json";
import {
  KnowledgeError,
  type ClaimInput,
  type GraphEdge,
  type GraphNode,
  type GraphTrace,
  type HypothesisInput,
  type LessonInput,
  type SourceInput,
  type StrategySpecInput,
  type TrialInput,
} from "./types";

export function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function shortId(prefix: string, seed?: string): string {
  const suffix = seed ? contentHash(seed).slice(0, 16) : randomUUID().replace(/-/g, "").slice(0, 16);
  return `${prefix}_${suffix}`;
}

export function recordSource(input: SourceInput): { id: string; created: boolean } {
  if (input.content.length > 200_000) {
    throw new KnowledgeError("INVALID_INPUT", "Source content cannot exceed 200000 characters.");
  }
  const db = getDb();
  const hash = contentHash(input.content);
  const existing = db
    .select()
    .from(schema.knowledgeSources)
    .where(eq(schema.knowledgeSources.contentHash, hash))
    .get();
  if (existing) {
    if (existing.content === null) {
      db.update(schema.knowledgeSources)
        .set({ content: input.content })
        .where(eq(schema.knowledgeSources.id, existing.id))
        .run();
    }
    return { id: existing.id, created: false };
  }

  const id = shortId("src", hash);
  db.insert(schema.knowledgeSources)
    .values({
      id,
      kind: input.kind,
      title: input.title,
      url: input.url ?? null,
      locator: input.locator ?? null,
      contentHash: hash,
      content: input.content,
      license: input.license ?? null,
      authors: input.authors ? JSON.stringify(input.authors) : null,
      publishedAt: input.publishedAt ?? null,
      archivedPath: input.archivedPath ?? null,
      status: "archived",
      ingestedAt: new Date(),
    })
    .run();
  return { id, created: true };
}

export function getSource(id: string) {
  return getDb().select().from(schema.knowledgeSources).where(eq(schema.knowledgeSources.id, id)).get() ?? null;
}

export function getArchivedSource(id: string) {
  const source = getSource(id);
  if (!source?.content || source.status === "discovered" || source.status === "rejected") return null;
  return contentHash(source.content) === source.contentHash ? source : null;
}

export function setSourceStatus(id: string, status: string, rejectionReason?: string): void {
  getDb()
    .update(schema.knowledgeSources)
    .set({ status, rejectionReason: rejectionReason ?? null })
    .where(eq(schema.knowledgeSources.id, id))
    .run();
}

export function recordClaim(input: ClaimInput): string {
  if (!getArchivedSource(input.sourceId)) {
    throw new KnowledgeError("SOURCE_NOT_FOUND", `Unknown or unverifiable archived source "${input.sourceId}".`);
  }
  const id = shortId("clm", `${input.sourceId}:${input.statement}`);
  getDb()
    .insert(schema.knowledgeClaims)
    .values({
      id,
      sourceId: input.sourceId,
      statement: input.statement,
      locator: input.locator ?? null,
      epistemicStatus: input.epistemicStatus ?? "inferred",
      confidence: input.confidence ?? null,
      indiaRelevant: input.indiaRelevant === undefined ? null : input.indiaRelevant ? 1 : 0,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
  return id;
}

export function verifyClaim(id: string, verifiedBy: string, status: string): void {
  getDb()
    .update(schema.knowledgeClaims)
    .set({ epistemicStatus: status, verifiedAt: new Date(), verifiedBy })
    .where(eq(schema.knowledgeClaims.id, id))
    .run();
}

export function getClaim(id: string) {
  return getDb().select().from(schema.knowledgeClaims).where(eq(schema.knowledgeClaims.id, id)).get() ?? null;
}

export function recordConcept(plane: string, name: string, summary: string, formalDefinition?: string): string {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.knowledgeConcepts)
    .where(and(eq(schema.knowledgeConcepts.plane, plane), eq(schema.knowledgeConcepts.name, name)))
    .get();
  if (existing) return existing.id;

  const id = shortId("cpt", `${plane}:${name}`);
  db.insert(schema.knowledgeConcepts)
    .values({ id, plane, name, summary, formalDefinition: formalDefinition ?? null, createdAt: new Date() })
    .run();
  return id;
}

export function linkConcepts(fromConceptId: string, toConceptId: string, relation: string): void {
  getDb()
    .insert(schema.knowledgeConceptEdges)
    .values({ fromConceptId, toConceptId, relation, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function recordHypothesis(input: HypothesisInput): string {
  const id = shortId("hyp", `${input.title}:${input.statement}`);
  getDb()
    .insert(schema.researchHypotheses)
    .values({
      id,
      claimId: input.claimId ?? null,
      title: input.title,
      statement: input.statement,
      rationale: input.rationale ?? null,
      market: input.market ?? null,
      status: "proposed",
      createdBy: input.createdBy,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
  emit({ kind: "HYPOTHESIS_CREATED", hypothesisId: id, instrumentId: input.market ?? "unknown" });
  return id;
}

export function markHypothesisDuplicate(id: string, duplicateOf: string): void {
  getDb()
    .update(schema.researchHypotheses)
    .set({ status: "duplicate", duplicateOf })
    .where(eq(schema.researchHypotheses.id, id))
    .run();
}

export function recordStrategySpec(input: StrategySpecInput): string {
  const dslText = stableStringify(input.dsl);
  const hash = contentHash(dslText);
  const version = input.version ?? 1;
  const id = shortId("stg", `${input.name}:${version}`);
  getDb()
    .insert(schema.strategySpecs)
    .values({
      id,
      hypothesisId: input.hypothesisId ?? null,
      parentId: input.parentId ?? null,
      name: input.name,
      version,
      dsl: dslText,
      dslHash: hash,
      status: "draft",
      createdBy: input.createdBy,
      createdAt: new Date(),
    })
    .run();
  return id;
}

export function setSpecStatus(id: string, status: string): void {
  getDb().update(schema.strategySpecs).set({ status }).where(eq(schema.strategySpecs.id, id)).run();
}

export function getSpec(id: string) {
  return getDb().select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, id)).get() ?? null;
}

export function recordTrial(input: TrialInput): number {
  if (!getSpec(input.strategySpecId)) {
    throw new KnowledgeError("SPEC_NOT_FOUND", `Unknown strategy spec "${input.strategySpecId}".`);
  }
  const result = getDb()
    .insert(schema.trials)
    .values({
      strategySpecId: input.strategySpecId,
      kind: input.kind,
      verdict: input.verdict,
      reason: input.reason ?? null,
      metrics: input.metrics ? JSON.stringify(input.metrics) : null,
      datasetFingerprint: input.datasetFingerprint ?? null,
      actor: input.actor,
      startedAt: input.startedAt ?? new Date(),
      completedAt: new Date(),
    })
    .run();
  return Number(result.lastInsertRowid);
}

export function listTrials(strategySpecId: string) {
  return getDb()
    .select()
    .from(schema.trials)
    .where(eq(schema.trials.strategySpecId, strategySpecId))
    .orderBy(desc(schema.trials.id))
    .all();
}

/** Every attempt ever made against a spec — the denominator for multiple-testing control. */
export function countTrials(strategySpecId: string): number {
  return listTrials(strategySpecId).length;
}

export function recordLesson(input: LessonInput): string {
  const db = getDb();
  for (const citation of input.citations) {
    const isSource = citation.startsWith("src_") && getArchivedSource(citation);
    const isClaim = citation.startsWith("clm_") && getClaim(citation);
    if (!isSource && !isClaim) {
      throw new KnowledgeError("INVALID_CITATION", `Citation "${citation}" does not resolve to a source or claim.`);
    }
  }
  const id = shortId("les", `${input.title}:${input.level}`);
  db.insert(schema.knowledgeLessons)
    .values({
      id,
      conceptId: input.conceptId ?? null,
      plane: input.plane,
      level: input.level,
      title: input.title,
      body: input.body,
      citations: JSON.stringify(input.citations),
      createdAt: new Date(),
    })
    .run();
  return id;
}

export function recordFailure(
  scope: string,
  failureMode: string,
  detail: string,
  subjectId?: string,
  lesson?: string,
): number {
  const result = getDb()
    .insert(schema.failureMemory)
    .values({
      scope,
      subjectId: subjectId ?? null,
      failureMode,
      detail,
      lesson: lesson ?? null,
      recordedAt: new Date(),
    })
    .run();
  return Number(result.lastInsertRowid);
}

export function recordAudit(entry: {
  actor: string;
  action: string;
  decision: "allowed" | "denied";
  denialCode?: string;
  subject?: string;
  detail?: string;
  learningMode?: string;
}): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor: entry.actor,
      action: entry.action,
      decision: entry.decision,
      denialCode: entry.denialCode ?? null,
      subject: entry.subject ?? null,
      detail: entry.detail ?? null,
      learningMode: entry.learningMode ?? null,
      createdAt: new Date(),
    })
    .run();
}

export function listAudit(limit = 100) {
  return getDb().select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.id)).limit(limit).all();
}

// ---------------------------------------------------------------------------
// Memory graph traversal
// ---------------------------------------------------------------------------

function sourceNode(row: typeof schema.knowledgeSources.$inferSelect): GraphNode {
  return { id: row.id, type: "source", label: row.title, detail: row.kind, status: row.status, createdAt: row.ingestedAt };
}

function claimNode(row: typeof schema.knowledgeClaims.$inferSelect): GraphNode {
  return {
    id: row.id,
    type: "claim",
    label: row.statement.slice(0, 140),
    detail: row.locator ?? undefined,
    status: row.epistemicStatus,
    createdAt: row.createdAt,
  };
}

function hypothesisNode(row: typeof schema.researchHypotheses.$inferSelect): GraphNode {
  return { id: row.id, type: "hypothesis", label: row.title, detail: row.market ?? undefined, status: row.status, createdAt: row.createdAt };
}

function specNode(row: typeof schema.strategySpecs.$inferSelect): GraphNode {
  return { id: row.id, type: "strategy", label: `${row.name} v${row.version}`, status: row.status, createdAt: row.createdAt };
}

function trialNode(row: typeof schema.trials.$inferSelect): GraphNode {
  return {
    id: `trl_${row.id}`,
    type: "trial",
    label: row.kind,
    detail: row.reason ?? undefined,
    status: row.verdict,
    createdAt: row.startedAt,
  };
}

function forwardNode(row: typeof schema.forwardOutcomes.$inferSelect): GraphNode {
  return {
    id: row.id,
    type: "forward_outcome",
    label: row.instrumentId,
    detail: row.rMultiple === null ? undefined : `${row.rMultiple}R`,
    status: row.outcome,
    createdAt: row.openedAt,
  };
}

function lessonNode(row: typeof schema.knowledgeLessons.$inferSelect): GraphNode {
  return { id: row.id, type: "lesson", label: row.title, detail: row.level, status: row.plane, createdAt: row.createdAt };
}

/**
 * Everything downstream of a source: claims, the hypotheses they produced, the strategies
 * built from those, the trials run against them, and the forward outcomes observed.
 */
export function traceForward(sourceId: string): GraphTrace {
  const db = getDb();
  const source = getSource(sourceId);
  if (!source) throw new KnowledgeError("SOURCE_NOT_FOUND", `Unknown source "${sourceId}".`);

  const nodes: GraphNode[] = [sourceNode(source)];
  const edges: GraphEdge[] = [];

  const claims = db.select().from(schema.knowledgeClaims).where(eq(schema.knowledgeClaims.sourceId, sourceId)).all();
  for (const claim of claims) {
    nodes.push(claimNode(claim));
    edges.push({ from: sourceId, to: claim.id, relation: "asserts" });
  }

  const claimIds = claims.map((claim) => claim.id);
  const hypotheses = claimIds.length
    ? db.select().from(schema.researchHypotheses).where(inArray(schema.researchHypotheses.claimId, claimIds)).all()
    : [];
  for (const hypothesis of hypotheses) {
    nodes.push(hypothesisNode(hypothesis));
    if (hypothesis.claimId) edges.push({ from: hypothesis.claimId, to: hypothesis.id, relation: "motivates" });
  }

  const hypothesisIds = hypotheses.map((hypothesis) => hypothesis.id);
  const specs = hypothesisIds.length
    ? db.select().from(schema.strategySpecs).where(inArray(schema.strategySpecs.hypothesisId, hypothesisIds)).all()
    : [];
  for (const spec of specs) {
    nodes.push(specNode(spec));
    if (spec.hypothesisId) edges.push({ from: spec.hypothesisId, to: spec.id, relation: "implemented_as" });
  }

  const specIds = specs.map((spec) => spec.id);
  if (specIds.length) {
    for (const trial of db.select().from(schema.trials).where(inArray(schema.trials.strategySpecId, specIds)).all()) {
      nodes.push(trialNode(trial));
      edges.push({ from: trial.strategySpecId, to: `trl_${trial.id}`, relation: "tested_by" });
    }
    for (const outcome of db
      .select()
      .from(schema.forwardOutcomes)
      .where(inArray(schema.forwardOutcomes.strategySpecId, specIds))
      .all()) {
      nodes.push(forwardNode(outcome));
      if (outcome.strategySpecId) {
        edges.push({ from: outcome.strategySpecId, to: outcome.id, relation: "observed_as" });
      }
    }
  }

  const lessons = db.select().from(schema.knowledgeLessons).all();
  for (const lesson of lessons) {
    const citations = JSON.parse(lesson.citations) as string[];
    const cited = citations.filter((citation) => citation === sourceId || claimIds.includes(citation));
    if (!cited.length) continue;
    nodes.push(lessonNode(lesson));
    for (const citation of cited) edges.push({ from: citation, to: lesson.id, relation: "taught_as" });
  }

  return { root: sourceNode(source), nodes, edges };
}

/**
 * Walks back from any node to the sources that justify it, so the UI can answer
 * "why does the system believe this?" for every rendered value.
 */
export function traceBack(nodeId: string): GraphTrace {
  const db = getDb();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const addSourceChain = (claimId: string | null): void => {
    if (!claimId) return;
    const claim = getClaim(claimId);
    if (!claim) return;
    nodes.push(claimNode(claim));
    const source = getSource(claim.sourceId);
    if (source) {
      nodes.push(sourceNode(source));
      edges.push({ from: source.id, to: claim.id, relation: "asserts" });
    }
  };

  if (nodeId.startsWith("trl_")) {
    const trialId = Number(nodeId.slice(4));
    const trial = db.select().from(schema.trials).where(eq(schema.trials.id, trialId)).get();
    if (!trial) throw new KnowledgeError("NODE_NOT_FOUND", `Unknown trial "${nodeId}".`);
    nodes.push(trialNode(trial));
    const spec = getSpec(trial.strategySpecId);
    if (spec) {
      nodes.push(specNode(spec));
      edges.push({ from: spec.id, to: nodeId, relation: "tested_by" });
      const hypothesis = spec.hypothesisId
        ? db.select().from(schema.researchHypotheses).where(eq(schema.researchHypotheses.id, spec.hypothesisId)).get()
        : null;
      if (hypothesis) {
        nodes.push(hypothesisNode(hypothesis));
        edges.push({ from: hypothesis.id, to: spec.id, relation: "implemented_as" });
        addSourceChain(hypothesis.claimId);
        if (hypothesis.claimId) edges.push({ from: hypothesis.claimId, to: hypothesis.id, relation: "motivates" });
      }
    }
    return { root: trialNode(trial), nodes, edges };
  }

  if (nodeId.startsWith("stg_")) {
    const spec = getSpec(nodeId);
    if (!spec) throw new KnowledgeError("NODE_NOT_FOUND", `Unknown strategy "${nodeId}".`);
    nodes.push(specNode(spec));
    const hypothesis = spec.hypothesisId
      ? db.select().from(schema.researchHypotheses).where(eq(schema.researchHypotheses.id, spec.hypothesisId)).get()
      : null;
    if (hypothesis) {
      nodes.push(hypothesisNode(hypothesis));
      edges.push({ from: hypothesis.id, to: spec.id, relation: "implemented_as" });
      addSourceChain(hypothesis.claimId);
      if (hypothesis.claimId) edges.push({ from: hypothesis.claimId, to: hypothesis.id, relation: "motivates" });
    }
    return { root: specNode(spec), nodes, edges };
  }

  if (nodeId.startsWith("clm_")) {
    const claim = getClaim(nodeId);
    if (!claim) throw new KnowledgeError("NODE_NOT_FOUND", `Unknown claim "${nodeId}".`);
    addSourceChain(nodeId);
    return { root: claimNode(claim), nodes, edges };
  }

  if (nodeId.startsWith("src_")) {
    const source = getSource(nodeId);
    if (!source) throw new KnowledgeError("NODE_NOT_FOUND", `Unknown source "${nodeId}".`);
    return { root: sourceNode(source), nodes: [sourceNode(source)], edges: [] };
  }

  throw new KnowledgeError("NODE_NOT_FOUND", `Unrecognised node id "${nodeId}".`);
}
