/**
 * The agent conductor: one pass runs the most overdue agent job on the best available model.
 * Driven by the Windows task "MarketPulse Agents" through `scripts/agents.mjs`, in its own lease
 * lane so it never waits on (or blocks) the trading cycle.
 */
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDb, schema } from "@/lib/db";
import { loadJobs, overdueBy } from "@/lib/agents/jobs";
import { routeJob } from "@/lib/agents/router";
import { withCycleLease } from "@/lib/learning/lease";

/**
 * Below this, a pass defers. A headless CLI takes 300-500 MB; on 2026-09-19 a smoke run was killed
 * with the machine at 0.7 GB free, and the trading cycle must never be the one that starves.
 */
export const MIN_FREE_BYTES = 1.5 * 1024 ** 3;

export async function runAgentsPass(holder: string): Promise<number> {
  if (os.freemem() < MIN_FREE_BYTES) {
    // Recorded, so "why did no agent run for two hours?" has an answer that is not a guess.
    getDb().insert(schema.auditEvents).values({
      actor: "agent-conductor", action: "agent_pass_deferred", decision: "limited", subject: holder,
      detail: JSON.stringify({ freeGb: Number((os.freemem() / 1024 ** 3).toFixed(2)), needGb: 1.5 }), createdAt: new Date(),
    }).run();
    closeDatabase();
    process.stdout.write(`[${holder}] deferred: ${(os.freemem() / 1024 ** 3).toFixed(1)} GB free, need 1.5\n`);
    return 0;
  }
  try {
    const outcome = await withCycleLease(holder, async () => {
      const due = loadJobs()
        .map((job) => ({ job, overdue: overdueBy(job) }))
        .filter((j): j is { job: (typeof j)["job"]; overdue: number } => j.overdue !== null)
        .sort((a, b) => b.overdue - a.overdue);
      if (due.length === 0) return "no agent job due";
      const { job } = due[0]!;
      const result = await routeJob({ id: job.id, tier: job.tier, prompt: job.prompt, timeoutMs: job.timeoutMs, preferred: job.preferred, tools: job.tools });
      return result ? `${job.id} on ${result.model}: ${result.status} (${Math.round(result.durationMs / 1000)}s)` : `${job.id}: every model is resting`;
    }, path.resolve(process.cwd(), "marketpulse.db.agents-lease"));
    process.stdout.write(`[${holder}] ${outcome.acquired ? outcome.result : `skipped, ${outcome.blockedBy?.holder} holds the agents lease`}\n`);
    return 0;
  } catch (caught) {
    process.stderr.write(`[${holder}] failed: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    return 1;
  } finally {
    closeDatabase();
  }
}
