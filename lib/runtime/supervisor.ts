import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getMarketPhase } from "@/lib/market/phases";
import { getLearningMode } from "@/lib/governance/runtime";
import { queueStats } from "@/lib/research/queue";
import { runLearningCycle } from "@/lib/learning/cycle";
import { acquireLease, currentLease, releaseLease, researchLeasePath, withCycleLease } from "@/lib/learning/lease";
import { runWorker } from "@/lib/research/worker";
import { sharedSyntaxResolver } from "@/lib/research/syntax/resolver";
import { databasePath } from "@/lib/db";
import { emit, subscribe } from "@/lib/brain/event-bus";
import { updateCapabilityHealth } from "@/lib/brain/capability-registry";
import { degradingMessages } from "@/lib/learning/reasons";
import { registerForecastResolver } from "@/lib/forecast/resolver";

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
 * The RESEARCH lane's interval — deliberately much shorter than `TICK_MS`.
 *
 * AUTO's lanes were sequential by construction: one 60s tick awaited one learning cycle, and the
 * research worker ran as a phase INSIDE that cycle body. Lane overlap was therefore impossible,
 * and the honest e2e measurement said so.
 *
 * The research lane now drains the durable queue on its own timer, under its own lease
 * (`researchLeasePath()`), so queued work starts when it arrives rather than waiting for the next
 * cycle — and OBSERVE/LEARN and RESEARCH genuinely overlap in wall-clock time.
 *
 * Five seconds is short enough that overlap with a 60s cycle is the normal case rather than a
 * coincidence, and long enough that an idle queue costs one cheap indexed query per tick.
 */
export const RESEARCH_TICK_MS = 5_000;
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
  /** The RESEARCH lane's own timer — see `RESEARCH_TICK_MS`. */
  researchTimer: NodeJS.Timeout | null;
  /** Non-reentrancy for the research lane, independent of the cycle's `ticking`. */
  researchDraining: boolean;
}
function ticker(): TickerState {
  const store = globalThis as unknown as Record<symbol, TickerState | undefined>;
  store[TICKER] ??= {
    timer: null,
    runId: null,
    ticking: false,
    researchTimer: null,
    researchDraining: false,
  };
  const state = store[TICKER] as TickerState;
  // A ticker created by an older module registry (see the note above) predates these fields.
  state.researchTimer ??= null;
  state.researchDraining ??= false;
  return state;
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
  emit({ kind: "AUTONOMOUS_RUN_STARTED", runId: run.id, profile: runtimeProfile, at: now.toISOString() });
  updateCapabilityHealth("system.scheduler", "ACTIVE", "Autonomous runtime ticking");
  startTicking(run.id);
  warmSyntaxParser();
  return { run: toRun(run as typeof schema.autonomousRuns.$inferSelect), created: true };
}

/**
 * Pay the parser's startup cost now, so no click ever pays it.
 *
 * MEASURED on this machine, 2026-08-11: `import spacy` 14.5s + `spacy.load("en_core_web_sm")`
 * 20.7s — because `torch` and `transformers` are both dragged in by installed spaCy entry points,
 * for a small model that needs neither. Once warm, an interpretation costs ~530ms.
 *
 * That 35 seconds has to happen somewhere. Before this it happened on the owner's first click on
 * "interpret my idea", which is indistinguishable from a broken button. Here it happens while the
 * runtime is starting, which is the moment the product already says it is doing work.
 *
 * Deliberately fire-and-forget and deliberately silent: an unconfigured parser is already reported
 * by the readiness surface's "Syntax parser" row, and failing the Start button over a dependency
 * that only strategy authoring needs would take the whole machine down for one lane.
 */
function warmSyntaxParser(): void {
  // Never inside the test runner. `startAutonomousRun` is exercised by many tests, and on a machine
  // where SYNTAX_PARSER_PYTHON happens to be exported each one would spawn a 35-second interpreter
  // — a suite that passes or times out depending on the developer's shell.
  if (process.env.VITEST !== undefined) return;
  try {
    void sharedSyntaxResolver()
      .health()
      .catch(() => {});
  } catch {
    // Not configured. Readiness says so, with the reason and the fix.
  }
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
  emit({ kind: "AUTONOMOUS_RUN_STOPPED", runId: run.id, reason, at: now.toISOString() });
  updateCapabilityHealth("system.scheduler", "READY", "Autonomous runtime stopped");
  return { ...run, status: "STOPPED", stoppedAt: now, reason };
}

