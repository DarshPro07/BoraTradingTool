import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getMarketPhase } from "@/lib/market/phases";
import { getLearningMode } from "@/lib/governance/runtime";
import { queueStats } from "@/lib/research/queue";
import { runLearningCycle } from "@/lib/learning/cycle";
import { acquireLease, currentLease, releaseLease } from "@/lib/learning/lease";
import { databasePath } from "@/lib/db";

/**
 * The autonomous supervisor: one press of Start, then the machine runs itself.
 *
 * ## The ticker is in-process; the WORK is in the database
 *
 * The owner asked for two things that only look contradictory: "click Start, walk away, come back
 * to a machine still making progress", and "do not rely on in-memory timers for important work."
 *
 * They separate cleanly. The TICKER — the thing that decides *now is the time to act* — lives in
 * this process. The WORK lives in `research_jobs`, which is leased (`locked_until`), deduplicated
 * (`dedupe_key`) and retried (`attempts`). Killing the server therefore loses a TICK, never a unit
 * of work: an interrupted job's lease expires and `claimNextJob` hands it out again.
 *
 * That is the durable-execution pattern, on machinery this repository already had. Adopting a
 * workflow engine to obtain a property already satisfied would be migration risk, not durability.
 *
 * ## What this does NOT do
 *
 * It never raises its own permissions. `governanceCeiling` is copied from the learning mode at
 * start as a RECORD of what was permitted; the live mode is re-read every tick and can only be
 * changed by an authenticated owner through `/api/learning`. A machine that can lift its own
 * ceiling has no ceiling.
 */

export const LIVE_STATUSES = ["STARTING", "RUNNING", "DEGRADED"] as const;
export type RunStatus = (typeof LIVE_STATUSES)[number] | "STOPPED" | "CRASHED";

/** Operating mode, chosen from the exchange calendar and readiness — never by a person. */
export type MarketMode =
  | "BOOTSTRAP"
  | "PRE_MARKET"
  | "MARKET_OPEN"
  | "POST_MARKET"
  | "OFF_HOURS"
  | "RECOVERY"
  | "DEGRADED";

export const TICK_MS = 60_000;
/**
 * How long a run may go unheard-from before it is presumed dead.
 *
 * Generous relative to the tick because a cycle legitimately runs long — a research pass or a
 * backtest sweep can outlast several ticks, and declaring that CRASHED would restart work that was
 * progressing normally.
 */
export const STALE_MS = 5 * TICK_MS;

/**
 * The supervisor's OWN lease file — deliberately not the cycle lease.
 *
 * `runLearningCycle` already wraps its work in `withCycleLease` on the default path. Had the
 * supervisor taken that same lease it would have held it for the whole tick and then blocked the
 * very cycle it exists to run: a self-deadlock on the first tick, in which the machine reports
 * RUNNING forever and does nothing. Two locks, two questions — "who owns this runtime" and "who is
 * running a cycle right now".
 */
export function supervisorLeasePath(): string {
  return `${databasePath()}.supervisor-lease`;
}

/**
 * The lease expires exactly when the run it belongs to is declared CRASHED.
 *
 * One threshold governs both, so a killed server can be restarted and Start pressed again as soon
 * as its run is reconciled — rather than being refused for the lease library's default ten minutes
 * while `/brain` already says CRASHED, which reads as the product being broken.
 */
export const LEASE_TTL_MS = STALE_MS;

export interface AutonomousRun {
  id: string;
  status: RunStatus;
  runtimeProfile: string;
  governanceCeiling: string;
  marketMode: MarketMode;
  nextAction: string | null;
  lastCheckpoint: string | null;
  reason: string | null;
  ticks: number;
  host: string;
  pid: number;
  startedAt: Date;
  heartbeatAt: Date;
  stoppedAt: Date | null;
}

