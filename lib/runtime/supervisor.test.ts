import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { acquireLease, currentLease, leasePath } from "@/lib/learning/lease";
import { getDb, schema } from "@/lib/db";
import {
  liveRun,
  lastRun,
  reconcileStaleRuns,
  startAutonomousRun,
  stopAutonomousRun,
  STALE_MS,
  LEASE_TTL_MS,
  supervisorLeasePath,
} from "./supervisor";

useTemporaryDatabase();

/** Ticking is injected away: these tests are about run bookkeeping, not about running a cycle. */
const noTick = () => {};

describe("Start is idempotent", () => {
  /**
   * THE property the owner named first. Two presses a few milliseconds apart both read "nothing
   * live" and both insert — and the second supervisor then re-runs every scanner, ingestion and
   * research job. The partial unique index in 0016 makes the second insert FAIL rather than making
   * the race merely unlikely to be lost.
   */
  it("a second press returns the same run instead of starting a second machine", () => {
    const first = startAutonomousRun("claude-code", "test", new Date(), noTick);
    const second = startAutonomousRun("claude-code", "test", new Date(), noTick);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    const rows = getDb().select().from(schema.autonomousRuns).all();
    expect(rows, "a second press must not create a second row").toHaveLength(1);
  });

  it("the database refuses a second live run even if the read said there was none", () => {
    startAutonomousRun("claude-code", "test", new Date(), noTick);

    // Simulate losing the check-then-act race: insert directly, as a second request would.
    const insertSecond = () =>
      getDb()
        .insert(schema.autonomousRuns)
        .values({
          id: "arun_racer",
          status: "RUNNING",
          runtimeProfile: "claude-code",
          governanceCeiling: "observing",
          marketMode: "OFF_HOURS",
          nextAction: null,
          lastCheckpoint: null,
          reason: null,
          ticks: 0,
          host: "test",
          pid: 1,
          startedAt: new Date(),
          heartbeatAt: new Date(),
          stoppedAt: null,
        })
        .run();

    expect(insertSecond, "the storage layer is what makes Start idempotent").toThrow();
  });
});

describe("recovery", () => {
  it("a run whose process died is reconciled to CRASHED, not left reporting RUNNING", () => {
    const started = startAutonomousRun("claude-code", "test", new Date(), noTick);

    // Age the heartbeat past the stale threshold — the process ended without stopping.
    getDb()
      .update(schema.autonomousRuns)
      .set({ heartbeatAt: new Date(Date.now() - STALE_MS - 1_000) })
      .run();

    expect(reconcileStaleRuns()).toBe(1);

    const after = lastRun();
    expect(after?.id).toBe(started.run.id);
    expect(after?.status).toBe("CRASHED");
    expect(after?.reason).toMatch(/no heartbeat/i);
    // A phantom RUNNING is worse than no run: it claims work is happening when none is.
    expect(liveRun()).toBeNull();
  });

  it("after reconciliation the machine can be started again", () => {
    startAutonomousRun("claude-code", "test", new Date(), noTick);
    getDb()
      .update(schema.autonomousRuns)
      .set({ heartbeatAt: new Date(Date.now() - STALE_MS - 1_000) })
      .run();

    const restarted = startAutonomousRun("claude-code", "test", new Date(), noTick);
    expect(restarted.created).toBe(true);
    expect(getDb().select().from(schema.autonomousRuns).all()).toHaveLength(2);
  });

  it("a healthy run is never reconciled", () => {
    startAutonomousRun("claude-code", "test", new Date(), noTick);
    expect(reconcileStaleRuns()).toBe(0);
    expect(liveRun()).not.toBeNull();
  });
});

describe("stop", () => {
  it("stops the live run and records why", () => {
    startAutonomousRun("claude-code", "test", new Date(), noTick);

    const stopped = stopAutonomousRun("Stopped for a deploy.", "test");

    expect(stopped?.status).toBe("STOPPED");
    expect(stopped?.reason).toBe("Stopped for a deploy.");
    expect(liveRun()).toBeNull();
  });

  it("stopping when nothing runs returns null rather than inventing a run", () => {
    expect(stopAutonomousRun("nothing to stop", "test")).toBeNull();
  });
});

describe("the governance ceiling is recorded, never raised", () => {
  /**
   * The supervisor copies the learning mode at start as a RECORD of what was permitted. It must
   * never be a control: a machine that can lift its own ceiling has no ceiling, and raising it
   * stays owner-only in `/api/learning`.
   */
  it("stores the mode in force at start", () => {
    const { run } = startAutonomousRun("claude-code", "test", new Date(), noTick);

    expect(run.governanceCeiling).toBeTruthy();
    expect(["off", "observing", "learning", "evolving"]).toContain(run.governanceCeiling);
  });

  it("writes an audit row for the start, so who started it stays answerable", () => {
    const { run } = startAutonomousRun("claude-code", "test", new Date(), noTick);

    const events = getDb().select().from(schema.auditEvents).all();
    const start = events.find((event) => event.action === "autonomous_run_start");
    expect(start?.subject).toBe(run.id);
    expect(start?.detail).toContain("ceiling=");
  });
});

describe("singleton ownership across processes", () => {
  /**
   * The unique index stops two requests inside ONE server. It cannot see a second Node process
   * pointed at the same database — that is what the lease is for, and the two answer different
   * questions.
   */
  it("refuses to start when another process already holds the runtime lease", () => {
    acquireLease("some-other-process", supervisorLeasePath(), Date.now(), LEASE_TTL_MS);

    expect(() => startAutonomousRun("claude-code", "test", new Date(), noTick)).toThrow(
      /SUPERVISOR_ALREADY_OWNED/,
    );
    expect(getDb().select().from(schema.autonomousRuns).all()).toHaveLength(0);
  });

  it("releases the lease on stop, so the next start is not locked out", () => {
    startAutonomousRun("claude-code", "test", new Date(), noTick);
    expect(currentLease(supervisorLeasePath())).not.toBeNull();

    stopAutonomousRun("done", "test");

    expect(currentLease(supervisorLeasePath())).toBeNull();
    expect(() => startAutonomousRun("claude-code", "test", new Date(), noTick)).not.toThrow();
  });

  /**
   * The supervisor must NOT hold the cycle lease. `runLearningCycle` takes that one itself, so a
   * supervisor holding it would block the very cycle it exists to run — a deadlock in which the
   * machine reports RUNNING forever and does nothing.
   */
  it("does not take the cycle lease", () => {
    startAutonomousRun("claude-code", "test", new Date(), noTick);

    expect(supervisorLeasePath()).not.toBe(leasePath());
    expect(currentLease(leasePath()), "the cycle lease must remain free").toBeNull();
  });
});
