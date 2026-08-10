import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { queueStats } from "./queue";
import { produceResearchJobs, type DiscoveredSource } from "./producer";

/**
 * The queue's missing mouth.
 *
 * `runWorker` drains the research queue and works correctly. `enqueue` is called from exactly
 * three places: the MCP server (an agent, by hand), one API route (a human POST), and a test.
 * So the learning cycle drains a queue that nothing autonomous ever fills — the loop turns and
 * nothing feeds it. That, not the scheduler, is why the system "only learns".
 *
 * The producer is the arrow that closes it.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-producer-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "producer.db");
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

function source(overrides: Partial<DiscoveredSource> = {}): DiscoveredSource {
  return {
    externalId: "arXiv:2408.00001",
    kind: "ingest_paper",
    title: "Cross-sectional momentum in Indian equities",
    content: "We document a momentum effect in NSE cash equities over 2005-2024...",
    url: "https://arxiv.org/abs/2408.00001",
    authors: ["A. Researcher"],
    ...overrides,
  };
}

describe("filling the queue", () => {
  it("enqueues what it discovers", async () => {
    const result = await produceResearchJobs({ discover: async () => [source()] });
    expect(result.enqueued).toBe(1);
    expect(queueStats().queued).toBe(1);
  });

  it("enqueues a job the worker can actually run", async () => {
    // `runJob` throws unless the payload carries both a title and content. Enqueuing a bare URL
    // would produce a job that fails three times and lands in failure memory as a permanent dead
    // end — the queue would be full and the system no better informed.
    await produceResearchJobs({ discover: async () => [source()] });
    expect(queueStats().queued).toBe(1);
    expect(queueStats().dead).toBe(0);
  });

  it("refuses a source with no content instead of queuing a job that must fail", async () => {
    const result = await produceResearchJobs({ discover: async () => [source({ content: "  " })] });
    expect(result.enqueued).toBe(0);
    expect(result.rejected).toBe(1);
    expect(queueStats().queued).toBe(0);
  });
});

describe("not doing the same work twice", () => {
  it("does not re-enqueue a source it has already seen", async () => {
    const discover = async () => [source()];
    await produceResearchJobs({ discover });
    const second = await produceResearchJobs({ discover });

    expect(second.enqueued).toBe(0);
    expect(second.deduped).toBe(1);
    expect(queueStats().queued).toBe(1);
  });

  it("still takes genuinely new sources on a later run", async () => {
    await produceResearchJobs({ discover: async () => [source()] });
    const second = await produceResearchJobs({
      discover: async () => [source(), source({ externalId: "arXiv:2408.00002", title: "Another" })],
    });

    expect(second.enqueued).toBe(1);
    expect(second.deduped).toBe(1);
  });
});

describe("staying within its bounds", () => {
  it("caps how much it takes in one pass", async () => {
    const many = Array.from({ length: 50 }, (_unused, index) =>
      source({ externalId: `arXiv:9${index}`, title: `Paper ${index}` }),
    );
    const result = await produceResearchJobs({ discover: async () => many, max: 5 });
    expect(result.enqueued).toBe(5);
  });

  it("says how many it left behind rather than silently truncating", async () => {
    // A cap that does not report itself reads as "that was everything available", which is how a
    // research loop quietly stops covering its own field.
    const many = Array.from({ length: 12 }, (_unused, index) => source({ externalId: `arXiv:8${index}` }));
    const result = await produceResearchJobs({ discover: async () => many, max: 3 });
    expect(result.reason).toMatch(/12|remain|left/i);
  });
});

describe("when the outside world is unavailable", () => {
  it("refuses rather than throwing, so one dead feed does not stop the cycle", async () => {
    const result = await produceResearchJobs({
      discover: async () => {
        throw new Error("getaddrinfo ENOTFOUND export.arxiv.org");
      },
    });
    expect(result.enqueued).toBe(0);
    expect(result.reason).toMatch(/ENOTFOUND|unavailable|could not/i);
  });

  it("distinguishes an empty feed from a broken one", async () => {
    // Missing is not zero. "The feed returned nothing" and "the feed could not be reached" have
    // different remedies, and reporting both as 0 hides the one worth acting on.
    const empty = await produceResearchJobs({ discover: async () => [] });
    const broken = await produceResearchJobs({
      discover: async () => {
        throw new Error("socket hang up");
      },
    });
    expect(empty.reason).not.toBe(broken.reason);
    expect(empty.failed).toBe(false);
    expect(broken.failed).toBe(true);
  });
});
