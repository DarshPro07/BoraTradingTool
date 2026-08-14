import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { logEvent } from "./queue";
import type { JobKind, JobStatus } from "./queue";

// ── Failure propagation ────────────────────────────────────────────────────────

/**
 * A job's dependency failed permanently. Propagate: every job depending on it
 * becomes `blocked_dependency` — it will never run, and Brain can explain why.
 *
 * Cascades transitively: if B depends on dead A, and C depends on B, then C is
 * also blocked. Returns the IDs of all newly-blocked jobs.
 */
export function blockDependentsOnFailure(failedJobId: number): number[] {
  const db = getDb();
  const dependents = db
    .select({ jobId: schema.jobDependencies.jobId })
    .from(schema.jobDependencies)
    .where(eq(schema.jobDependencies.dependsOnId, failedJobId))
    .all();

  const newlyBlocked: number[] = [];
  for (const { jobId } of dependents) {
    const job = db
      .select({ status: schema.researchJobs.status })
      .from(schema.researchJobs)
      .where(eq(schema.researchJobs.id, jobId))
      .get();
    // Only block jobs still waiting. Don't overwrite a terminal state.
    if (job && (job.status === "queued" || job.status === "waiting_dependency")) {
      db.update(schema.researchJobs)
        .set({
          status: "blocked_dependency",
          lastError: `Dependency ${failedJobId} failed permanently.`,
          updatedAt: new Date(),
        })
        .where(eq(schema.researchJobs.id, jobId))
        .run();
      logEvent(jobId, "blocked_dependency", `Dependency ${failedJobId} is dead/failed.`);
      newlyBlocked.push(jobId);
      // Cascade: this job's dependents are also blocked.
      newlyBlocked.push(...blockDependentsOnFailure(jobId));
    }
  }
  return [...new Set(newlyBlocked)];
}

// ── Cycle detection ────────────────────────────────────────────────────────────

/**
 * Detect a dependency cycle before it creates an unbreakable loop.
 *
 * Uses DFS following dependency edges. If we can reach `jobId` from any of its
 * own dependencies, adding this edge would create a cycle.
 */
export function wouldCreateCycle(jobId: number, dependsOnId: number): boolean {
  if (jobId === dependsOnId) return true;
  const db = getDb();
  const visited = new Set<number>();
  const stack = [dependsOnId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === jobId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = db
      .select({ dependsOnId: schema.jobDependencies.dependsOnId })
      .from(schema.jobDependencies)
      .where(eq(schema.jobDependencies.jobId, current))
      .all();
    for (const dep of deps) {
      if (!visited.has(dep.dependsOnId)) stack.push(dep.dependsOnId);
    }
  }
  return false;
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate that all dependency targets exist before recording them.
 * Returns the IDs of dependencies that don't exist (for explicit error reporting).
 */
export function validateDependencies(jobId: number, dependsOnIds: number[]): number[] {
  const db = getDb();
  const existing = db
    .select({ id: schema.researchJobs.id })
    .from(schema.researchJobs)
    .where(inArray(schema.researchJobs.id, dependsOnIds))
    .all();
  const existingIds = new Set(existing.map((r) => r.id));
  return dependsOnIds.filter((id) => !existingIds.has(id));
}

// ── Report ─────────────────────────────────────────────────────────────────────

export interface DependencyReport {
  jobId: number;
  status: JobStatus;
  dependencies: { id: number; status: JobStatus; kind: JobKind | null }[];
  blockedBy: number[];
  dependents: { id: number; status: JobStatus; kind: JobKind | null }[];
}

export function dependencyReport(jobId: number): DependencyReport {
  const db = getDb();
  const job = db.select().from(schema.researchJobs).where(eq(schema.researchJobs.id, jobId)).get();
  if (!job) throw new Error(`Job ${jobId} not found`);

  const deps = db
    .select({ dependsOnId: schema.jobDependencies.dependsOnId })
    .from(schema.jobDependencies)
    .where(eq(schema.jobDependencies.jobId, jobId))
    .all();

  const depRows = deps.length
    ? db
        .select({ id: schema.researchJobs.id, status: schema.researchJobs.status, kind: schema.researchJobs.kind })
        .from(schema.researchJobs)
        .where(inArray(schema.researchJobs.id, deps.map((d) => d.dependsOnId)))
        .all()
    : [];

  const depMap = new Map(depRows.map((r) => [r.id, r]));
  const blockedBy = deps
    .map((d) => depMap.get(d.dependsOnId))
    .filter((r) => r && (r.status === "dead" || r.status === "failed" || r.status === "blocked_dependency"))
    .map((r) => r!.id);

  const revDeps = db
    .select({ jobId: schema.jobDependencies.jobId })
    .from(schema.jobDependencies)
    .where(eq(schema.jobDependencies.dependsOnId, jobId))
    .all();

  const revRows = revDeps.length
    ? db
        .select({ id: schema.researchJobs.id, status: schema.researchJobs.status, kind: schema.researchJobs.kind })
        .from(schema.researchJobs)
        .where(inArray(schema.researchJobs.id, revDeps.map((d) => d.jobId)))
        .all()
    : [];

  return {
    jobId,
    status: job.status as JobStatus,
    dependencies: deps.map((d) => {
      const info = depMap.get(d.dependsOnId);
      return {
        id: d.dependsOnId,
        status: (info?.status ?? "queued") as JobStatus,
        kind: (info?.kind ?? null) as JobKind | null,
      };
    }),
    blockedBy,
    dependents: revRows.map((r) => ({
      id: r.id,
      status: r.status as JobStatus,
      kind: r.kind as JobKind | null,
    })),
  };
}
