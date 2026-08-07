import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { runWorker } from "@/lib/research/worker";
import { queueStats } from "@/lib/research/queue";

export const dynamic = "force-dynamic";

/**
 * Drains the research queue. Safe to call on a schedule; the queue's leases make
 * concurrent invocations harmless.
 */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const maxRaw = Number(url.searchParams.get("max") ?? "10");
  const maxJobs = Number.isFinite(maxRaw) ? Math.min(Math.max(Math.trunc(maxRaw), 1), 50) : 10;

  const result = await runWorker(`http-${process.pid}`, maxJobs);
  return NextResponse.json({ ...result, stats: queueStats() });
}