/**
 * The ticker handle, on `globalThis` rather than in a module variable.
 *
 * Next.js reloads modules on edit and can evaluate a route in more than one module registry. A
 * module-level timer would then leak a second ticker on every reload — two supervisors running the
 * same scanner, which is exactly the duplicate work the idempotency rule forbids.
 */
const TICKER = Symbol.for("marketpulse.supervisor.ticker");
interface TickerState {
  timer: NodeJS.Timeout | null;
  runId: string | null;
  ticking: boolean;
}
function ticker(): TickerState {
  const store = globalThis as unknown as Record<symbol, TickerState | undefined>;
  store[TICKER] ??= { timer: null, runId: null, ticking: false };
  return store[TICKER] as TickerState;
}

export function marketModeNow(at = new Date()): MarketMode {
  const phase = getMarketPhase("IN", at);
  if (phase.session === "CLOSED") return "OFF_HOURS";
  if (phase.sessionState === "PRE_OPEN") return "PRE_MARKET";
  if (phase.sessionState === "REGULAR") return "MARKET_OPEN";
  return "POST_MARKET";
}

function toRun(row: typeof schema.autonomousRuns.$inferSelect): AutonomousRun {
  return {
    id: row.id,
    status: row.status as RunStatus,
    runtimeProfile: row.runtimeProfile,
    governanceCeiling: row.governanceCeiling,
    marketMode: row.marketMode as MarketMode,
    nextAction: row.nextAction,
    lastCheckpoint: row.lastCheckpoint,
    reason: row.reason,
    ticks: row.ticks,
    host: row.host,
    pid: row.pid,
    startedAt: row.startedAt,
    heartbeatAt: row.heartbeatAt,
    stoppedAt: row.stoppedAt,
  };
}

/**
 * Reconcile runs whose process died without stopping.
 *
 * A phantom RUNNING row is worse than no row: it tells the owner the machine is working when
 * nothing is, which is the precise failure `/brain` exists to prevent. Interrupted jobs need no
 * repair here — their leases expire and `claimNextJob` reissues them.
 */
export function reconcileStaleRuns(now = new Date()): number {
  const db = getDb();
  const cutoff = new Date(now.getTime() - STALE_MS);
  const live = db
    .select()
    .from(schema.autonomousRuns)
    .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
    .all();

  const stale = live.filter((row) => row.heartbeatAt.getTime() < cutoff.getTime());
  for (const row of stale) {
    // Only this process can vouch for its own ticker. A row owned by a PID that is no longer us
    // may belong to a different server entirely, so it is reconciled rather than adopted.
    db.update(schema.autonomousRuns)
      .set({
        status: "CRASHED",
        stoppedAt: now,
        reason:
          `No heartbeat since ${row.heartbeatAt.toISOString()} (older than ${Math.round(STALE_MS / 1000)}s). ` +
          "The process ended without stopping. Queued work was not lost — job leases expire and are reclaimed.",
      })
      // Scoped to the row being reconciled. Filtering only by status would mark every live run
      // CRASHED because one was stale — harmless while the unique index permits a single live row,
      // and a silent killer the moment that changes.
      .where(eq(schema.autonomousRuns.id, row.id))
      .run();

    // Free the dead run's lease. Without this a killed server stays locked out for the whole TTL
    // while `/brain` already says CRASHED — which reads as the product being broken, and is exactly
    // the "kill it, restart it, press Start" path the recovery requirement describes.
    // Read the record regardless of expiry: we know this holder is gone.
    const held = heldBy(row.id);
    if (held) releaseLease(held.holder, held.acquiredAt, supervisorLeasePath());
  }
  return stale.length;
}

/** The lease record for a holder, ignoring expiry — used when we already know the holder is dead. */
function heldBy(holder: string): { holder: string; acquiredAt: number } | null {
  const record = currentLease(supervisorLeasePath(), 0, Number.MAX_SAFE_INTEGER);
  return record && record.holder === holder ? record : null;
}