/**
 * Crash recovery: detect an interrupted AutonomousRun and resume it.
 *
 * Two startup paths exist:
 *
 * ### Deliberate start
 * Server starts → no recoverable active run → show runtime/model selection → /brain → Start.
 *
 * ### Crash recovery
 * Server starts → unfinished AutonomousRun found → validate lease/heartbeat →
 *   reconcile interrupted jobs → load previous RuntimeProfile → resume automatically.
 *
 * This function implements the second path. It returns null when there is nothing to recover
 * (the deliberate-start path should be shown instead).
 */
export interface RecoveryResult {
  run: AutonomousRun;
  /** Jobs that were running when the crash occurred and need reconciliation. */
  interruptedJobs: Array<{ id: number; kind: string; attempts: number }>;
  /** Human-readable summary for Brain's "RECOVERED" banner. */
  summary: string;
}

export function recoverInterruptedRun(
  actor = "system:recovery",
  now = new Date(),
  startTicking: (runId: string) => void = ensureTicking,
): RecoveryResult | null {
  // Reconcile first — a stale RUNNING becomes CRASHED.
  reconcileStaleRuns(now);

  /**
   * If a run is still LIVE after reconciliation, there is nothing to recover.
   *
   * Without this the boot hook was a guaranteed crash on any database holding both a live run and
   * an older CRASHED one. `reconcileStaleRuns` only demotes runs whose heartbeat has gone stale,
   * so a freshly-heartbeating RUNNING row survives it; the CRASHED lookup below then found some
   * earlier corpse and promoted it to DEGRADED, producing TWO live rows. The
   * `autonomous_runs_one_live` unique index (drizzle/0017) correctly rejected that, the whole
   * function threw, and `instrumentation.ts` swallowed it as:
   *
   *     [runtime] boot recovery skipped: UNIQUE constraint failed: index 'autonomous_runs_one_live'
   *
   * Observed on the owner's development database, where it fires on every single boot — so the
   * recovery path that exists to resume interrupted work was never running at all there.
   *
   * Returning null is not merely a way to dodge the constraint; it is the correct answer. A live
   * run means the machine is already going, and resurrecting a second one would be the duplicate
   * work the single-live-run invariant exists to forbid.
   */
  const alreadyLive = liveRun(now);
  if (alreadyLive) return null;

  // Look for a CRASHED run that we can resume. A STOPPED run was intentionally halted — don't resume it.
  const crashed = getDb()
    .select()
    .from(schema.autonomousRuns)
    .where(eq(schema.autonomousRuns.status, "CRASHED"))
    .orderBy(desc(schema.autonomousRuns.startedAt))
    .get();

  if (!crashed) return null;

  // Find interrupted jobs — ones that were RUNNING when the crash happened.
  // Their leases have expired (STALE_MS passed), so they're safe to re-claim.
  const interrupted = getDb()
    .select({ id: schema.researchJobs.id, kind: schema.researchJobs.kind, attempts: schema.researchJobs.attempts })
    .from(schema.researchJobs)
    .where(
      inArray(schema.researchJobs.status, ["running", "waiting_dependency"]),
    )
    .all();

  // Resume the run: mark it DEGRADED (recovering), start ticking.
  getDb()
    .update(schema.autonomousRuns)
    .set({
      status: "DEGRADED",
      heartbeatAt: now,
      host: hostname(),
      pid: process.pid,
      nextAction: "Recovering from interrupted run.",
      reason: `Previous run ${crashed.id} crashed at ${crashed.heartbeatAt.toISOString()}. Resuming ${interrupted.length} interrupted job(s).`,
    })
    .where(eq(schema.autonomousRuns.id, crashed.id))
    .run();

  // Renew the lease for the resumed run.
  const held = currentLease(supervisorLeasePath(), 0, Number.MAX_SAFE_INTEGER);
  if (held?.holder === crashed.id) releaseLease(held.holder, held.acquiredAt, supervisorLeasePath());
  acquireLease(crashed.id, supervisorLeasePath(), now.getTime(), LEASE_TTL_MS);

  audit("autonomous_run_recover", crashed.id, `interrupted_jobs=${interrupted.length}`, actor, now);
  startTicking(crashed.id);

  return {
    run: toRun({ ...crashed, status: "DEGRADED", heartbeatAt: now }),
    interruptedJobs: interrupted.map((j) => ({ id: j.id, kind: j.kind, attempts: j.attempts })),
    summary: `Recovered run ${crashed.id.slice(0, 12)}… ${interrupted.length} interrupted job(s).`,
  };
}

