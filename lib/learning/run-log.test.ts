import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  autonomyPulse,
  excludedFixtureCount,
  recentCycleRuns,
  recordCycleRun,
  STALL_AFTER_MINUTES,
} from "./run-log";
import type { CycleReport } from "./cycle";

/**
 * The behaviour under test is the one the owner asked for by name: the header said LEARNING and
 * nothing observable happened. The loop was running and leaving no trace, so a hundred passes
 * and zero passes rendered identically.
 *
 * ## Why the temp database matters here specifically
 *
 * This file had no isolation, so `recordCycleRun` wrote to the **default** `marketpulse.db` — the
 * owner's real one. Every `npm run test` injected fixture cycles with actions literally named
 * "older" and "newer" into the production run log, and they surfaced in the live terminal
 * alongside genuine runs, all stamped with the fixture's frozen timestamp.
 *
 * That is worse than a noisy screen. The run log is the evidence that autonomy is working, and a
 * log that silently mixes test writes with real ones cannot serve as evidence of anything.
 */

useTemporaryDatabase();

function report(overrides: Partial<CycleReport> = {}): CycleReport {
  return {
    mode: "learning",
    ranAt: new Date("2026-08-06T15:00:00.000Z").toISOString(),
    worker: { processed: 2, succeeded: 2, failed: 0, dead: 0 },
    queue: {},
    proposals: {},
    studyQueue: [],
    mastery: [],
    openFailures: 0,
    quantCore: { reachable: false, stale: false, mode: null },
    introspection: null,
    rehearsal: null,
    actions: ["Collected system state.", "Rehearsed 2 candidates."],
    skipped: ["Quant core unreachable."],
    ...overrides,
  } as CycleReport;
}

describe("a cycle leaves a trace", () => {
  it("records what it did, not merely that it ran", () => {
    recordCycleRun(report(), 1234, "scheduler");
    const [run] = recentCycleRuns(1);
    expect(run.actions).toContain("Rehearsed 2 candidates.");
    expect(run.skipped).toContain("Quant core unreachable.");
    expect(run.durationMs).toBe(1234);
    expect(run.jobsProcessed).toBe(2);
  });

  it("counts rehearsal outcomes by kind so a busy pass differs from an idle one", () => {
    recordCycleRun(
      report({
        rehearsal: {
          recordedNothing: true,
          ranAt: new Date().toISOString(),
          evaluated: 3,
          skipped: [],
          summary: "x",
          outcomes: [
            { specId: "a", name: "a", status: "draft", verdict: "would_pass", reason: "", trades: 40, instrumentsEvaluated: 12, signalsRejectedForCapacity: 0, battery: null, datasetSnapshotId: "dss_x", datasetFingerprint: "fp_x" },
            { specId: "b", name: "b", status: "draft", verdict: "rediscovered", reason: "", trades: 0, instrumentsEvaluated: 0, signalsRejectedForCapacity: 0, battery: null, datasetSnapshotId: null, datasetFingerprint: null },
            { specId: "c", name: "c", status: "draft", verdict: "would_fail", reason: "", trades: 31, instrumentsEvaluated: 12, signalsRejectedForCapacity: 2, battery: null, datasetSnapshotId: "dss_x", datasetFingerprint: "fp_x" },
          ],
        },
      } as Partial<CycleReport>),
      500,
      "scheduler",
    );
    const [run] = recentCycleRuns(1);
    expect(run.rehearsed).toBe(3);
    expect(run.wouldPass).toBe(1);
    expect(run.rediscovered).toBe(1);
  });

  it("records a cycle that did nothing, so an off loop is visibly off", () => {
    // Not recording an `off` cycle would make "autonomy is disabled" and "the scheduler is
    // broken" produce the identical empty feed.
    recordCycleRun(report({ mode: "off", actions: [], skipped: ["Learning mode is off."] }), 5, "scheduler");
    const [run] = recentCycleRuns(1);
    expect(run.mode).toBe("off");
    expect(run.skipped[0]).toMatch(/off/);
  });

  it("returns runs newest first", () => {
    recordCycleRun(report({ actions: ["older"] }), 1, "scheduler");
    recordCycleRun(report({ actions: ["newer"] }), 1, "scheduler");
    const runs = recentCycleRuns(2);
    expect(runs[0].actions).toContain("newer");
  });

  it("honours the limit and never returns a negative slice", () => {
    expect(recentCycleRuns(0)).toHaveLength(0);
    expect(recentCycleRuns(-5)).toHaveLength(0);
  });
});

describe("rows written by a test process", () => {
  it("are excluded from the feed but counted, never silently dropped", () => {
    // This is not hypothetical. Before `lib/db/index.ts` refused the production database from a
    // test process, this very file wrote fixture cycles named "older" and "newer" into the owner's
    // `marketpulse.db`, where they appeared in the live terminal beside real runs. `audit_events`
    // is append-only by trigger, so they are still there and always will be — exclusion at read
    // time is the only remedy that exists, and it has to admit to itself.
    recordCycleRun(report({ actions: ["real"] }), 1, "scheduler");
    recordCycleRun(report({ actions: ["fixture"] }), 1, "test-writer");

    const runs = recentCycleRuns(10);
    expect(runs).toHaveLength(1);
    expect(runs[0].actions).toContain("real");
    expect(excludedFixtureCount()).toBe(1);
  });

  it("do not inflate the cycles-today count the header reads", () => {
    recordCycleRun(report({ ranAt: new Date().toISOString() }), 1, "test-writer");
    expect(autonomyPulse().runsToday).toBe(0);
  });
});

describe("the pulse the header reads", () => {
  it("distinguishes never-run from stalled", () => {
    // Both show an empty feed, and conflating them sends someone hunting a broken scheduler on
    // a system that was simply never switched on.
    const pulse = autonomyPulse();
    if (pulse.lastRunAt === null) {
      expect(pulse.stalled).toBe(false);
      expect(pulse.minutesSinceLastRun).toBeNull();
    } else {
      expect(pulse.minutesSinceLastRun).toBeGreaterThanOrEqual(0);
    }
  });

  it("calls a loop stalled once it is older than the threshold", () => {
    const long = new Date("2026-08-06T15:00:00.000Z");
    recordCycleRun(report({ ranAt: long.toISOString() }), 10, "scheduler");
    const after = new Date(long.getTime() + (STALL_AFTER_MINUTES + 5) * 60_000);
    expect(autonomyPulse(after).stalled).toBe(true);
  });

  it("does not call a recent loop stalled", () => {
    const at = new Date("2026-08-06T15:00:00.000Z");
    recordCycleRun(report({ ranAt: at.toISOString() }), 10, "scheduler");
    expect(autonomyPulse(new Date(at.getTime() + 60_000)).stalled).toBe(false);
  });

  it("never calls an off loop stalled", () => {
    // Autonomy that is switched off is not failing to run; it is correctly not running.
    const at = new Date("2026-08-06T15:00:00.000Z");
    recordCycleRun(report({ mode: "off", ranAt: at.toISOString() }), 10, "scheduler");
    const after = new Date(at.getTime() + (STALL_AFTER_MINUTES + 60) * 60_000);
    expect(autonomyPulse(after).stalled).toBe(false);
  });

  it("never reports negative idle time when clocks disagree", () => {
    const at = new Date("2026-08-06T15:00:00.000Z");
    recordCycleRun(report({ ranAt: at.toISOString() }), 10, "scheduler");
    const before = new Date(at.getTime() - 60_000);
    expect(autonomyPulse(before).minutesSinceLastRun).toBeGreaterThanOrEqual(0);
  });
});
