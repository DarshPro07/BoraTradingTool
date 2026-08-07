import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { JOB_KINDS, JOB_STATUSES, enqueue, listJobs, queueStats, type JobKind, type JobStatus } from "@/lib/research/queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && (JOB_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as JobStatus)
    : undefined;

  return NextResponse.json(
    {
      jobs: listJobs(status).map((job) => ({
        id: job.id,
        kind: job.kind,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })),
      stats: queueStats(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value as { kind?: unknown; payload?: unknown; dedupeKey?: unknown; priority?: unknown };
  if (typeof body.kind !== "string" || !(JOB_KINDS as readonly string[]).includes(body.kind)) {
    return NextResponse.json(
      { error: "INVALID_JOB_KIND", message: `kind must be one of: ${JOB_KINDS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return NextResponse.json({ error: "INVALID_PAYLOAD", message: "payload must be an object." }, { status: 400 });
  }

  const result = enqueue({
    kind: body.kind as JobKind,
    payload: body.payload as Record<string, unknown>,
    dedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : undefined,
    priority: typeof body.priority === "number" && Number.isFinite(body.priority) ? body.priority : undefined,
  });

  return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
}
