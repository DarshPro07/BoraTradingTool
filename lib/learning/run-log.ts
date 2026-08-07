import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { CycleReport } from "./cycle";

/**
 * Durable record of every autonomous cycle.
 *
 * The complaint this exists to answer: the header said `LEARNING` and nothing observable ever
 * happened. The cycle *was* running — it just left no trace, so the only evidence it had run
 * was a badge that looked identical whether the system had done a hundred passes or none.
 *
 * Written to `audit_events` rather than a new table on purpose. That table already records every
 * governed decision with actor, action and timestamp, and an autonomous cycle is exactly such a
 * decision. Adding a parallel log would create a second history that could disagree with the first.
 */

export const CYCLE_ACTION = "learning_cycle";

export interface CycleRunRecord {
  id: number;
  ranAt: Date;
  mode: string;
  /**
   * Which driver ran it — `scheduler`, `daemon`, or the browser tab.
   *
   * A stopped daemon and a healthy scheduler write identical-looking run logs, and the difference
   * only becomes visible once a gap has already cost a day of cycles. Naming the driver makes
   * "autonomy stops when I close this tab" a fact on screen rather than one discovered later.
   */
  driver: string;
  durationMs: number;
  actions: string[];
  skipped: string[];
  /** Candidates rehearsed this pass, and how many would have survived the battery. */
  rehearsed: number;
  wouldPass: number;
  rediscovered: number;
  /** Memory findings needing attention. */
  findings: number;
  jobsProcessed: number;
}

interface StoredDetail {
  durationMs: number;
  actions: string[];
  skipped: string[];
  rehearsed: number;
  wouldPass: number;
  rediscovered: number;
  findings: number;
  jobsProcessed: number;
}

export function recordCycleRun(report: CycleReport, durationMs: number, actor = "learning-cycle"): void {
  const outcomes = report.rehearsal?.outcomes ?? [];
  const detail: StoredDetail = {
    durationMs: Math.max(0, Math.round(durationMs)),
    actions: report.actions,
    skipped: report.skipped,
    rehearsed: report.rehearsal?.evaluated ?? 0,
    wouldPass: outcomes.filter((outcome) => outcome.verdict === "would_pass").length,
    rediscovered: outcomes.filter((outcome) => outcome.verdict === "rediscovered").length,
    findings: report.introspection?.findings.filter((finding) => finding.severity === "attention").length ?? 0,
    jobsProcessed: report.worker?.processed ?? 0,
  };

  getDb()
    .insert(schema.auditEvents)
    .values({
      actor,
      action: CYCLE_ACTION,
      // A cycle that ran at `off` did nothing, and that is a refusal worth being able to count.
      decision: report.mode === "off" ? "skipped" : "allowed",
      subject: report.mode,
      detail: JSON.stringify(detail),
      learningMode: report.mode,
      createdAt: new Date(report.ranAt),
    })
    .run();
}

/** A malformed detail column is a data fault, not a reason to lose the whole feed. */
function parseDetail(raw: string | null): StoredDetail {
  const fallback: StoredDetail = {
    durationMs: 0,
    actions: [],
    skipped: [],
    rehearsed: 0,
    wouldPass: 0,
    rediscovered: 0,
    findings: 0,
    jobsProcessed: 0,
  };
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const record = parsed as Partial<StoredDetail>;
    return {
      durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
      actions: Array.isArray(record.actions) ? record.actions.map(String) : [],
      skipped: Array.isArray(record.skipped) ? record.skipped.map(String) : [],
      rehearsed: typeof record.rehearsed === "number" ? record.rehearsed : 0,
      wouldPass: typeof record.wouldPass === "number" ? record.wouldPass : 0,
      rediscovered: typeof record.rediscovered === "number" ? record.rediscovered : 0,
      findings: typeof record.findings === "number" ? record.findings : 0,
      jobsProcessed: typeof record.jobsProcessed === "number" ? record.jobsProcessed : 0,
    };
  } catch {
    return fallback;
  }
}

export function recentCycleRuns(limit = 25): CycleRunRecord[] {
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, CYCLE_ACTION))
    .orderBy(desc(schema.auditEvents.id))
    .limit(Math.max(0, Math.trunc(limit)))
    .all()
    .map((row) => {
      const detail = parseDetail(row.detail);
      return {
        id: row.id,
        ranAt: row.createdAt,
        mode: row.subject ?? row.learningMode ?? "unknown",
        driver: row.actor ?? "unknown",
        ...detail,
      };
    });
}

export function lastCycleRun(): CycleRunRecord | null {
  return recentCycleRuns(1)[0] ?? null;
}

export interface AutonomyPulse {
  /** Null when the loop has never run — which is different from having run and found nothing. */
  lastRunAt: Date | null;
  minutesSinceLastRun: number | null;
  lastMode: string | null;
  runsToday: number;
  actionsInLastRun: number;
  /** True when the loop has not run for longer than it should have. */
  stalled: boolean;
}

/** Beyond this the loop is not merely idle, it has stopped. */
export const STALL_AFTER_MINUTES = 30;

export function autonomyPulse(now = new Date()): AutonomyPulse {
  const last = lastCycleRun();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  // Filtered in SQL, then counted.
  //
  // This previously loaded every cycle event ever written and filtered the array in JavaScript.
  // The autonomy strip is in the chrome, so that scan ran on *every page load* and grew without
  // bound — a system running for a week would have paid for it on every navigation.
  //
  // Deliberately not drizzle's `count()` aggregate: it is version-dependent, and this module is
  // imported by the layout, so an import that does not resolve takes down every page rather than
  // one feature. `gte` narrows the rows in SQL, which is where the cost actually was.
  const runsToday = getDb()
    .select({ id: schema.auditEvents.id })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.action, CYCLE_ACTION), gte(schema.auditEvents.createdAt, midnight)))
    .all().length;

  if (!last) {
    return {
      lastRunAt: null,
      minutesSinceLastRun: null,
      lastMode: null,
      runsToday,
      actionsInLastRun: 0,
      // Never having run is not the same as having stalled, and reporting it as a stall would
      // send someone looking for a broken scheduler on a system that was simply never started.
      stalled: false,
    };
  }

  const minutes = Math.max(0, (now.getTime() - last.ranAt.getTime()) / 60_000);
  return {
    lastRunAt: last.ranAt,
    minutesSinceLastRun: minutes,
    lastMode: last.mode,
    runsToday,
    actionsInLastRun: last.actions.length,
    stalled: last.mode !== "off" && minutes > STALL_AFTER_MINUTES,
  };
}
