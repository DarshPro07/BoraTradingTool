import { describe, expect, it, vi } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import type { CycleReport } from "@/lib/learning/cycle";

/**
 * A7 — DEGRADED means impaired, never merely waiting.
 *
 * ## The defect
 *
 * `tick()` derived run health from `skipped.length > 0`, and `skipped` is the cycle's notebook:
 * eligibility states ("Guarded gauntlet: No strategy exists to consider"), deliberate
 * configuration ("Quant core is switched off (QUANT_CORE_URL=off)"), and waiting states
 * ("15 prediction(s) awaiting bars") all land there, beside genuine failures. A young install
 * ALWAYS has such notes, so the owner's machine showed DEGRADED on every tick it ever ran — and
 * an alarm that is always on is an alarm nobody reads.
 *
 * The fix: `CycleReport.impaired` carries only reasons recorded from catch blocks (a mechanical
 * membership rule, immune to message rewording), and health derives from that.
 *
 * The cycle is mocked because this is a test of the SUPERVISOR'S DECISION, not of the cycle —
 * and the report shapes below are real ones observed on the owner's server.
 */

const cycleMock = vi.hoisted(() => ({
  report: null as unknown as CycleReport,
}));

vi.mock("@/lib/learning/cycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/learning/cycle")>();
  return {
    ...original,
    runLearningCycle: vi.fn(async () => cycleMock.report),
  };
});

import { startAutonomousRun, tick, liveRun } from "./supervisor";

useTemporaryDatabase();

const noTick = () => {};

function report(overrides: Partial<CycleReport>): CycleReport {
  return {
    mode: "learning",
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
    board: null,
    autoGauntlet: null,
    metrics: null,
    actions: [],
    skipped: [],
    impaired: [],
    reasons: [],
    blockedBy: null,
    ...overrides,
  };
}

describe("run health derives from impairment, not from notes", () => {
  it("stays RUNNING when the only notes are eligibility and waiting states", async () => {
    // The owner's actual tick, verbatim: every one of these is a healthy machine reporting that
    // work is not ready. Under the old rule this exact report produced DEGRADED forever.
    cycleMock.report = report({
      skipped: [
        "Guarded gauntlet: No strategy exists to consider.",
        "Quant core is switched off (QUANT_CORE_URL=off). Candidate review is not part of this install.",
        "No active forward challenger. Activate one from a gauntlet-evaluated strategy to start accumulating prospective evidence",
        "Forecast validation: 15 prediction(s) awaiting bars. 0 resolved; needs 30.",
      ],
      impaired: [],
    });

    const started = startAutonomousRun("claude-code", "test", new Date(), noTick);
    await tick(started.run.id);

    const run = liveRun();
    expect(run?.status, "eligibility notes must not degrade a healthy run").toBe("RUNNING");
    // The notes are still surfaced — reclassification must not hide them.
    expect(run?.reason).toContain("No strategy exists to consider");
  });

  it("goes DEGRADED when a step actually failed", async () => {
    cycleMock.report = report({
      skipped: ["Rehearsal verdicts could not be recorded: SQLITE_BUSY: database is locked"],
      impaired: ["Rehearsal verdicts could not be recorded: SQLITE_BUSY: database is locked"],
    });

    const started = startAutonomousRun("claude-code", "test", new Date(), noTick);
    await tick(started.run.id);

    const run = liveRun();
    expect(run?.status, "a real failure must still degrade the run").toBe("DEGRADED");
    expect(run?.reason).toContain("could not be recorded");
  });

  it("a clean cycle reports RUNNING with no reason", async () => {
    cycleMock.report = report({});

    const started = startAutonomousRun("claude-code", "test", new Date(), noTick);
    await tick(started.run.id);

    const run = liveRun();
    expect(run?.status).toBe("RUNNING");
    expect(run?.reason).toBeNull();
  });

  it("goes DEGRADED on a structured impairment that never threw — the class the catch-rule is blind to", async () => {
    // A CONFIGURED quant core answering "not reachable" is an infrastructure fact delivered as a
    // normal return value. v1's catch-only rule kept the run RUNNING through it; the typed
    // reason carries its own severity, so the supervisor no longer has to infer health from HOW
    // a message was recorded.
    cycleMock.report = report({
      skipped: ["Quant core did not answer, so candidate review was skipped rather than guessed."],
      impaired: [],
      reasons: [
        {
          code: "QUANT_CORE_UNREACHABLE",
          category: "INFRASTRUCTURE",
          severity: "DEGRADED",
          message: "Quant core did not answer, so candidate review was skipped rather than guessed.",
        },
      ],
    });

    const started = startAutonomousRun("claude-code", "test", new Date(), noTick);
    await tick(started.run.id);

    const run = liveRun();
    expect(run?.status, "a non-throwing infrastructure failure must degrade the run").toBe("DEGRADED");
    expect(run?.reason).toContain("Quant core did not answer");
  });

  it("typed waiting reasons — warm-up, awaiting bars, missing-history WARNING — keep the run RUNNING", async () => {
    cycleMock.report = report({
      skipped: [
        "3 strategy×instrument pair(s) inside their warm-up window.",
        "Forecast validation: 15 prediction(s) awaiting bars. 0 resolved; needs 30.",
        "2 candidate(s) could not be rehearsed because the canonical store holds no bars for their universe.",
      ],
      impaired: [],
      reasons: [
        {
          code: "STRATEGY_WARMUP",
          category: "ELIGIBILITY",
          severity: "INFO",
          message: "3 strategy×instrument pair(s) inside their warm-up window.",
          resumeAt: "2026-08-14 09:00 Asia/Kolkata",
        },
        {
          code: "FORECAST_AWAITING_BARS",
          category: "ELIGIBILITY",
          severity: "INFO",
          message: "Forecast validation: 15 prediction(s) awaiting bars. 0 resolved; needs 30.",
        },
        {
          code: "DATA_HISTORY_MISSING",
          category: "DEPENDENCY",
          severity: "WARNING",
          dependency: "ingest_history",
          message: "2 candidate(s) could not be rehearsed because the canonical store holds no bars for their universe.",
        },
      ],
    });

    const started = startAutonomousRun("claude-code", "test", new Date(), noTick);
    await tick(started.run.id);

    const run = liveRun();
    expect(run?.status, "waiting states — even DEPENDENCY warnings — are not impairment").toBe("RUNNING");
  });
});