/** The live run, if any. Reconciles stale rows first so a phantom is never reported as running. */
export function liveRun(now = new Date()): AutonomousRun | null {
  reconcileStaleRuns(now);
  const row = getDb()
    .select()
    .from(schema.autonomousRuns)
    .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
    .orderBy(desc(schema.autonomousRuns.startedAt))
    .get();
  return row ? toRun(row) : null;
}

export function lastRun(): AutonomousRun | null {
  const row = getDb()
    .select()
    .from(schema.autonomousRuns)
    .orderBy(desc(schema.autonomousRuns.startedAt))
    .get();
  return row ? toRun(row) : null;
}

function audit(action: string, subject: string, detail: string, actor: string, at: Date): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor,
      action,
      decision: "allowed",
      denialCode: null,
      subject,
      detail,
      learningMode: null,
      createdAt: at,
    })
    .run();
}

export interface StartResult {
  run: AutonomousRun;
  /** False when an existing run was returned instead of a new one being created. */
  created: boolean;
}

/**
 * Start the machine, or return the one already running.
 *
 * IDEMPOTENT BY CONSTRUCTION. Two clicks milliseconds apart both read "nothing live" and both try
 * to insert — the classic check-then-act race, and losing it means every scanner, ingestion and
 * research job runs twice. The partial unique index in `0016_autonomous_runs.sql` makes the second
 * insert fail at the storage layer, so the race cannot be lost rather than merely being unlikely.
 */
