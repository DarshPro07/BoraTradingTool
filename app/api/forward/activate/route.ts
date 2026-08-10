import { NextResponse } from "next/server";
import { activateChallenger } from "@/lib/forward/shadow";
import { requireMutationAccess } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  SPEC_NOT_FOUND: 404,
  DSL_INVALID: 409,
  ALREADY_ACTIVE: 409,
  NO_RESEARCH_IDENTITY: 412,
  NO_GAUNTLET_EXPERIMENT: 412,
  ECONOMICS_UNPRICEABLE: 503,
};

/**
 * Freeze a strategy version into a forward challenger. Explicit confirmation required — from the
 * moment of activation the forward clock runs and the identity cannot be edited, only retired.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: { specId?: unknown; confirm?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }

  const specId = typeof body.specId === "string" ? body.specId.trim() : "";
  if (!specId) return NextResponse.json({ error: "SPEC_REQUIRED", message: "specId is required." }, { status: 400 });

  if (body.confirm !== true) {
    return NextResponse.json(
      {
        error: "CONFIRMATION_REQUIRED",
        message:
          "Activation freezes this strategy version into an immutable forward challenger and starts its " +
          "forward clock. Repeat with confirm: true.",
      },
      { status: 428 },
    );
  }

  const result = activateChallenger(specId, "owner");
  if (!result.ok) {
    return NextResponse.json({ error: result.code, message: result.message }, { status: STATUS[result.code] ?? 400 });
  }
  return NextResponse.json({ challengerId: result.challengerId, policy: result.policy }, { status: 201 });
}
