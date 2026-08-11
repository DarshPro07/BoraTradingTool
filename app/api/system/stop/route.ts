import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { stopAutonomousRun } from "@/lib/runtime/supervisor";

export const dynamic = "force-dynamic";

/** Stop the autonomous runtime. Returns 404 when nothing was running — stopping nothing is not an error worth inventing state for. */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  let reason = "Stopped by the owner.";
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body?.reason === "string" && body.reason.trim()) reason = body.reason.trim();
  } catch {
    // No body is fine.
  }

  const run = stopAutonomousRun(reason);
  if (!run) return NextResponse.json({ running: false, run: null }, { status: 404 });
  return NextResponse.json({ running: false, run });
}
