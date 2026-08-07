import { NextResponse } from "next/server";
import { assessIdle, inspectMemory } from "@/lib/learning/introspection";

export const dynamic = "force-dynamic";

/**
 * Learning-mode self-inspection: what the system currently finds wrong with its own memory,
 * plus whether the owner is idle enough for the deeper passes to be worth running.
 *
 * Read-only by design. Idle mode inspects and queues; it does not act.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get("lastActivityAt");
  const lastOwnerActivityAt = since ? new Date(since) : new Date();

  if (Number.isNaN(lastOwnerActivityAt.getTime())) {
    return NextResponse.json(
      { error: "INVALID_TIMESTAMP", message: `"${since}" is not a parseable date.` },
      { status: 400 },
    );
  }

  const idle = assessIdle(lastOwnerActivityAt);

  try {
    const report = inspectMemory();
    return NextResponse.json({ idle, ...report }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // A knowledge base that cannot be read is reported as such rather than as an empty one:
    // "no findings" and "could not look" are different states and must not render alike.
    return NextResponse.json(
      {
        error: "MEMORY_UNREADABLE",
        message: error instanceof Error ? error.message : "The knowledge base could not be read.",
        idle,
      },
      { status: 503 },
    );
  }
}
