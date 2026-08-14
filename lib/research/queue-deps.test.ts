import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  completeJob,
  claimNextJob,
  enqueue,
  enqueueDependent,
  failJob,
  getJob,
  pendingDependencies,
  unblockDependents,
} from "./queue";
import { addJobDependencies } from "./queue";
import { wouldCreateCycle, validateDependencies, dependencyReport } from "./dependencies";

useTemporaryDatabase();

describe("job dependencies - happy path", () => {
  it("blocks a job until its dependency succeeds", () => {
    const dataJob = enqueue({ kind: "ingest_web", payload: { url: "https://example.com" } });
    const researchJob = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://research.example.com" } },
      [dataJob.id],
    );

    expect(getJob(researchJob.id)?.status).toBe("waiting_dependency");

    const claimable = claimNextJob("worker-1");
    expect(claimable?.id).toBe(dataJob.id);

    expect(pendingDependencies(researchJob.id)).toEqual([dataJob.id]);

    completeJob(dataJob.id, { done: true });

    expect(pendingDependencies(researchJob.id)).toEqual([]);

    const next = claimNextJob("worker-1");
    expect(next?.id).toBe(researchJob.id);
  });

  it("unblocks dependents when all deps succeed", () => {
    const dep1 = enqueue({ kind: "ingest_web", payload: { url: "https://d1.com" } });
    const dep2 = enqueue({ kind: "ingest_web", payload: { url: "https://d2.com" } });
    const dependent = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://dep.com" } },
      [dep1.id, dep2.id],
    );

    expect(getJob(dependent.id)?.status).toBe("waiting_dependency");
    expect(unblockDependents(dep1.id)).toEqual([]);

    completeJob(dep1.id, {});
    expect(pendingDependencies(dependent.id)).toEqual([dep2.id]);

    // completeJob already calls unblockDependents internally.
    completeJob(dep2.id, {});
    expect(getJob(dependent.id)?.status).toBe("queued");
    // Now claimable.
    const claimable = claimNextJob("worker");
    expect(claimable?.id).toBe(dependent.id);
  });

  it("never claims a job with unsatisfied dependencies", () => {
    const dep = enqueue({ kind: "ingest_web", payload: { url: "https://blocked.com" } });
    const blocked = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://blocked-child.com" } },
      [dep.id],
    );

    const first = claimNextJob("worker-a");
    expect(first?.id).toBe(dep.id);

    completeJob(dep.id, {});

    const second = claimNextJob("worker-a");
    expect(second?.id).toBe(blocked.id);
  });
});

