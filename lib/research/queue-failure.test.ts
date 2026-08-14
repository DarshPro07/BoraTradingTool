import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  claimNextJob,
  enqueue,
  failJob,
  failureClass,
  REVIVAL_COOLDOWN_MS,
} from "./queue";

/**
 * Failure classes and the revival policy — "failure without infinite looping".
 *
 * ## The two defects this closes, one in each direction
 *
 * 1. `enqueue`'s dedupe returned ANY existing row with the key, including a dead one. Once an
 *    `ingest_history` job exhausted its retries during a transient provider outage, its dedupe
 *    key blocked every future remediation attempt FOREVER — the cycle re-entered the gap branch,
 *    was deduped against a corpse, and reported "already queued or running" about a job that
 *    would never run again. Permanent blockage from a ten-minute outage.
 *
 * 2. A failure that can NEVER succeed (an instrument the exchange never listed) was retried
 *    through the full attempt budget anyway — bounded waste, but waste, and it mislabels a
 *    truthful refusal as a flaky operation.
 *
 * The policy, from the owner's dependency-resolver feedback:
 *   retryable provider outage  → RETRY_AFTER (cooldown, then revival with a fresh budget)
 *   permanent unsupported case → BLOCKED_PERMANENT (dead immediately, never revived)
 */

describe("failureClass", () => {
  it("classifies by the CODE prefix the worker already throws", () => {
    expect(failureClass("INSTRUMENT_UNKNOWN: not in the NSE master")).toBe("PERMANENT");
    expect(failureClass("SOURCE_UNAVAILABLE: connect ETIMEDOUT")).toBe("RETRYABLE");
    expect(failureClass("INSUFFICIENT_SOURCE_BARS: only 12 bars")).toBe("RETRYABLE");
  });

  it("defaults unrecognized and absent errors to RETRYABLE — bounded retries of a doomed job cost less than permanently blocking a recoverable one", () => {
    expect(failureClass(null)).toBe("RETRYABLE");
    expect(failureClass("something nobody classified")).toBe("RETRYABLE");
  });
});

describe("permanent failures die immediately", () => {
  useTemporaryDatabase();

  it("a PERMANENT failure is dead on attempt 1 even with retries remaining", () => {
    const { id } = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:NOT-A-REAL-ZZZ" },
      maxAttempts: 3,
    });
    const job = claimNextJob("w1");
    expect(job?.id).toBe(id);

    const outcome = failJob(id, "INSTRUMENT_UNKNOWN: IN:XNSE:NOT-A-REAL-ZZZ is not in the NSE security master");
    expect(outcome.retrying, "retrying an instrument the exchange never listed is not a retry, it is a loop").toBe(false);

    const row = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(row?.status).toBe("dead");
    expect(row?.attempts).toBe(1);
  });

  it("a RETRYABLE failure still walks the attempt budget", () => {
    const { id } = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:RELIANCE" },
      maxAttempts: 3,
    });
    claimNextJob("w1");

    const outcome = failJob(id, "SOURCE_UNAVAILABLE: connect ETIMEDOUT");
    expect(outcome.retrying).toBe(true);

    const row = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(row?.status).toBe("queued");
  });
});

describe("revival — RETRY_AFTER for the retryable, BLOCKED_PERMANENT for the rest", () => {
  useTemporaryDatabase();

  /** Kill a job with one attempt and the given error, and return its id. */
  function deadJob(dedupeKey: string, error: string): number {
    const { id } = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: dedupeKey.replace("ingest-history-", "") },
      dedupeKey,
      maxAttempts: 1,
    });
    claimNextJob("w1");
    failJob(id, error);
    const row = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(row?.status, "precondition: the job must be dead").toBe("dead");
    return id;
  }

  function backdateDeath(id: number, byMs: number): void {
    getDb()
      .update(schema.researchJobs)
      .set({ updatedAt: new Date(Date.now() - byMs) })
      .where(eq(schema.researchJobs.id, id))
      .run();
  }

  it("a dead RETRYABLE job stays deduped while the cooldown runs — no doomed re-enqueue every tick", () => {
    const id = deadJob("ingest-history-IN:XNSE:TCS", "SOURCE_UNAVAILABLE: provider outage");

    const again = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:TCS" },
      dedupeKey: "ingest-history-IN:XNSE:TCS",
    });
    expect(again.deduped).toBe(true);
    expect(again.id).toBe(id);

    const row = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(row?.status, "still cooling down — reviving instantly would be the old infinite retry in disguise").toBe("dead");
  });

  it("a dead RETRYABLE job revives with a fresh budget once the cooldown has passed", () => {
    const id = deadJob("ingest-history-IN:XNSE:SBIN", "SOURCE_UNAVAILABLE: provider outage");
    backdateDeath(id, REVIVAL_COOLDOWN_MS + 1_000);

    const again = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:SBIN" },
      dedupeKey: "ingest-history-IN:XNSE:SBIN",
    });
    expect(again.deduped, "a cooled-down transient failure is new remediation, not a duplicate").toBe(false);
    expect(again.revived).toBe(true);
    expect(again.id, "revival reuses the durable row — history stays attached to one job").toBe(id);

    const row = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(0);
    // The failure that killed it remains visible — revival is not amnesia.
    expect(row?.lastError).toContain("SOURCE_UNAVAILABLE");
  });

  it("a dead PERMANENT job is never revived, however long it has been dead", () => {
    const id = deadJob("ingest-history-IN:XNSE:GHOST", "INSTRUMENT_UNKNOWN: never listed");
    backdateDeath(id, REVIVAL_COOLDOWN_MS * 100);

    const again = enqueue({
      kind: "ingest_history",
      payload: { instrumentId: "IN:XNSE:GHOST" },
      dedupeKey: "ingest-history-IN:XNSE:GHOST",
    });
    expect(again.deduped).toBe(true);
    expect(again.revived ?? false).toBe(false);

    const row = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(row?.status, "an instrument the exchange never listed does not become listable by waiting").toBe("dead");
  });
});
