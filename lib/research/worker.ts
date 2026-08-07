import { recordFailure } from "@/lib/knowledge/repository";
import { ingestSource, type IngestPayload } from "./ingest";
import { claimNextJob, completeJob, failJob, type ClaimedJob } from "./queue";

export interface WorkerResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
  idle: boolean;
}

async function runJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case "ingest_paper":
    case "ingest_video":
    case "ingest_repository":
    case "ingest_web": {
      const payload = job.payload as unknown as IngestPayload;
      if (!payload?.title || !payload?.content) {
        throw new Error("Ingestion payload requires both a title and content.");
      }
      return ingestSource(job.kind, payload) as unknown as Record<string, unknown>;
    }
    case "dedupe_hypotheses":
      return { note: "Deduplication runs inline during ingestion; nothing to do." };
    default:
      throw new Error(`Unsupported job kind "${job.kind}".`);
  }
}

/**
 * Drains up to `maxJobs` from the queue. This is the deterministic half of the system:
 * it runs on a schedule with Claude Code closed and needs no model to make progress.
 */
export async function runWorker(workerId = "worker-1", maxJobs = 10): Promise<WorkerResult> {
  const result: WorkerResult = { processed: 0, succeeded: 0, failed: 0, dead: 0, idle: true };

  for (let index = 0; index < maxJobs; index += 1) {
    const job = claimNextJob(workerId);
    if (!job) break;

    result.idle = false;
    result.processed += 1;

    try {
      completeJob(job.id, await runJob(job));
      result.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = failJob(job.id, message);
      result.failed += 1;
      if (!outcome.retrying) {
        result.dead += 1;
        // A permanently failed job becomes durable failure memory so the same
        // dead end is visible to future research rather than silently retried.
        recordFailure("system", `job_${job.kind}`, message, String(job.id), "Job exhausted its retries.");
      }
    }
  }

  return result;
}
