import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { claimNextJob, completeJob, enqueue, failJob, getJob } from "./queue";

/**
 * Found LIVE on /jobs (2026-08-14): job #102 `ingest_history` read `succeeded` while its lastError
 * still said "SOURCE_UNAVAILABLE … the store is unchanged and the instrument remains
 * un-researchable" — a stale error from a failed earlier attempt, displayed beside a success. One
 * of the two statements is necessarily false at read time, which violates the ledger-truth rule:
 * a row must never assert a contradiction. `lastError` means "the error of the CURRENT terminal
 * state"; for a succeeded job that is none. (The per-attempt history survives in job_events.)
 */
describe("completeJob clears a stale lastError from an earlier failed attempt", () => {
  useTemporaryDatabase();

  it("fail once (retryable) → succeed on retry → the row reads succeeded with NO leftover error", () => {
    const { id } = enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:ICICIBANK" } });

    const first = claimNextJob("w1");
    expect(first?.id).toBe(id);
    const outcome = failJob(id, "SOURCE_UNAVAILABLE: provider timeout. The store is unchanged.", new Date());
    expect(outcome.retrying, "a transient source failure retries").toBe(true);
    expect(getJob(id)?.lastError).toContain("SOURCE_UNAVAILABLE");

    // The retry succeeds (e.g. the source recovered / ALREADY_READY).
    const second = claimNextJob("w1", new Date(Date.now() + 6 * 60_000));
    expect(second?.id, "the retried job is claimable after backoff").toBe(id);
    completeJob(id, { ok: true, code: "INGESTED" });

    const row = getJob(id);
    expect(row?.status).toBe("succeeded");
    expect(row?.lastError, "a succeeded job must not still display a failure").toBeNull();
  });
});