function clearTicking(): void {
  const state = ticker();
  if (state.timer) clearInterval(state.timer);
  if (state.researchTimer) clearInterval(state.researchTimer);
  state.timer = null;
  state.researchTimer = null;
  state.runId = null;
}

function ensureTicking(runId: string): void {
  const state = ticker();
  if (state.timer && state.runId === runId) return;
  if (state.timer) clearInterval(state.timer);
  if (state.researchTimer) clearInterval(state.researchTimer);

  // The event-driven half of forecast validation: bar arrivals grade matured predictions the
  // moment they land, instead of waiting for the next cycle to poll. Idempotent, so every path
  // into ticking (start, recovery, ticker adoption after a module reload) may call it.
  registerForecastResolver();
  // Event-driven job wake: queued work starts on arrival, not at the next 5s poll.
  registerJobWake();

  state.runId = runId;
  state.timer = setInterval(() => {
    void tick(runId);
  }, TICK_MS);
  // Never hold the process open for a heartbeat. Ticking is not a reason to refuse to exit.
  state.timer.unref?.();

  // The RESEARCH lane runs on its own timer, under its own lease, concurrently with the cycle.
  state.researchTimer = setInterval(() => {
    void drainResearchLane(runId);
  }, RESEARCH_TICK_MS);
  state.researchTimer.unref?.();

  void tick(runId);
  void drainResearchLane(runId);
}

const JOB_WAKE = Symbol.for("marketpulse.supervisor.job-wake");

/**
 * Event-driven job wake — the poll becomes the safety net, not the engine.
 *
 * The research lane drained on a 5-second timer, so a job enqueued the instant after a pass
 * waited most of five seconds to start, and every dependency chain paid that latency at every
 * link. Now `JOB_CREATED` (new work) and `JOB_COMPLETED` (dependents just became claimable via
 * `unblockDependents`) trigger a drain immediately.
 *
 * The 5s timer deliberately REMAINS: events are in-process notifications, and a missed one — a
 * crash between commit and delivery, a subscriber registered after an emit, another process
 * writing the same database — must never strand work. Event for latency, poll for recovery;
 * neither is the only path a job can start by.
 *
 * Safe-by-construction notes:
 * - The subscriber's sync prologue is trivial; the drain suspends at its first await, so claims
 *   run AFTER the enqueue transaction that emitted the event has committed.
 * - `researchDraining` makes bursts cheap: events during a drain are skipped, and anything they
 *   announced is picked up by the drain's own claim loop or the reconciliation poll.
 * - The runId is read from the live ticker at fire time, never captured — a subscriber outliving
 *   a run cannot resurrect work for it.
 */
export function registerJobWake(
  drain: () => void = () => {
    const state = ticker();
    if (state.runId) void drainResearchLane(state.runId);
  },
): () => void {
  const store = globalThis as unknown as Record<symbol, (() => void) | undefined>;
  const existing = store[JOB_WAKE];
  if (existing) return existing;

  const unsubscribes = [subscribe("JOB_CREATED", drain), subscribe("JOB_COMPLETED", drain)];
  const dispose = () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    delete store[JOB_WAKE];
  };
  store[JOB_WAKE] = dispose;
  return dispose;
}

