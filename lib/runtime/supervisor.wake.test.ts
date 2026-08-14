import { afterEach, describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { enqueue, claimNextJob, completeJob } from "@/lib/research/queue";
import { registerJobWake } from "./supervisor";

/**
 * Event-driven job wake — enqueued work must not wait for the reconciliation poll.
 *
 * The 5s research timer stays as the safety net (missed events, stale leases, cross-process
 * writers); what these tests pin is that the EVENT path exists, fires on both edges that create
 * claimable work (new job; completed job unblocking dependents), and registers exactly once.
 */

describe("registerJobWake", () => {
  useTemporaryDatabase();

  let disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers) dispose();
    disposers = [];
  });

  it("fires the drain on JOB_CREATED — a new job wakes the lane instead of waiting for the poll", () => {
    let drains = 0;
    disposers.push(registerJobWake(() => { drains += 1; }));

    enqueue({ kind: "memory_validate", payload: {} });
    expect(drains, "the enqueue's own event must wake the lane").toBeGreaterThanOrEqual(1);
  });

  it("fires the drain on JOB_COMPLETED — dependents just became claimable", () => {
    const { id } = enqueue({ kind: "memory_validate", payload: {} });
    claimNextJob("wake-test");

    let drains = 0;
    disposers.push(registerJobWake(() => { drains += 1; }));

    completeJob(id, { note: "done" });
    expect(drains, "a completion unblocks dependents and must wake the lane").toBeGreaterThanOrEqual(1);
  });

  it("registers once — a second call reuses the live registration", () => {
    let drains = 0;
    const first = registerJobWake(() => { drains += 1; });
    const second = registerJobWake(() => { drains += 100; });
    expect(second, "identity: no second subscription was stacked").toBe(first);

    enqueue({ kind: "memory_validate", payload: {} });
    expect(drains).toBeGreaterThanOrEqual(1);
    expect(drains, "the second callback must never have been subscribed").toBeLessThan(100);

    first();
    const third = registerJobWake(() => {});
    expect(third).not.toBe(first);
    third();
  });
});
