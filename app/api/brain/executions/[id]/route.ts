import { NextResponse } from "next/server";
import { executionTrace } from "@/lib/brain/execution-trace";

export const dynamic = "force-dynamic";

/** The full execution tree for one TeamRun — one coherent read model, not twenty queries. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const trace = executionTrace(id);
  if (!trace) {
    return NextResponse.json({ error: "TEAM_RUN_NOT_FOUND", message: `No TeamRun ${id}.` }, { status: 404 });
  }
  return NextResponse.json({ trace }, { headers: { "cache-control": "no-store" } });
}
