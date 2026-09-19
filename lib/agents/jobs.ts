/**
 * Agent jobs: one markdown file per job in `agents/jobs/`, frontmatter + prompt.
 *
 *   ---
 *   id: research-papers
 *   layer: L1
 *   tier: routine            # routine | standard | deep  -> the router's model list
 *   cadenceMinutes: 120
 *   timeoutMinutes: 15
 *   preferred: gemini        # optional, comma-separated model ids tried first
 *   ---
 *   <prompt>
 *
 * A job is due when its last SUCCESS is older than its cadence and its last ATTEMPT is older than
 * the retry gap — so a failing job retries, but not every pass.
 */
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Tier } from "./router";

export interface AgentJob {
  id: string;
  layer: string;
  tier: Tier;
  cadenceMs: number;
  timeoutMs: number;
  preferred: string[];
  /** Tools the job may use (MCP short names, WebFetch/WebSearch). Enforced for Claude runs. */
  tools: string[];
  prompt: string;
}

export const RETRY_GAP_MS = 30 * 60_000;

export function parseJob(text: string): AgentJob {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("job file needs --- frontmatter ---");
  const meta = Object.fromEntries(
    match[1]!.split(/\r?\n/).map((line) => line.split("#")[0]!.trim()).filter(Boolean).map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  const tier = meta.tier as Tier;
  if (!meta.id || !["routine", "standard", "deep"].includes(tier)) throw new Error(`bad job frontmatter: ${JSON.stringify(meta)}`);
  return {
    id: meta.id,
    layer: meta.layer ?? "?",
    tier,
    cadenceMs: Number(meta.cadenceMinutes ?? 120) * 60_000,
    timeoutMs: Number(meta.timeoutMinutes ?? 15) * 60_000,
    preferred: (meta.preferred ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    tools: (meta.tools ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    prompt: match[2]!.trim(),
  };
}

export function loadJobs(dir = path.resolve(process.cwd(), "agents", "jobs")): AgentJob[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => parseJob(fs.readFileSync(path.join(dir, f), "utf8")));
}

/** Milliseconds overdue (>= 0), or null when not due. The most overdue job runs first. */
export function overdueBy(job: AgentJob, now = Date.now()): number | null {
  const runs = getDb().select().from(schema.agentRuns).where(eq(schema.agentRuns.capability, job.id)).orderBy(desc(schema.agentRuns.startedAt)).all();
  const lastAttempt = runs[0]?.startedAt.getTime() ?? 0;
  const lastSuccess = runs.find((r) => r.status === "SUCCEEDED")?.startedAt.getTime() ?? 0;
  if (now - lastAttempt < Math.min(RETRY_GAP_MS, job.cadenceMs)) return null;
  const overdue = now - lastSuccess - job.cadenceMs;
  return overdue >= 0 ? overdue : null;
}
