import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { startAutonomousRun } from "@/lib/runtime/supervisor";

export const dynamic = "force-dynamic";

/**
 * Start the autonomous runtime — the one button on `/brain`.
 *
 * Deliberately NOT owner-gated. Starting the machine within the ceiling the owner already set is an
 * operator action; RAISING that ceiling stays owner-only in `/api/learning`. Conflating the two
 * would either lock the Start button behind a session the operator does not need, or quietly let a
 * start decision widen what the system may do.
 *
 * Idempotent: a second press returns the run already in flight (`created: false`) rather than a
 * second supervisor running every job twice.
 */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  let runtimeProfile = "default";
  try {
    const body = (await req.json()) as { runtimeProfile?: unknown };
    if (typeof body?.runtimeProfile === "string" && body.runtimeProfile.trim()) {
      runtimeProfile = body.runtimeProfile.trim();
    }
  } catch {
    // No body is fine — the profile falls back to the configured default.
  }

  const { run, created } = startAutonomousRun(runtimeProfile);
  return NextResponse.json({ run, created }, { status: created ? 201 : 200 });
}
