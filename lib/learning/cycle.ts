import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";
import { quantCoreStatus } from "@/lib/quantcore/client";
import { queueStats } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { nextCurriculum, masteryByPlane } from "./curriculum";
import { proposalStats } from "./evolution";
import { inspectMemory, type IntrospectionReport } from "./introspection";
import { runValidationRehearsal, type CandleLoader, type RehearsalReport } from "./rehearsal";
import { marketCandleLoader } from "./dataset";
import { recordCycleRun } from "./run-log";
import { withCycleLease, type LeaseHolder } from "./lease";

export interface CycleReport {
  mode: string;
  ranAt: string;
  worker: { processed: number; succeeded: number; failed: number; dead: number } | null;
  queue: Record<string, number>;
  proposals: Record<string, number>;
  studyQueue: { conceptId: string; name: string; reason: string }[];
  mastery: { plane: string; studied: number; concepts: number; averageScore: number }[];
  // Null when the cycle did not run. Zero would be a measurement, and a refused cycle measured
  // nothing — reporting "0 open failures" or "quant core unreachable" from a call that never
  // looked is exactly the fabrication this system refuses everywhere else.
  openFailures: number | null;
  quantCore: { reachable: boolean; stale: boolean; mode: string | null } | null;
  /** What the system found wrong with its own memory. Null when the cycle did not run. */
  introspection: IntrospectionReport | null;
  /** What the gauntlet *would* say. Records nothing; null below `learning`. */
  rehearsal: RehearsalReport | null;
  actions: string[];
  skipped: string[];
  /**
   * Set when another driver already held the cycle lease, so this call did nothing.
   *
   * Null is the normal case and means "this call ran". A refused cycle is not a failure and not
   * an idle cycle — it is the lease working — but it must be distinguishable from both, or a
   * driver that never wins will look identical to a driver that runs and finds nothing to do.
   */
  blockedBy?: LeaseHolder | null;
}

/**
 * One learning-mode iteration. Each mode does strictly more than the one below it:
 *
 *   off        nothing runs
 *   observing  read-only: gather state, surface what is due, propose nothing
 *   learning   plus: drain the research queue and extract knowledge
 *   evolving   plus: raise code and strategy proposals for human review
 *
 * Nothing here can approve or merge anything — that requires the owner.
 */
export async function runLearningCycle(
  workerId = "learning-cycle",
  // Defaults to the real provider. A null-returning default would have made every rehearsal
  // report "no data" in production while passing every test that injected a loader.
  loadCandles: CandleLoader = marketCandleLoader(),
): Promise<CycleReport> {
  // The lease is taken here rather than in each driver. The browser path runs through
  // `app/api/learning/cycle/`, which is owner-reviewed and cannot be edited by an agent — so a
  // guard placed in the drivers would cover the scheduler and the daemon and silently miss the
  // one driver that is open all day. There is exactly one body, so there is exactly one lease.
  const outcome = await withCycleLease(workerId, async () => {
    // The body has four exits, one per mode tier. Recording inside it would mean four call sites
    // and, eventually, one of them forgotten — which is precisely how a loop ends up running with
    // no trace that it ran.
    const startedAt = Date.now();
    const report = await runCycleBody(workerId, loadCandles);
    try {
      recordCycleRun(report, Date.now() - startedAt, workerId);
    } catch {
      // A failure to write the log must not fail the cycle. The work already happened; losing the
      // record of it is worse than not doing the work only if it silently loses the work too.
    }
    return report;
  });

  if (outcome.result !== null) return outcome.result;

  // Refused. Deliberately *not* written to the run log: a no-op recorded as a cycle would inflate
  // "cycles today" with work that never happened, which is the exact dishonesty the run log was
  // built to end.
  const holder = outcome.blockedBy;
  return {
    ...emptyReport(getLearningMode()),
    blockedBy: holder,
    skipped: [
      holder
        ? `Another driver (${holder.holder}) has been running a cycle since ${new Date(holder.acquiredAt).toISOString()}. This call did nothing.`
        : "Another driver holds the cycle lease. This call did nothing.",
    ],
  };
}

