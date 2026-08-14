import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { enqueue } from "./queue";
import { runWorker } from "./worker";

/**
 * The Job OS beyond ingestion — /jobs is becoming the company's operating ledger.
 *
 * Rule pinned here: a kind exists only WITH a working handler. Both of these run real
 * deterministic operations (forecast grading over the canonical store; memory introspection)
 * and succeed on a fresh database with truthful empty findings — "nothing to grade" is a
 * result, not a failure.
 */

describe("durable kinds beyond ingestion", () => {
  useTemporaryDatabase();

  it("forecast_resolve runs the store-only grading pass as durable work", async () => {
    const { id } = enqueue({ kind: "forecast_resolve", payload: {} });
    const drained = await runWorker("kinds-test", 5);
    expect(drained.succeeded).toBeGreaterThanOrEqual(1);

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(job?.status).toBe("succeeded");
    const result = JSON.parse(job?.result ?? "{}") as { scored?: number; reason?: string };
    // Whatever the machine's forecast archive holds, this test's temporary database holds no
    // bars — so nothing can grade, and an honest zero WITH a stated reason is the job's result.
    // (On the dev machine the real archive's pending forecasts are visible here; the pass grades
    // none of them and writes nothing, which is exactly the store-only contract.)
    expect(result.scored).toBe(0);
    expect(typeof result.reason).toBe("string");
    expect((result.reason ?? "").length).toBeGreaterThan(0);
  });

  it("memory_validate runs the introspection pass as durable work", async () => {
    const { id } = enqueue({ kind: "memory_validate", payload: {} });
    const drained = await runWorker("kinds-test", 5);
    expect(drained.succeeded).toBeGreaterThanOrEqual(1);

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(job?.status).toBe("succeeded");
    const result = JSON.parse(job?.result ?? "{}") as { summary?: string };
    expect(typeof result.summary).toBe("string");
    expect((result.summary ?? "").length).toBeGreaterThan(0);
  });

  it("paper_reconcile runs the paper-forward reconciliation as durable work (nothing to do = success)", async () => {
    const { id } = enqueue({ kind: "paper_reconcile", payload: {} });
    const drained = await runWorker("kinds-test", 5);
    expect(drained.succeeded).toBeGreaterThanOrEqual(1);

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(job?.status).toBe("succeeded");
    // A fresh install has no enrolled paper challengers; the pass reconciles nothing and says so.
    const result = JSON.parse(job?.result ?? "{}") as Record<string, unknown>;
    expect(result).toBeTypeOf("object");
  });

  it("incident_repair runs the self-repair pass as durable work", async () => {
    const { id } = enqueue({ kind: "incident_repair", payload: {} });
    const drained = await runWorker("kinds-test", 5);
    expect(drained.succeeded).toBeGreaterThanOrEqual(1);

    const job = getDb().select().from(schema.researchJobs).where(eq(schema.researchJobs.id, id)).get();
    expect(job?.status).toBe("succeeded");
    const result = JSON.parse(job?.result ?? "{}") as { summary?: string };
    expect(typeof result.summary).toBe("string");
  });
});
