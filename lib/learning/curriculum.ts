import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface MasteryUpdate {
  conceptId: string;
  attempts: number;
  correct: number;
  score: number;
  nextReviewAt: Date;
  interval: number;
}

/**
 * Spaced repetition over a concept. The score is the smoothed proportion correct; the
 * review interval grows while answers are right and collapses to one day on a miss, so a
 * misunderstood concept resurfaces immediately rather than decaying quietly.
 */
export function recordQuizResult(conceptId: string, correct: boolean, now = new Date()): MasteryUpdate {
  const db = getDb();
  const existing = db.select().from(schema.knowledgeMastery).where(eq(schema.knowledgeMastery.conceptId, conceptId)).get();

  const attempts = (existing?.attempts ?? 0) + 1;
  const correctCount = (existing?.correct ?? 0) + (correct ? 1 : 0);
  const score = correctCount / attempts;

  const previousInterval = existing?.lastReviewedAt && existing.nextReviewAt
    ? Math.max(1, Math.round((existing.nextReviewAt.getTime() - existing.lastReviewedAt.getTime()) / DAY_MS))
    : 1;

  const interval = correct ? Math.min(180, Math.max(1, Math.round(previousInterval * (1 + score)))) : 1;
  const nextReviewAt = new Date(now.getTime() + interval * DAY_MS);

  db.insert(schema.knowledgeMastery)
    .values({ conceptId, attempts, correct: correctCount, score, lastReviewedAt: now, nextReviewAt })
    .onConflictDoUpdate({
      target: schema.knowledgeMastery.conceptId,
      set: { attempts, correct: correctCount, score, lastReviewedAt: now, nextReviewAt },
    })
    .run();

  return { conceptId, attempts, correct: correctCount, score, nextReviewAt, interval };
}

export interface CurriculumItem {
  conceptId: string;
  name: string;
  plane: string;
  score: number;
  attempts: number;
  dueAt: Date | null;
  reason: "never_studied" | "due_for_review" | "weak";
}

/**
 * What to study next: concepts never studied, concepts due for review, then weak ones.
 * Prerequisites come first so a concept is never scheduled before what it depends on.
 */
export function nextCurriculum(plane?: string, limit = 10, now = new Date()): CurriculumItem[] {
  const db = getDb();
  const concepts = plane
    ? db.select().from(schema.knowledgeConcepts).where(eq(schema.knowledgeConcepts.plane, plane)).all()
    : db.select().from(schema.knowledgeConcepts).all();

  const mastery = new Map(
    db.select().from(schema.knowledgeMastery).all().map((row) => [row.conceptId, row]),
  );

  const edges = db.select().from(schema.knowledgeConceptEdges).all();
  const prerequisiteCount = new Map<string, number>();
  for (const edge of edges) {
    if (edge.relation !== "prerequisite_of") continue;
    const known = (mastery.get(edge.fromConceptId)?.score ?? 0) >= 0.8;
    if (!known) {
      prerequisiteCount.set(edge.toConceptId, (prerequisiteCount.get(edge.toConceptId) ?? 0) + 1);
    }
  }

  const items: CurriculumItem[] = [];
  for (const concept of concepts) {
    const record = mastery.get(concept.id);
    let reason: CurriculumItem["reason"] | null = null;

    if (!record || record.attempts === 0) reason = "never_studied";
    else if (record.nextReviewAt && record.nextReviewAt <= now) reason = "due_for_review";
    else if (record.score < 0.6) reason = "weak";

    if (!reason) continue;
    items.push({
      conceptId: concept.id,
      name: concept.name,
      plane: concept.plane,
      score: record?.score ?? 0,
      attempts: record?.attempts ?? 0,
      dueAt: record?.nextReviewAt ?? null,
      reason,
    });
  }

  // Fewest unmet prerequisites first, then weakest.
  items.sort((a, b) => {
    const blockedA = prerequisiteCount.get(a.conceptId) ?? 0;
    const blockedB = prerequisiteCount.get(b.conceptId) ?? 0;
    if (blockedA !== blockedB) return blockedA - blockedB;
    return a.score - b.score;
  });

  return items.slice(0, limit);
}

export interface MasterySummary {
  plane: string;
  concepts: number;
  studied: number;
  averageScore: number;
  dueNow: number;
}

export function masteryByPlane(now = new Date()): MasterySummary[] {
  const db = getDb();
  const concepts = db.select().from(schema.knowledgeConcepts).orderBy(asc(schema.knowledgeConcepts.plane)).all();
  const mastery = new Map(db.select().from(schema.knowledgeMastery).all().map((row) => [row.conceptId, row]));

  const byPlane = new Map<string, { total: number; studied: number; scoreSum: number; due: number }>();
  for (const concept of concepts) {
    const bucket = byPlane.get(concept.plane) ?? { total: 0, studied: 0, scoreSum: 0, due: 0 };
    bucket.total += 1;
    const record = mastery.get(concept.id);
    if (record && record.attempts > 0) {
      bucket.studied += 1;
      bucket.scoreSum += record.score;
      if (record.nextReviewAt && record.nextReviewAt <= now) bucket.due += 1;
    }
    byPlane.set(concept.plane, bucket);
  }

  return [...byPlane.entries()].map(([plane, bucket]) => ({
    plane,
    concepts: bucket.total,
    studied: bucket.studied,
    averageScore: bucket.studied === 0 ? 0 : bucket.scoreSum / bucket.studied,
    dueNow: bucket.due,
  }));
}
