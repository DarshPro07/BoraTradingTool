import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { blockDependentsOnFailure, wouldCreateCycle, validateDependencies } from "./dependencies";
import { emit } from "@/lib/brain/event-bus";

export const JOB_KINDS = [
  "ingest_paper",
  "ingest_video",
  "ingest_repository",
  "ingest_web",
  "dedupe_hypotheses",
  /**
   * Fetch, validate and persist daily history for one instrument — the first REMEDIATION kind.
   *
   * The queue held only research-intake kinds, so the machine could describe a missing
   * prerequisite but never act on it: rehearsal reported "the canonical store holds no bars …
   * the gap is an ingestion task" every cycle, and the same sentence reappeared forever because
   * nothing owned the task it named. The dependency-resolver behaviour starts here — a blocked
   * workflow enqueues the work that unblocks it, and the queue's lease/retry/dedupe machinery
   * makes that remediation durable rather than a fire-and-forget call inside one tick.
   */
  "ingest_history",
  /**
   * Grade every archived forecast the canonical store can now resolve.
   *
   * The event-driven half already runs on DATA_INGESTED (lib/forecast/resolver.ts); this kind is
   * the same operation as DURABLE, ENQUEUEABLE work — the reconciliation path anything (API, MCP,
   * a dependency declaration) can schedule and /jobs can show. Idempotent by the grading ledger,
   * so the two paths cannot double-grade.
   */
  "forecast_resolve",
  /**
   * The system checking its own memory: orphaned knowledge, repeated failure modes, integrity.
   *
   * First of the quant-company kinds beyond data plumbing. The remaining ladder —
   * instrument_research, hypothesis_generate, strategy_generate, holdout_decision,
   * forward_enroll, forward_resolve, paper_order, paper_reconcile, incident_repair — lands kind
   * by kind WITH a real handler, dedupe identity and dependency declarations. A kind whose
   * handler does not exist is not added: a decorative enum entry is exactly the "agents that are
   * prompt files" failure this queue exists to avoid.
   */
  "memory_validate",
  /**
   * Run a strategy's backtest over the canonical store and persist the experiment.
   *
   * A READ capability (`run_backtest`, `AUTONOMOUS_PERMITTED`): deterministic, no network,
   * re-runnable, spends nothing irreversible. This is the first link of the continuous chain —
   * its `BACKTEST_COMPLETED` event (carrying the REAL specId, which the engine's own emit does
   * not) is what wakes a dependent validation job.
   */
  "backtest",
  /**
   * Run the statistical validation gauntlet on a rehearsed candidate.
   *
   * DELIBERATELY NOT AUTONOMOUSLY ENQUEUED. The gauntlet spends a PERMANENT, IRREVERSIBLE trial
   * (it raises the multiple-testing bar for the whole family forever — CLAUDE.md forbids running
   * it speculatively), so the handler double-gates: it requires `confirmed: true` in the payload
   * AND is authorized by the deterministic Trial Budget Governor (`authorizeTrial`, off by
   * default), refusing-without-spending on either miss. Nothing in the autonomous loop creates
   * this job; it exists as a durable, owner/API-triggered link so the chain CAN complete under
   * explicit authority without a new bespoke code path.
   */
  "validation",
  /**
   * Reconcile the paper-forward stage: fill accepted orders at the next bar, close decided
   * positions, update account cash and position outcomes. Deterministic and bar-time only (never a
   * live quote), idempotent (order states are terminal — a re-run skips FILLED/REJECTED). A
   * reconciliation kind, not a spend: it advances the paper state machine on recorded bars.
   */
  "paper_reconcile",
  /**
   * The self-repair pass: fix declared strategy costs that fall below the published fee schedule
   * (provably-wrong arithmetic), and REPORT — never silently fix — capital drift. Deterministic
   * (compares against an external fee fact, no model), idempotent (already-honest costs are
   * skipped), audited before/after. It never deletes, never touches code or governance. Already
   * runs inside the learning cycle; exposing it as a durable kind lets it be scheduled or
   * dependency-chained without a new bespoke path.
   */
  "incident_repair",
  /**
   * Research one instrument through the Agent Runtime — the first agent-family durable kind.
   *
   * The handler resolves the static AgentDefinition (`research.instrument.v1`), routes the RESEARCH
   * capability through the existing gateway/bridge, records an AgentRun with agent+job provenance,
   * and emits RESEARCH_COMPLETED so a dependent job can wake. The Job OS owns the lifecycle; the
   * agent only reasons and RECOMMENDS — it spends no trial and places no order. A missing history
   * returns to the dependency resolver (ingest + dependent research), never a blind retry.
   */
  "instrument_research",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * Job statuses.
 *
 * `waiting_dependency` and `blocked_dependency` are DISTINCT from `queued`:
 * - `queued` = ready to run, just waiting for a worker
 * - `waiting_dependency` = intentionally paused, dependencies not yet satisfied
 * - `blocked_dependency` = permanently stuck, a dependency died/errored and will never succeed
 *
 * This distinction lets Brain tell the owner "research is paused because data ingestion failed"
 * rather than silently showing a forever-queued job.
 */
export const JOB_STATUSES = [
  "queued",
  "waiting_dependency",
  "blocked_dependency",
  "running",
  "succeeded",
  "failed",
  "dead",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const DEFAULT_LEASE_MS = 5 * 60_000;

/**
 * Terminal-failure taxonomy — "failure without infinite looping".
 *
 * A dead job is not one thing. `SOURCE_UNAVAILABLE` describes the last ten minutes of network;
 * `INSTRUMENT_UNKNOWN` describes the exchange's listing history. Treating them alike produced
 * both failure modes at once: doomed jobs burned their full retry budget on an instrument that
 * can never exist, while a transient outage's corpse held its dedupe key forever and blocked
 * every future remediation of a perfectly recoverable gap.
 *
 * Classification reads the `CODE:` prefix the worker already throws (`ingest.ts` outcome codes),
 * so no second error channel exists to drift from the first. Unrecognized errors default to
 * RETRYABLE: wrongly retrying a doomed job costs a bounded attempt budget, wrongly blocking a
 * recoverable one forever is the defect this taxonomy exists to fix.
 */
export type FailureClass = "PERMANENT" | "RETRYABLE";

/** Codes that describe a fact about the world, not about the moment. Waiting cannot change them. */
const PERMANENT_CODES = ["INSTRUMENT_UNKNOWN"] as const;

/** How long a RETRYABLE corpse cools before its dedupe key stops answering for it. */
export const REVIVAL_COOLDOWN_MS = 15 * 60_000;

export function failureClass(lastError: string | null): FailureClass {
  if (!lastError) return "RETRYABLE";
  return PERMANENT_CODES.some((code) => lastError.startsWith(code)) ? "PERMANENT" : "RETRYABLE";
}

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

export function logEvent(jobId: number, event: string, detail?: string): void {
  getDb()
    .insert(schema.researchJobEvents)
    .values({ jobId, event, detail: detail ?? null, createdAt: new Date() })
    .run();
}

export function enqueue(input: EnqueueInput): { id: number; deduped: boolean; revived?: boolean } {
  const db = getDb();
  const now = new Date();

  // One transaction around check-then-act. Two processes racing the same dedupe key (the web
  // server and the MCP server both remediating one gap) must not both observe "dead, cooled" and
  // both log a revival — or both observe "absent" and insert two rows for one key. Same
  // discipline as `claimNextJob`, found by independent review rather than by a production race.
  return db.transaction(() => enqueueInTransaction(input, now));
}

function enqueueInTransaction(
  input: EnqueueInput,
  now: Date,
): { id: number; deduped: boolean; revived?: boolean } {
  const db = getDb();

  if (input.dedupeKey) {
    const existing = db
      .select()
      .from(schema.researchJobs)
      .where(eq(schema.researchJobs.dedupeKey, input.dedupeKey))
      .get();
    if (existing) {
      /**
       * A dead row answering for its dedupe key is the RETRY_AFTER / BLOCKED_PERMANENT split.
       *
       * Before this, dedupe matched corpses too, so one exhausted transient failure blocked the
       * same remediation forever: the cycle re-entered the gap branch, was deduped against a job
       * that would never run again, and truthfully-sounding "already queued" text described a
       * grave. A RETRYABLE corpse now revives — same row, fresh attempt budget, failure history
       * intact — once `REVIVAL_COOLDOWN_MS` has passed, so the enqueue cadence (every cycle)
       * cannot itself become the retry loop. A PERMANENT corpse never revives: waiting does not
       * list an instrument the exchange never listed.
       */
      if (existing.status === "dead" && failureClass(existing.lastError) === "RETRYABLE") {
        const cooled = now.getTime() - existing.updatedAt.getTime() >= REVIVAL_COOLDOWN_MS;
        if (cooled) {
          db.update(schema.researchJobs)
            .set({
              status: "queued",
              attempts: 0,
              availableAt: now,
              lockedBy: null,
              lockedUntil: null,
              updatedAt: now,
            })
            .where(eq(schema.researchJobs.id, existing.id))
            .run();
          logEvent(
            existing.id,
            "revived",
            `Retryable failure cooled down; attempts reset. Was: ${existing.lastError?.slice(0, 300) ?? "unknown"}`,
          );
          return { id: existing.id, deduped: false, revived: true };
        }
      }
      return { id: existing.id, deduped: true };
    }
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
  emit({ kind: "JOB_CREATED", jobId: id, jobKind: input.kind, capability: "research.worker" });
  return { id, deduped: false };
}

/**
 * Claims the highest-priority available job with a time-bounded lease. A worker that
 * crashes mid-job leaves an expired lease, and the job becomes claimable again rather
 * than being stranded in "running" forever.
 *
 * DEPENDENCY-AWARE: a job with unsatisfied dependencies is never claimed. Instead, the
 * next eligible job is considered. This keeps workers simple — they just claim and run —
 * while the scheduler respects the dependency graph.
 */
export function claimNextJob(workerId: string, now = new Date(), leaseMs = DEFAULT_LEASE_MS): ClaimedJob | null {
  const db = getDb();

  return db.transaction((tx) => {
    // Fetch candidates in priority order — more than one because some may be blocked.
    const candidates = tx
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
      .limit(20)
      .all();

    // Pick the first candidate whose dependencies are all satisfied.
    let candidate: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      const deps = tx
        .select({ dependsOnId: schema.jobDependencies.dependsOnId })
        .from(schema.jobDependencies)
        .where(eq(schema.jobDependencies.jobId, c.id))
        .all();
      if (deps.length === 0) {
        candidate = c;
        break;
      }
      // Check if all dependencies succeeded.
      const statuses = tx
        .select({ status: schema.researchJobs.status })
        .from(schema.researchJobs)
        .where(
          inArray(
            schema.researchJobs.id,
            deps.map((d) => d.dependsOnId),
          ),
        )
        .all();
      if (statuses.length > 0 && statuses.every((s) => s.status === "succeeded")) {
        candidate = c;
        break;
      }
    }

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

    emit({ kind: "JOB_STARTED", jobId: candidate.id, workerId });

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
  getDb().transaction(() => {
    getDb()
      .update(schema.researchJobs)
      .set({ status: "succeeded", result: JSON.stringify(result), lockedBy: null, lockedUntil: null, updatedAt: now })
      .where(eq(schema.researchJobs.id, id))
      .run();
    emit({ kind: "JOB_COMPLETED", jobId: id, result: "succeeded" });
  });
  logEvent(id, "succeeded");

  // Unblock any jobs that were waiting for this one.
  const unblocked = unblockDependents(id);
  for (const unblockedId of unblocked) {
    logEvent(unblockedId, "unblocked", `Dependency ${id} succeeded.`);
  }
}

/**
 * Retries with exponential backoff until `maxAttempts`, then marks the job dead so it
 * stops consuming worker slots but remains visible for diagnosis.
 */
export function failJob(id: number, error: string, now = new Date()): { retrying: boolean } {
  const db = getDb();
  const job = db.select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
  if (!job) return { retrying: false };

  // A PERMANENT failure is dead on the spot. Retrying "the exchange never listed this" three
  // times is not diligence — it mislabels a truthful refusal as a flaky operation and delays the
  // moment /jobs shows the real answer.
  const permanent = failureClass(error) === "PERMANENT";
  const exhausted = permanent || job.attempts >= job.maxAttempts;
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

  if (exhausted) {
    emit({ kind: "JOB_FAILED", jobId: id, error: error.slice(0, 500), attempt: job.attempts });
  }

  // "dead_permanent" vs "dead": the trail says whether the job died of its NATURE or of
  // exhaustion — the first thing a /jobs diagnosis wants to know.
  logEvent(id, exhausted ? (permanent ? "dead_permanent" : "dead") : "retry_scheduled", error.slice(0, 500));

  // TERMINAL FAILURE: propagate to dependents so they don't wait forever.
  if (exhausted) {
    const blocked = blockDependentsOnFailure(id);
    for (const blockedId of blocked) {
      logEvent(blockedId, "cascade_blocked", `Dependency ${id} exhausted retries.`);
    }
  }

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

  const stats = {
    queued: 0,
    waiting_dependency: 0,
    blocked_dependency: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
  } as Record<JobStatus, number>;
  for (const row of rows) {
    if ((JOB_STATUSES as readonly string[]).includes(row.status)) {
      stats[row.status as JobStatus] = Number(row.count);
    }
  }
  return stats;
}

/**
 * Job dependency graph — the missing operating-system behavior.
 *
 * A job can WAIT for other jobs to finish before it becomes claimable. The claim query then
 * never returns a job whose dependencies are not yet satisfied, so workers stay ignorant of
 * dependencies entirely.
 */

export interface DependencyInput {
  /** The job that depends on others. */
  jobId: number;
  /** The jobs that must succeed before `jobId` can be claimed. */
  dependsOnIds: number[];
}

/**
 * Record that a job depends on others. The dependent job stays in "queued" but is skipped by
 * `claimNextJob` until all its dependencies succeed.
 *
 * Self-dependencies and cycles are rejected — they would create an unbreakable wait.
 */
export function addJobDependencies(input: DependencyInput): void {
  const db = getDb();
  const now = new Date();
  for (const depId of input.dependsOnIds) {
    if (depId === input.jobId) continue;
    if (wouldCreateCycle(input.jobId, depId)) continue;
    db.insert(schema.jobDependencies)
      .values({ jobId: input.jobId, dependsOnId: depId, createdAt: now })
      .onConflictDoNothing()
      .run();
  }
}

/**
 * Which of a job's dependencies have NOT yet succeeded.
 */
export function pendingDependencies(jobId: number): number[] {
  const db = getDb();
  const deps = db
    .select({ dependsOnId: schema.jobDependencies.dependsOnId })
    .from(schema.jobDependencies)
    .where(eq(schema.jobDependencies.jobId, jobId))
    .all();
  if (deps.length === 0) return [];

  const statuses = db
    .select({ id: schema.researchJobs.id, status: schema.researchJobs.status })
    .from(schema.researchJobs)
    .where(
      inArray(
        schema.researchJobs.id,
        deps.map((d) => d.dependsOnId),
      ),
    )
    .all();

  const succeeded = new Set(statuses.filter((s) => s.status === "succeeded").map((s) => s.id));
  return deps.map((d) => d.dependsOnId).filter((id) => !succeeded.has(id));
}

/**
 * After a job succeeds, check if any waiting jobs were blocked ONLY by this one and are now
 * fully unblocked. Returns the IDs of jobs that just became claimable.
 *
 * Transitions `waiting_dependency` → `queued` so the job is now eligible for claiming.
 */
export function unblockDependents(completedJobId: number): number[] {
  const db = getDb();
  // Find all jobs that depend on the completed job.
  const blocked = db
    .select({ jobId: schema.jobDependencies.jobId })
    .from(schema.jobDependencies)
    .where(eq(schema.jobDependencies.dependsOnId, completedJobId))
    .all();

  const newlyUnblocked: number[] = [];
  for (const { jobId } of blocked) {
    // Still waiting and now has no pending dependencies?
    const job = db
      .select({ status: schema.researchJobs.status })
      .from(schema.researchJobs)
      .where(eq(schema.researchJobs.id, jobId))
      .get();
    if (job && job.status === "waiting_dependency" && pendingDependencies(jobId).length === 0) {
      // Transition to queued — now eligible for claiming.
      db.update(schema.researchJobs)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(schema.researchJobs.id, jobId))
        .run();
      newlyUnblocked.push(jobId);
    }
  }
  return newlyUnblocked;
}

/**
 * Enqueue a job that depends on others. Convenience wrapper around `enqueue` + `addJobDependencies`.
 *
 * Validates that all dependencies exist and that adding them would not create a cycle.
 * If validation fails, the job is still created but immediately marked `blocked_dependency`
 * with the reason recorded — never silently runnable on a phantom dependency.
 */
export function enqueueDependent(
  input: EnqueueInput,
  dependsOnIds: number[],
): { id: number; deduped: boolean; blocked: boolean; reasons: string[] } {
  const result = enqueue(input);
  const reasons: string[] = [];

  if (result.deduped || dependsOnIds.length === 0) {
    return { ...result, blocked: false, reasons };
  }

  // Validate: all dependency targets must exist.
  const missing = validateDependencies(result.id, dependsOnIds);
  if (missing.length > 0) {
    reasons.push(`Dependencies not found: ${missing.join(", ")}`);
  }

  // Validate: no cycles.
  const validIds = dependsOnIds.filter((id) => !missing.includes(id));
  for (const depId of validIds) {
    if (wouldCreateCycle(result.id, depId)) {
      reasons.push(`Cycle detected: ${result.id} -> ${depId}`);
    }
  }

  if (reasons.length > 0) {
    // Block the job — it can never run with invalid dependencies.
    getDb()
      .update(schema.researchJobs)
      .set({ status: "blocked_dependency", lastError: reasons.join("; "), updatedAt: new Date() })
      .where(eq(schema.researchJobs.id, result.id))
      .run();
    logEvent(result.id, "blocked_dependency", reasons.join("; "));
    return { ...result, blocked: true, reasons };
  }

  addJobDependencies({ jobId: result.id, dependsOnIds: validIds });
  // Mark as waiting_dependency — distinct from "queued" (which means ready to run).
  getDb()
    .update(schema.researchJobs)
    .set({ status: "waiting_dependency", updatedAt: new Date() })
    .where(eq(schema.researchJobs.id, result.id))
    .run();
  return { ...result, blocked: false, reasons: [] };
}
