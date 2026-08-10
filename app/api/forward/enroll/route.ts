import { NextResponse } from "next/server";
import { enrollChallengerInPaper } from "@/lib/forward/paper";
import { requireMutationAccess } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  CHALLENGER_NOT_FOUND: 404,
  NOT_ACTIVE: 409,
  ALREADY_ENROLLED: 409,
};

/** Enroll an ACTIVE challenger into the paper stage at real validation capital (default ₹1,000). */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: { challengerId?: unknown; startingCash?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }
  const challengerId = typeof body.challengerId === "string" ? body.challengerId.trim() : "";
  if (!challengerId) {
    return NextResponse.json({ error: "CHALLENGER_REQUIRED", message: "challengerId is required." }, { status: 400 });
  }
  const startingCash = body.startingCash === undefined ? undefined : Number(body.startingCash);
  if (startingCash !== undefined && (!Number.isFinite(startingCash) || startingCash <= 0)) {
    return NextResponse.json({ error: "BAD_CAPITAL", message: "startingCash must be a positive number." }, { status: 400 });
  }

  const result = enrollChallengerInPaper(challengerId, "owner", startingCash);
  if (!result.ok) {
    return NextResponse.json({ error: result.code, message: result.message }, { status: STATUS[result.code] ?? 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