/**
 * One pass of the RESEARCH lane: drain whatever the durable queue is holding.
 *
 * This is what makes AUTO's lanes concurrent rather than merely labelled concurrent. It runs
 * independently of `tick()`, so a research job can start, run and finish while the learning cycle
 * is in the middle of rehearsal or the gauntlet — which is exactly the wall-clock overlap the
 * product requires and previously could not produce.
 *
 * Three separate guards keep "concurrent" from becoming "duplicated":
 *
 *   1. `researchDraining` — this lane never re-enters itself, so a slow drain suppresses the next
 *      timer fire instead of stacking on top of it. (The cycle's `ticking` flag does the same for
 *      its own lane, and the two flags are deliberately independent.)
 *   2. `researchLeasePath()` — a lease FILE distinct from the cycle's, so only one research
 *      drainer exists across every driver (ticker, browser tab, external scheduler), while still
 *      allowing the cycle to hold its own lease at the same time.
 *   3. `claimNextJob` — each job is claimed inside a transaction and stamped with `lockedUntil`,
 *      so even two drainers could not execute the same job twice.
 *
 * Failures are swallowed on purpose and to a limited extent: this lane must not be able to fail a
 * run. A job that throws is already recorded against that job by `runWorker` (attempts, error,
 * retry backoff), so there is nothing here that would otherwise be lost — and a research outage
 * must never stop the deterministic market and data work, per the DEGRADED-is-still-running rule.
 */
export async function drainResearchLane(runId: string): Promise<void> {
  const state = ticker();
  if (state.researchDraining) return;
  state.researchDraining = true;
  try {
    // Only drain for the run that owns this ticker; a stale timer must not resurrect work.
    if (state.runId !== null && state.runId !== runId) return;
    await withCycleLease(
      `research-${runId}`,
      async () => runWorker(`research-${runId}`, 10),
      researchLeasePath(),
    );
  } catch {
    // Recorded per-job by runWorker; the lane keeps running.
  } finally {
    state.researchDraining = false;
  }
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
    /**
     * Health comes from IMPAIRMENT, not from notes.
     *
     * This used to be `skipped.length > 0 ? "DEGRADED" : "RUNNING"`, and `skipped` carries every
     * kind of remark the cycle makes — "No strategy exists to consider", "Quant core is switched
     * off (QUANT_CORE_URL=off)", "N predictions awaiting bars". Those are eligibility and
     * waiting states: the machine is healthy and the work is not ready, which is most ticks of a
     * young install. The owner's server consequently showed DEGRADED on every tick it ever ran,
     * and a warning that is always on is a warning nobody reads.
     *
     * Two voices now decide, and either degrades:
     *   - `impaired` — reasons recorded from catch blocks, the mechanical v1 rule;
     *   - typed `reasons` whose own severity is DEGRADED/FAILED — the classification made at
     *     the observing site, which is what catches impairments that never throw (a quant core
     *     answering a structured "not reachable", a provider returning 200 with nothing in it).
     * Waiting and eligibility reasons (INFO/WARNING) never degrade. The notes are still
     * surfaced in `reason` either way, so nothing is hidden by being reclassified.
     */
    const impaired = Array.isArray(report?.impaired) ? report.impaired : [];
    const reasons = Array.isArray(report?.reasons) ? report.reasons : [];
    const degrading = [...new Set([...impaired, ...degradingMessages(reasons)])];

    db.update(schema.autonomousRuns)
      .set({
        status: degrading.length > 0 ? "DEGRADED" : "RUNNING",
        heartbeatAt: new Date(),
        lastCheckpoint: `queued=${stats.queued} running=${stats.running} succeeded=${stats.succeeded} failed=${stats.failed}`,
        reason: degrading.length > 0 ? degrading.join(" · ") : skipped.length > 0 ? skipped.join(" · ") : null,
        nextAction: "Waiting for the next cycle.",
      })
      .where(inArray(schema.autonomousRuns.status, [...LIVE_STATUSES]))
      .run();

    // Emit tick event
    emit({ kind: "AUTONOMOUS_TICK", runId, tick: row.ticks + 1, mode: mode.toLowerCase(), at: new Date().toISOString() });
    if (report) {
      emit({ kind: "LEARNING_CYCLE_COMPLETED", cycleId: runId, actions: report.actions?.length ?? 0, skipped: report.skipped?.length ?? 0, at: new Date().toISOString() });
    }
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
