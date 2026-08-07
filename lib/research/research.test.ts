import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { claimNextJob, completeJob, enqueue, failJob, getJob, jobEvents, queueStats } from "./queue";
import { DUPLICATE_THRESHOLD, findDuplicateHypothesis, ingestSource, similarity } from "./ingest";
import { runWorker } from "./worker";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-research-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "research.db");
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const PAPER_PAYLOAD = {
  kind: "paper" as const,
  title: "Momentum in Indian equities",
  content: "Twelve-month momentum persists on NSE after controlling for size.",
  claims: [
    {
      statement: "Twelve-month momentum persists on NSE after controlling for size.",
      epistemicStatus: "historically_observed",
      confidence: 0.55,
    },
  ],
  hypotheses: [
    {
      title: "NSE 12-month momentum",
      statement: "Buying the top momentum decile on NSE outperforms the index over 12 months.",
      market: "NSE",
    },
  ],
};

describe("job queue", () => {
  it("enqueues and claims in priority then id order", () => {
    enqueue({ kind: "ingest_web", payload: { n: 1 }, priority: 200 });
    const urgent = enqueue({ kind: "ingest_paper", payload: { n: 2 }, priority: 10 });

    const claimed = claimNextJob("worker-a");
    expect(claimed?.id).toBe(urgent.id);
    expect(claimed?.attempts).toBe(1);
  });

  it("deduplicates by key instead of queueing twice", () => {
    const first = enqueue({ kind: "ingest_paper", payload: {}, dedupeKey: "doi:10.1/abc" });
    const second = enqueue({ kind: "ingest_paper", payload: {}, dedupeKey: "doi:10.1/abc" });

    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(queueStats().queued).toBe(1);
  });

  it("does not hand the same job to two workers", () => {
    enqueue({ kind: "ingest_web", payload: {} });
    expect(claimNextJob("worker-a")).not.toBeNull();
    expect(claimNextJob("worker-b")).toBeNull();
  });

  it("reclaims a job whose lease expired so a crashed worker cannot strand it", () => {
    enqueue({ kind: "ingest_web", payload: {} });
    const first = claimNextJob("worker-a", new Date(), 1_000);
    expect(first).not.toBeNull();

    const later = new Date(Date.now() + 5_000);
    const second = claimNextJob("worker-b", later);
    expect(second?.id).toBe(first?.id);
    expect(second?.attempts).toBe(2);
  });

  it("retries with backoff then marks the job dead", () => {
    const { id } = enqueue({ kind: "ingest_web", payload: {}, maxAttempts: 2 });

    claimNextJob("worker-a");
    expect(failJob(id, "boom").retrying).toBe(true);
    expect(getJob(id)?.status).toBe("queued");

    claimNextJob("worker-a", new Date(Date.now() + 60_000));
    expect(failJob(id, "boom again").retrying).toBe(false);
    expect(getJob(id)?.status).toBe("dead");
    expect(getJob(id)?.lastError).toBe("boom again");
  });

  it("keeps an append-only event history", () => {
    const { id } = enqueue({ kind: "ingest_web", payload: {} });
    claimNextJob("worker-a");
    completeJob(id, { ok: true });

    const events = jobEvents(id).map((event) => event.event);
    expect(events).toEqual(["enqueued", "claimed", "succeeded"]);
    expect(() => getDb().delete(schema.researchJobEvents).run()).toThrow(/append-only/i);
  });
});

describe("hypothesis deduplication", () => {
  it("scores restatements as similar and unrelated text as dissimilar", () => {
    const a = "Buying the top momentum decile on NSE outperforms the index over 12 months.";
    const b = "Buying the top momentum decile on NSE outperforms the index over twelve months.";
    expect(similarity(a, b)).toBeGreaterThan(0.7);
    expect(similarity(a, "Gold tends to rally when real yields fall.")).toBeLessThan(0.2);
  });

  it("treats identical statements as duplicates", () => {
    expect(similarity("same words here", "same words here")).toBe(1);
    expect(DUPLICATE_THRESHOLD).toBeLessThan(1);
  });

  it("flags a second ingestion of the same idea as a duplicate", () => {
    ingestSource("ingest_paper", PAPER_PAYLOAD);
    const second = ingestSource("ingest_paper", {
      ...PAPER_PAYLOAD,
      content: "A different write-up of the same finding.",
      hypotheses: [
        {
          title: "NSE momentum restated",
          statement: "Buying the top momentum decile on NSE outperforms the index over 12 months.",
          market: "NSE",
        },
      ],
    });

    expect(second.duplicateHypotheses).toHaveLength(1);
    expect(second.hypothesisIds).toHaveLength(0);
    expect(second.notes.join(" ")).toMatch(/restates/);
  });

  it("returns null when nothing similar exists", () => {
    expect(findDuplicateHypothesis("An entirely unrelated idea about bond convexity")).toBeNull();
  });
});

describe("ingestion", () => {
  it("archives a source and links its claims and hypotheses", () => {
    const result = ingestSource("ingest_paper", PAPER_PAYLOAD);
    expect(result.sourceCreated).toBe(true);
    expect(result.claimIds).toHaveLength(1);
    expect(result.hypothesisIds).toHaveLength(1);
  });

  it("reuses an archived source when the content repeats", () => {
    ingestSource("ingest_paper", PAPER_PAYLOAD);
    const again = ingestSource("ingest_paper", { ...PAPER_PAYLOAD, hypotheses: [] });
    expect(again.sourceCreated).toBe(false);
    expect(again.notes.join(" ")).toMatch(/already archived/);
  });

  it("says so plainly when a source yields no extracted knowledge", () => {
    const result = ingestSource("ingest_web", { kind: "web", title: "Blog", content: "opinions only" });
    expect(result.claimIds).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/no claims supplied/i);
  });
});

describe("worker", () => {
  it("drains the queue with no model involved", async () => {
    enqueue({ kind: "ingest_paper", payload: PAPER_PAYLOAD as unknown as Record<string, unknown> });
    const result = await runWorker("worker-1");

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.idle).toBe(false);

    const sources = getDb().select().from(schema.knowledgeSources).all();
    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe("Momentum in Indian equities");
  });

  it("reports idle when there is nothing to do", async () => {
    const result = await runWorker("worker-1");
    expect(result).toMatchObject({ processed: 0, idle: true });
  });

  it("records durable failure memory when a job dies", async () => {
    enqueue({ kind: "ingest_paper", payload: { title: "no content" }, maxAttempts: 1 });
    const result = await runWorker("worker-1");

    expect(result.failed).toBe(1);
    expect(result.dead).toBe(1);

    const failures = getDb().select().from(schema.failureMemory).all();
    expect(failures).toHaveLength(1);
    expect(failures[0].failureMode).toBe("job_ingest_paper");
  });

  it("rejects an unsupported job kind rather than silently succeeding", async () => {
    enqueue({ kind: "nonsense" as never, payload: {}, maxAttempts: 1 });
    const result = await runWorker("worker-1");
    expect(result.succeeded).toBe(0);
    expect(result.dead).toBe(1);
  });
});
