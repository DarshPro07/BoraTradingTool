import { NextResponse } from "next/server";
import { listExecutions } from "@/lib/brain/execution-trace";

export const dynamic = "force-dynamic";

/** Recent TeamRun executions — the /brain RECENT WORK panel's one read. */
export async function GET() {
  return NextResponse.json({ executions: listExecutions(20) }, { headers: { "cache-control": "no-store" } });
}
