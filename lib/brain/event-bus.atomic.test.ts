import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { enqueue, completeJob, failJob, claimNextJob } from "@/lib/research/queue";
import { publish, subscribeAll, type MarketPulseEvent } from "@/lib/brain/event-bus";

/**
 * Event Bus — durability and mutation/event atomicity.
 *
 * ## An obsolete invariant, and why it was replaced
 *
 * This file previously declared two guarantees that cannot both hold:
 *
 *   2. Domain change + event are committed together when wrapped in a transaction.
 *   3. Event bus never breaks the publisher (errors are swallowed).
 *
 * OLD INVARIANT — "the event bus never breaks the publisher". It existed so that a fault in
 * observability could never take down the domain operation being observed. That instinct is right
 * for the *in-memory subscribers*: an analytics listener throwing must not fail a job.
 *
 * WHY IT IS OBSOLETE for the *persistence* half. `completeJob` (lib/research/queue.ts:183) wraps
 * `update(job) + emit(JOB_COMPLETED)` in a single `getDb().transaction(...)` specifically so the
 * two land together. With the failure swallowed inside `publish`, the insert could fail and the
 * transaction would still COMMIT — leaving a job marked `succeeded` with nothing in the ledger
 * saying so. The stated guarantee (2) was therefore never enforced; it was only ever true on the
 * happy path, which is exactly what the old tests measured.
 *
 * NEW REQUIREMENT — for a system whose premise is that evidence is durable, silently losing the
 * evidence is worse than surfacing the database fault. `publish` no longer catches the insert, so
 * a failed event write aborts the enclosing transaction and SQLite enforces "both or neither".
 * Subscriber isolation is unchanged.
 *
 * TEST CHANGE — the old test "event bus swallows errors and does not break the publisher" asserted
 * the obsolete behaviour and is replaced by two tests that assert the surviving half (subscriber
 * isolation) and the new half (rollback under failure injection). Critically, the old
 * "commits together" test never injected a failure: it completed a job on a healthy database and
 * observed that both rows appeared. That proves co-occurrence, not atomicity — the assertion
 * passed identically before and after the fix. The rollback test below is the one that actually
 * distinguishes them.
 */
describe("Event Bus — atomicity and persistence", () => {
  useTemporaryDatabase();

  function countEvents(action: string): number {
    return getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, action))
      .all().length;
  }

  /**
   * Failure injection: remove the ledger the event must be written to.
   *
   * Dropping the table is the bluntest honest way to make the insert fail for reasons outside the
   * caller's control — the same shape as a corrupt file, a failed migration, or a lock the write
   * cannot obtain. It does not touch `research_jobs`, so the domain row remains observable
   * afterwards, which is the whole point of the assertion.
   */
  function breakTheEventLedger(): void {
    getDb().run(sql`DROP TABLE audit_events`);
  }

  it("JOB_CREATED event is persisted to the database", () => {
    const before = countEvents("JOB_CREATED");
    const { id } = enqueue({ kind: "ingest_web", payload: { title: "t", content: "c" } });

    const events = getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "JOB_CREATED"))
      .all();
    expect(events.length).toBe(before + 1);
    expect(events[events.length - 1].subject).toBe(String(id));
  });

  it("completeJob commits domain change + JOB_COMPLETED event together", () => {
    const { id } = enqueue({ kind: "ingest_web", payload: { title: "t", content: "c" } });
    claimNextJob("worker-test");
    const before = countEvents("JOB_COMPLETED");
    completeJob(id, { ok: true });

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(job?.status).toBe("succeeded");

    const events = getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "JOB_COMPLETED"))
      .all();
    expect(events.length).toBe(before + 1);
  });

  it("rolls the domain mutation back when the event cannot be persisted", () => {
    const { id } = enqueue({ kind: "ingest_web", payload: { title: "t", content: "c" } });
    claimNextJob("worker-test");

    const claimed = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(claimed?.status, "precondition: the job must be running before completion").toBe("running");

    breakTheEventLedger();

    // The fault must surface. Before the fix this call succeeded silently.
    expect(() => completeJob(id, { ok: true })).toThrow();

    // The decisive assertion: the job must NOT be recorded as succeeded, because its event never
    // landed. A `succeeded` row here is a job whose completion has no evidence behind it.
    const after = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(after?.status, "domain mutation committed without its event — atomicity is broken").toBe(
      "running",
    );
  });

  it("failJob persists JOB_FAILED when attempts exhausted", () => {
    const { id } = enqueue({ kind: "ingest_web", payload: { title: "t", content: "c" }, maxAttempts: 1 });
    claimNextJob("worker-test");
    const before = countEvents("JOB_FAILED");
    failJob(id, "permanent failure");

    const events = getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "JOB_FAILED"))
      .all();
    expect(events.length).toBe(before + 1);
    const detail = JSON.parse(events[events.length - 1].detail!);
    expect(detail.error).toBe("permanent failure");
  });

  it("isolates subscriber failures — a throwing listener must not break the publisher", () => {
    // The surviving half of the old guarantee. Observability faults stay observability faults.
    const seen: string[] = [];
    const unsubBad = subscribeAll(() => {
      throw new Error("subscriber exploded");
    });
    const unsubGood = subscribeAll((e: MarketPulseEvent) => seen.push(e.kind));

    expect(() =>
      publish({ kind: "SYSTEM_STARTED", systemId: "test", at: new Date().toISOString() }),
    ).not.toThrow();

    // A later subscriber still runs even though an earlier one threw.
    expect(seen).toContain("SYSTEM_STARTED");
    unsubBad();
    unsubGood();
  });

  it("events survive a fresh database read (durability)", () => {
    const before = countEvents("SYSTEM_STARTED");
    publish({ kind: "SYSTEM_STARTED", systemId: "durability-test", at: new Date().toISOString() });

    const events = getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "SYSTEM_STARTED"))
      .all();
    expect(events.length).toBe(before + 1);
    const detail = JSON.parse(events[events.length - 1].detail!);
    expect(detail.systemId).toBe("durability-test");
  });
});
