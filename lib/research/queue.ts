import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const JOB_KINDS = ["ingest_paper", "ingest_video", "ingest_repository", "ingest_web", "dedupe_hypotheses"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const DEFAULT_LEASE_MS = 5 * 60_000;

export interface EnqueueInput {
  kind: JobKind;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
  availableAt?: Date;
}

export interface ClaimedJob {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

function logEvent(jobId: number, event: string, detail?: string): void {
  getDb()
    .insert(schema.researchJobEvents)
    .values({ jobId, event, detail: detail ?? null, createdAt: new Date() })
    .run();
}

export function enqueue(input: EnqueueInput): { id: number; deduped: boolean } {
  const db = getDb();
  const now = new Date();

  if (input.dedupeKey) {
    const existing = db
      .select()
      .from(schema.researchJobs)
      .where(eq(schema.researchJobs.dedupeKey, input.dedupeKey))
      .get();
    if (existing) return { id: existing.id, deduped: true };
  }

  const result = db
    .insert(schema.researchJobs)
    .values({
      kind: input.kind,
      payload: JSON.stringify(input.payload),
      status: "queued",
      priority: input.priority ?? 100,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      dedupeKey: input.dedupeKey ?? null,
      availableAt: input.availableAt ?? now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const id = Number(result.lastInsertRowid);
  logEvent(id, "enqueued", input.kind);
  return { id, deduped: false };
}

/**
 * Claims the highest-priority available job with a time-bounded lease. A worker that
 * crashes mid-job leaves an expired lease, and the job becomes claimable again rather
 * than being stranded in "running" forever.
 */
export function claimNextJob(workerId: string, now = new Date(), leaseMs = DEFAULT_LEASE_MS): ClaimedJob | null {
  const db = getDb();

  return db.transaction((tx) => {
    const candidate = tx
      .select()
      .from(schema.researchJobs)
      .where(
        and(
          or(
            eq(schema.researchJobs.status, "queued"),
            and(eq(schema.researchJobs.status, "running"), lte(schema.researchJobs.lockedUntil, now)),
          ),
          lte(schema.researchJobs.availableAt, now),
        ),
      )
      .orderBy(asc(schema.researchJobs.priority), asc(schema.researchJobs.id))
      .limit(1)
      .get();

    if (!candidate) return null;

    tx.update(schema.researchJobs)
      .set({
        status: "running",
        attempts: candidate.attempts + 1,
        lockedBy: workerId,
        lockedUntil: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(eq(schema.researchJobs.id, candidate.id))
      .run();

    tx.insert(schema.researchJobEvents)
      .values({
        jobId: candidate.id,
        event: "claimed",
        detail: `${workerId} attempt ${candidate.attempts + 1}`,
        createdAt: now,
      })
      .run();

    return {
      id: candidate.id,
      kind: candidate.kind as JobKind,
      payload: JSON.parse(candidate.payload) as Record<string, unknown>,
      attempts: candidate.attempts + 1,
      maxAttempts: candidate.maxAttempts,
    };
  });
}

export function completeJob(id: number, result: Record<string, unknown>): void {
  const now = new Date();
  getDb()
    .update(schema.researchJobs)
    .set({ status: "succeeded", result: JSON.stringify(result), lockedBy: null, lockedUntil: null, updatedAt: now })
    .where(eq(schema.researchJobs.id, id))
    .run();
  logEvent(id, "succeeded");
}

/**
 * Retries with exponential backoff until `maxAttempts`, then marks the job dead so it
 * stops consuming worker slots but remains visible for diagnosis.
 */
export function failJob(id: number, error: string, now = new Date()): { retrying: boolean } {
  const db = getDb();
  const job = db.select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
  if (!job) return { retrying: false };

  const exhausted = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(2 ** job.attempts, 60) * 1_000;

  db.update(schema.researchJobs)
    .set({
      status: exhausted ? "dead" : "queued",
      lastError: error.slice(0, 2_000),
      lockedBy: null,
      lockedUntil: null,
      availableAt: exhausted ? job.availableAt : new Date(now.getTime() + backoffMs),
      updatedAt: now,
    })
    .where(eq(schema.researchJobs.id, id))
    .run();

  logEvent(id, exhausted ? "dead" : "retry_scheduled", error.slice(0, 500));
  return { retrying: !exhausted };
}

export function getJob(id: number) {
  return getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get() ?? null;
}

export function listJobs(status?: JobStatus, limit = 50) {
  const db = getDb();
  const query = db.select().from(schema.researchJobs);
  const rows = status ? query.where(eq(schema.researchJobs.status, status)).all() : query.all();
  return rows.sort((a, b) => b.id - a.id).slice(0, limit);
}

export function jobEvents(jobId: number) {
  return getDb()
    .select()
    .from(schema.researchJobEvents)
    .where(eq(schema.researchJobEvents.jobId, jobId))
    .all();
}

export function queueStats(): Record<JobStatus, number> {
  const rows = getDb()
    .select({ status: schema.researchJobs.status, count: sql<number>`count(*)` })
    .from(schema.researchJobs)
    .groupBy(schema.researchJobs.status)
    .all();

  const stats = { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 } as Record<JobStatus, number>;
  for (const row of rows) {
    if ((JOB_STATUSES as readonly string[]).includes(row.status)) {
      stats[row.status as JobStatus] = Number(row.count);
    }
  }
  return stats;
}
