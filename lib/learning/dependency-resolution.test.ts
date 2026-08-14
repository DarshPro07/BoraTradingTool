import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { enqueue, JOB_KINDS, queueStats } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { instrumentReadiness } from "@/lib/market/ingest";
import { MIN_BARS_FOR_RESEARCH } from "@/lib/research/bridge";

/**
 * Dependency Resolver v1 — a missing prerequisite becomes work, and the work resolves it.
 *
 * ## The loop this breaks
 *
 * The owner's machine printed, on every cycle, forever:
 *
 *   "N candidate(s) could not be rehearsed because the canonical store holds no bars for their
 *    universe. … the gap is an ingestion task"
 *
 * The sentence named the task and nothing owned it: the durable queue only knew research-intake
 * kinds, so "an ingestion task" was a task the system could describe but never perform. That is
 *
 *   missing bars → DEGRADED → nothing happens → same warning next cycle
 *
 * — the exact anti-pattern the mission calls the difference between a dashboard and an
 * autonomous operating system.
 *
 * These tests run in TEST_MODE so the provider chain serves deterministic fixture candles; what
 * is under test is the RESOLUTION MACHINERY (job kind → worker → store → readiness), not the
 * upstream feed.
 */

let previousTestMode: string | undefined;

beforeAll(() => {
  previousTestMode = process.env.MARKETPULSE_TEST_MODE;
  process.env.MARKETPULSE_TEST_MODE = "1";
});

afterAll(() => {
  if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
  else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
});

describe("ingest_history — the first remediation job kind", () => {
  useTemporaryDatabase();

  it("is a durable job kind, not an aspiration", () => {
    expect(JOB_KINDS).toContain("ingest_history");
  });

  it("turns an un-researchable instrument into a researchable one through the queue", async () => {
    const instrumentId = "IN:XNSE:RELIANCE";
    expect(instrumentReadiness(instrumentId).ready, "precondition: fresh store").toBe(false);

    const { id } = enqueue({
      kind: "ingest_history",
      payload: { instrumentId },
      dedupeKey: `ingest-history-${instrumentId}`,
    });

    const result = await runWorker("resolver-test", 5);
    expect(result.succeeded, "the ingestion job must succeed").toBeGreaterThanOrEqual(1);

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(job?.status).toBe("succeeded");

    // The point of the whole exercise: the prerequisite the warning named is now satisfied.
    const readiness = instrumentReadiness(instrumentId);
    expect(readiness.ready).toBe(true);
    expect(readiness.stored).toBeGreaterThanOrEqual(MIN_BARS_FOR_RESEARCH);
  });

  it("dedupes — the warning recurring cannot stack duplicate remediation", () => {
    const first = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:TCS" },
      dedupeKey: "ingest-history-IN:XNSE:TCS",
    });
    const second = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:TCS" },
      dedupeKey: "ingest-history-IN:XNSE:TCS",
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(queueStats().queued).toBe(1);
  });

  it("a refusal FAILS the job into retry — silent no-op success would recreate the loop", async () => {
    const { id } = enqueue({
      kind: "ingest_history",
      // Well-formed, but absent from the NSE master: ingestion refuses INSTRUMENT_UNKNOWN.
      payload: { instrumentId: "IN:XNSE:NOT-A-REAL-ZZZ" },
      maxAttempts: 1,
    });

    const result = await runWorker("resolver-test", 5);
    expect(result.succeeded).toBe(0);

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    // maxAttempts 1 ⇒ the failure is terminal and VISIBLE on /jobs, not retried forever.
    expect(job?.status).toBe("dead");
    expect(job?.lastError ?? "").toContain("INSTRUMENT_UNKNOWN");
  });

  it("is idempotent — running the job twice cannot double-write history", async () => {
    // RELIANCE, deliberately: each test gets its own temporary database, and RELIANCE is the
    // instrument the unit-test security master actually resolves. INFY refused with
    // INSTRUMENT_UNKNOWN here — which the guard is right to do, and which this test is not about.
    const instrumentId = "IN:XNSE:RELIANCE";
    enqueue({ kind: "ingest_history", payload: { instrumentId } });
    const first = await runWorker("resolver-test", 5);
    expect(first.succeeded, "precondition: the first ingest must succeed").toBeGreaterThanOrEqual(1);
    const after = instrumentReadiness(instrumentId).stored;
    expect(after).toBeGreaterThanOrEqual(MIN_BARS_FOR_RESEARCH);

    // Second job, same instrument, no dedupe key — the worst case.
    enqueue({ kind: "ingest_history", payload: { instrumentId } });
    const second = await runWorker("resolver-test", 5);
    expect(second.succeeded).toBeGreaterThanOrEqual(1); // ALREADY_READY is ok:true
    expect(instrumentReadiness(instrumentId).stored, "a repeat run must not duplicate bars").toBe(after);
  });
});