describe("job dependencies - failure semantics", () => {
  it("terminal failure blocks dependents permanently", () => {
    const dataJob = enqueue({ kind: "ingest_web", payload: { url: "https://failing.com" }, maxAttempts: 1 });
    const researchJob = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://research-after-fail.com" } },
      [dataJob.id],
    );

    // Real flow: claim (attempts 0→1) → failJob checks exhausted (1 >= 1).
    claimNextJob("worker-1");
    const result = failJob(dataJob.id, "terminal error");

    expect(result.retrying).toBe(false);
    expect(getJob(dataJob.id)?.status).toBe("dead");
    expect(getJob(researchJob.id)?.status).toBe("blocked_dependency");
    expect(getJob(researchJob.id)?.lastError).toContain("failed permanently");

    const claimable = claimNextJob("worker-1");
    expect(claimable).toBeNull();
  });

  it("cascades terminal failure through multiple levels", () => {
    const dataJob = enqueue({ kind: "ingest_web", payload: { url: "https://cascade-root.com" }, maxAttempts: 1 });
    const researchJob = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://cascade-mid.com" } },
      [dataJob.id],
    );
    const strategyJob = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://cascade-leaf.com" } },
      [researchJob.id],
    );

    claimNextJob("worker");
    failJob(dataJob.id, "e1"); // dead

    expect(getJob(researchJob.id)?.status).toBe("blocked_dependency");
    expect(getJob(strategyJob.id)?.status).toBe("blocked_dependency");
    expect(claimNextJob("worker")).toBeNull();
  });

  it("transient failure keeps dependent waiting (not blocked)", () => {
    const dep = enqueue({ kind: "ingest_web", payload: { url: "https://transient.com" } });
    const dependent = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://waits.com" } },
      [dep.id],
    );

    const result = failJob(dep.id, "transient error");
    expect(result.retrying).toBe(true);
    expect(getJob(dep.id)?.status).toBe("queued");
    expect(getJob(dependent.id)?.status).toBe("waiting_dependency");
  });

  it("multiple dependencies - blocks until ALL succeed", () => {
    const dep1 = enqueue({ kind: "ingest_web", payload: { url: "https://multi-1.com" } });
    const dep2 = enqueue({ kind: "ingest_web", payload: { url: "https://multi-2.com" } });
    const dependent = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://multi-child.com" } },
      [dep1.id, dep2.id],
    );

    completeJob(dep1.id, {});
    expect(getJob(dependent.id)?.status).toBe("waiting_dependency");
    expect(pendingDependencies(dependent.id)).toEqual([dep2.id]);

    completeJob(dep2.id, {});
    expect(getJob(dependent.id)?.status).toBe("queued");
    expect(pendingDependencies(dependent.id)).toEqual([]);
  });

  it("partial failure with multiple deps - blocks permanently", () => {
    const dep1 = enqueue({ kind: "ingest_web", payload: { url: "https://partial-ok.com" } });
    const dep2 = enqueue({ kind: "ingest_web", payload: { url: "https://partial-fail.com" }, maxAttempts: 1 });
    const dependent = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://partial-child.com" } },
      [dep1.id, dep2.id],
    );

    completeJob(dep1.id, {});
    claimNextJob("worker");
    failJob(dep2.id, "e1"); // dead

    expect(getJob(dependent.id)?.status).toBe("blocked_dependency");
  });

  it("duplicate completion unblocks exactly once", () => {
    const dep = enqueue({ kind: "ingest_web", payload: { url: "https://dup.com" } });
    const dependent = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://dup-child.com" } },
      [dep.id],
    );

    completeJob(dep.id, {});
    completeJob(dep.id, {});

    expect(getJob(dependent.id)?.status).toBe("queued");
    expect(unblockDependents(dep.id)).toEqual([]);
  });
});

describe("job dependencies - cycle and validation", () => {
  it("detects self-dependency as cycle", () => {
    const job = enqueue({ kind: "ingest_web", payload: { url: "https://self.com" } });
    expect(wouldCreateCycle(job.id, job.id)).toBe(true);
  });

  it("detects indirect cycles", () => {
    const a = enqueue({ kind: "ingest_web", payload: { url: "a" } });
    const b = enqueue({ kind: "ingest_web", payload: { url: "b" } });
    const c = enqueue({ kind: "ingest_web", payload: { url: "c" } });

    // A depends on B, B depends on C
    addJobDependencies({ jobId: a.id, dependsOnIds: [b.id] });
    addJobDependencies({ jobId: b.id, dependsOnIds: [c.id] });

    // C -> A would create cycle A->B->C->A (c depends on a, a depends on b, b depends on c)
    expect(wouldCreateCycle(c.id, a.id)).toBe(true);
    // A -> C is fine (c has no deps, so no cycle)
    expect(wouldCreateCycle(a.id, c.id)).toBe(false);
  });

  it("rejects missing dependencies", () => {
    const result = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://missing.com" } },
      [999999],
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons[0]).toContain("not found");
    expect(getJob(result.id)?.status).toBe("blocked_dependency");
  });

  it("validateDependencies reports missing IDs", () => {
    const existing = enqueue({ kind: "ingest_web", payload: { url: "exists" } });
    const missing = validateDependencies(existing.id, [existing.id, 888888, 777777]);
    expect(missing).toEqual([888888, 777777]);
  });

  it("dependencyReport gives full picture", () => {
    const dep = enqueue({ kind: "ingest_web", payload: { url: "https://report-dep.com" }, maxAttempts: 1 });
    const child = enqueueDependent(
      { kind: "ingest_web", payload: { url: "https://report-child.com" } },
      [dep.id],
    );

    const report = dependencyReport(child.id);
    expect(report.status).toBe("waiting_dependency");
    expect(report.dependencies).toHaveLength(1);
    expect(report.dependencies[0].id).toBe(dep.id);
    expect(report.blockedBy).toEqual([]);

    claimNextJob("worker");
    failJob(dep.id, "e1"); // dead

    const afterFail = dependencyReport(child.id);
    expect(afterFail.status).toBe("blocked_dependency");
    expect(afterFail.blockedBy).toEqual([dep.id]);
  });
});