/**
 * The shape of a cycle that did not run.
 *
 * Measurements are `null`, never `0`. Zero is a finding — "the quant core is unreachable", "there
 * are no open failures" — and this call looked at neither. Collections are empty because "none
 * listed" is true of a list nobody built, which is not the same kind of claim.
 *
 * `mode` is genuinely read: it is one indexed row and it is the one fact still worth reporting.
 */
function emptyReport(mode: string): CycleReport {
  return {
    mode,
    ranAt: new Date().toISOString(),
    worker: null,
    queue: {},
    proposals: {},
    studyQueue: [],
    mastery: [],
    openFailures: null,
    quantCore: null,
    introspection: null,
    rehearsal: null,
    actions: [],
    skipped: [],
    blockedBy: null,
  };
}

async function runCycleBody(workerId: string, loadCandles: CandleLoader): Promise<CycleReport> {
  const mode = getLearningMode();
  const actions: string[] = [];
  const skipped: string[] = [];

  const quantCore = await quantCoreStatus();
  const failures = getDb()
    .select()
    .from(schema.failureMemory)
    .orderBy(desc(schema.failureMemory.id))
    .all();

  const report: CycleReport = {
    mode,
    ranAt: new Date().toISOString(),
    worker: null,
    queue: queueStats(),
    proposals: proposalStats(),
    studyQueue: [],
    mastery: [],
    openFailures: failures.filter((failure) => !failure.lesson).length,
    quantCore: { reachable: quantCore.reachable, stale: quantCore.stale, mode: quantCore.mode },
    introspection: null,
    rehearsal: null,
    actions,
    skipped,
  };

  if (mode === "off") {
    skipped.push("Learning mode is off; no work was performed.");
    return report;
  }

  // observing and above: surface what needs attention.
  report.studyQueue = nextCurriculum(undefined, 5).map((item) => ({
    conceptId: item.conceptId,
    name: item.name,
    reason: item.reason,
  }));
  report.mastery = masteryByPlane().map((entry) => ({
    plane: entry.plane,
    studied: entry.studied,
    concepts: entry.concepts,
    averageScore: entry.averageScore,
  }));
  actions.push("Collected system state, study queue and mastery.");

  // Read-only, so it belongs at observing: the system checking whether its own memory is in
  // order needs no permission beyond looking. Orphaned knowledge and repeated failure modes
  // are invisible in every other view, because nothing links to them.
  report.introspection = inspectMemory();
  actions.push(report.introspection.summary);

  if (!quantCore.reachable) {
    skipped.push("Quant core unreachable; candidate review was skipped rather than guessed.");
  } else if (quantCore.stale) {
    skipped.push("Quant core data is stale; treat candidates as historical.");
  }

  if (mode === "observing") {
    skipped.push("Observing mode: the research queue was not drained and no proposals were raised.");
    return report;
  }

  // learning and above: do the deterministic work.
  const worker = await runWorker(workerId, 10);
  report.worker = worker;
  report.queue = queueStats();
  actions.push(`Processed ${worker.processed} research job(s).`);
  if (worker.dead > 0) {
    actions.push(`${worker.dead} job(s) exhausted retries and were written to failure memory.`);
  }

  // Replay and simulation are READ actions permitted at `learning`, and neither costs anything
  // to repeat. Running the gauntlet here instead would spend a trial and consume the holdout
  // budget on every cycle — irreversible, and on nobody's instruction.
  report.rehearsal = await runValidationRehearsal(loadCandles, mode);
  actions.push(report.rehearsal.summary);
  skipped.push(...report.rehearsal.skipped);

  if (mode === "learning") {
    skipped.push("Learning mode: no code or strategy proposals were raised. Switch to evolving to enable that.");
    return report;
  }

  // evolving: proposals are prepared, never applied.
  report.proposals = proposalStats();
  actions.push(
    "Evolving mode is active. Proposals may be raised and reviewed, but only the owner can approve or merge them.",
  );
  return report;
}