export function startAutonomousRun(
  runtimeProfile: string,
  actor = "owner:studio",
  now = new Date(),
  /**
   * How ticking begins. Injected for the same reason `runLearningCycle` injects its loaders: the
   * default reaches the real cycle, so a test that merely asserts idempotency would otherwise run
   * research, backtests and quant passes as a side effect of pressing a button.
   */
  startTicking: (runId: string) => void = ensureTicking,
): StartResult {
  const existing = liveRun(now);
  if (existing) {
    // Adopt the ticker if this process owns the row but lost its timer to a module reload.
    if (existing.pid === process.pid) startTicking(existing.id);
    return { run: existing, created: false };
  }

  const run = {
    id: `arun_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    status: "STARTING" as const,
    runtimeProfile,
    governanceCeiling: getLearningMode(),
    marketMode: marketModeNow(now),
    nextAction: "Starting the autonomous runtime.",
    lastCheckpoint: null,
    reason: null,
    ticks: 0,
    host: hostname(),
    pid: process.pid,
    startedAt: now,
    heartbeatAt: now,
    stoppedAt: null,
  };

  // SINGLETON ACROSS PROCESSES. The unique index stops two requests inside one server; this stops a
  // second Node process pointed at the same database, which the index cannot see.
  const lease = acquireLease(run.id, supervisorLeasePath(), now.getTime(), LEASE_TTL_MS);
  if (lease === null) {
    const holder = currentLease(supervisorLeasePath(), now.getTime(), LEASE_TTL_MS);
    throw new Error(
      `SUPERVISOR_ALREADY_OWNED: another process holds the runtime lease (${holder?.holder ?? "unknown"}). ` +
        "Only one autonomous supervisor may own a database.",
    );
  }

  try {
    getDb().insert(schema.autonomousRuns).values(run).run();
  } catch (caught) {
    releaseLease(lease.holder, lease.acquiredAt, supervisorLeasePath());
    // The unique index fired: another request won the race. Its run is the answer.
    const winner = liveRun(now);
    if (winner) return { run: winner, created: false };
    throw caught;
  }

  audit(
    "autonomous_run_start",
    run.id,
    `profile=${runtimeProfile} ceiling=${run.governanceCeiling} mode=${run.marketMode}`,
    actor,
    now,
  );
  startTicking(run.id);
  return { run: toRun(run as typeof schema.autonomousRuns.$inferSelect), created: true };
}

export function stopAutonomousRun(reason: string, actor = "owner:studio", now = new Date()): AutonomousRun | null {
  const run = liveRun(now);
  if (!run) return null;

  clearTicking();
  // Read the holder record rather than reconstructing `acquiredAt` from `startedAt`: drizzle stores
  // timestamps truncated to whole seconds while the lease records milliseconds, so a reconstructed
  // value would never match and the lease would silently outlive the run that owned it.
  const held = currentLease(supervisorLeasePath(), now.getTime(), LEASE_TTL_MS);
  if (held?.holder === run.id) releaseLease(held.holder, held.acquiredAt, supervisorLeasePath());
  getDb()
    .update(schema.autonomousRuns)
    .set({ status: "STOPPED", stoppedAt: now, reason, nextAction: null })
    .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
    .run();

  audit("autonomous_run_stop", run.id, reason, actor, now);
  return { ...run, status: "STOPPED", stoppedAt: now, reason };
}

function clearTicking(): void {
  const state = ticker();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.runId = null;
}

function ensureTicking(runId: string): void {
  const state = ticker();
  if (state.timer && state.runId === runId) return;
  if (state.timer) clearInterval(state.timer);

  state.runId = runId;
  state.timer = setInterval(() => {
    void tick(runId);
  }, TICK_MS);
  // Never hold the process open for a heartbeat. Ticking is not a reason to refuse to exit.
  state.timer.unref?.();

  void tick(runId);
}

/**
 * One supervisor tick.
 *
 * DEGRADED IS STILL RUNNING. A provider outage must not stop the deterministic data and market
 * work that never needed the provider, so a failed cycle records its reason and the machine keeps
 * ticking. Only an explicit stop ends a run.
 */
export async function tick(runId: string, now = new Date()): Promise<void> {
  const state = ticker();
  // A long cycle must not be re-entered by the next tick — that would double every job it enqueues.
  if (state.ticking) return;
  state.ticking = true;

  const db = getDb();
  try {
    const row = db.select().from(schema.autonomousRuns).where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES])).get();
    if (!row || row.id !== runId) {
      clearTicking();
      return;
    }

    /**
     * RENEW THE LEASE. `acquiredAt` is fixed at acquisition, so a lease whose TTL equals the
     * staleness threshold would be judged expired after five minutes of perfectly healthy running
     * — and another process could take ownership of a live runtime. The heartbeat and the lease
     * must age together, so both are refreshed here.
     */
    const held = currentLease(supervisorLeasePath(), 0, Number.MAX_SAFE_INTEGER);
    if (held?.holder === runId) {
      releaseLease(held.holder, held.acquiredAt, supervisorLeasePath());
      acquireLease(runId, supervisorLeasePath(), now.getTime(), LEASE_TTL_MS);
    }

    const mode = marketModeNow(now);
    db.update(schema.autonomousRuns)
      .set({
        status: "RUNNING",
        heartbeatAt: now,
        marketMode: mode,
        ticks: row.ticks + 1,
        // The live mode, re-read every tick. The supervisor can read this; it can never write it.
        governanceCeiling: getLearningMode(),
        nextAction: `Running the ${mode.toLowerCase().replace("_", " ")} cycle.`,
      })
      .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
      .run();

    const report = await runLearningCycle(`supervisor-${runId}`);
    const stats = queueStats();
    const skipped = Array.isArray(report?.skipped) ? report.skipped : [];

    db.update(schema.autonomousRuns)
      .set({
        status: skipped.length > 0 ? "DEGRADED" : "RUNNING",
        heartbeatAt: new Date(),
        lastCheckpoint: `queued=${stats.queued} running=${stats.running} succeeded=${stats.succeeded} failed=${stats.failed}`,
        reason: skipped.length > 0 ? skipped.join(" · ") : null,
        nextAction: "Waiting for the next cycle.",
      })
      .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
      .run();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
    db.update(schema.autonomousRuns)
      .set({
        status: "DEGRADED",
        heartbeatAt: new Date(),
        reason: `Cycle failed: ${message}`,
        nextAction: "Retrying on the next tick.",
      })
      .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
      .run();
  } finally {
    state.ticking = false;
  }
}
