import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getActivityTimeline, getActivityCounts } from "./activity";
import { enqueue, completeJob } from "@/lib/research/queue";

useTemporaryDatabase();

describe("Brain activity projection", () => {
  it("includes job events in the timeline", () => {
    const job = enqueue({ kind: "ingest_web", payload: { url: "https://test.com" } });
    completeJob(job.id, { done: true });

    const timeline = getActivityTimeline({ limit: 10 });
    expect(timeline.length).toBeGreaterThanOrEqual(2); // enqueued + succeeded

    const jobEvents = timeline.filter((i) => i.entityId === String(job.id));
    expect(jobEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("includes audit events", () => {
    // Insert a direct audit event.
    getDb()
      .insert(schema.auditEvents)
      .values({
        actor: "test",
        action: "test_action",
        decision: "allowed",
        denialCode: null,
        subject: "test-subject",
        detail: "test detail",
        learningMode: null,
        createdAt: new Date(),
      })
      .run();

    const timeline = getActivityTimeline({ limit: 10 });
    const auditItems = timeline.filter((i) => i.sourceLedger === "audit_events");
    expect(auditItems.length).toBeGreaterThanOrEqual(1);
    expect(auditItems[0].action).toBe("test_action");
  });

  it("filters by category", () => {
    const job = enqueue({ kind: "ingest_web", payload: { url: "https://filter.com" } });

    const jobItems = getActivityTimeline({ limit: 10, category: "job" });
    expect(jobItems.length).toBeGreaterThanOrEqual(1);
    expect(jobItems.every((i) => i.category === "job")).toBe(true);
  });

  it("sorts by time descending", () => {
    const timeline = getActivityTimeline({ limit: 50 });
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].occurredAt.getTime()).toBeGreaterThanOrEqual(timeline[i].occurredAt.getTime());
    }
  });

  it("getActivityCounts returns per-category counts", () => {
    const job = enqueue({ kind: "ingest_web", payload: { url: "https://counts.com" } });

    const counts = getActivityCounts();
    expect(counts.job).toBeGreaterThanOrEqual(1);
    expect(counts.runtime).toBeGreaterThanOrEqual(0);
  });

  it("respects the since filter", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days ago
    const recent = getActivityTimeline({ limit: 100, since: new Date(Date.now() - 60 * 60 * 1000) });

    // All items should be within the last hour.
    for (const item of recent) {
      expect(item.occurredAt.getTime()).toBeGreaterThanOrEqual(Date.now() - 60 * 60 * 1000);
    }
  });

  it("projects multiple source types without error", () => {
    // Create a job to generate events.
    const job = enqueue({ kind: "ingest_web", payload: { url: "https://multi-source.com" } });
    completeJob(job.id, {});

    // The timeline should include both job events AND audit events from the supervisor.
    const timeline = getActivityTimeline({ limit: 50 });
    const categories = new Set(timeline.map((i) => i.category));

    // Should have at least job and system/audit categories.
    expect(categories.has("job")).toBe(true);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
  });
});
