import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { authorizeSeal, sealById } from "@/lib/research-data/holdout-seal";

export const dynamic = "force-dynamic";

/**
 * SEALED → AUTHORIZED_FOR_EVALUATION, behind the house confirm gate (428 first, like the
 * gauntlet's trial spend): authorization is the owner saying "spend this sample's one question",
 * and it must never happen as a side effect of a stray call.
 */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as { holdoutId?: unknown; confirm?: unknown };

  if (typeof body.holdoutId !== "string" || body.holdoutId.length === 0) {
    return NextResponse.json({ error: "INVALID_HOLDOUT_ID", message: "holdoutId is required." }, { status: 400 });
  }

  if (body.confirm !== true) {
    const seal = sealById(body.holdoutId);
    return NextResponse.json(
      {
        error: "CONFIRM_REQUIRED",
        message:
          "Authorizing a holdout permits its ONE evaluation — the family that looks consumes the " +
          "sample for the whole campaign generation. Repeat with confirm:true to proceed.",
        seal: seal
          ? { id: seal.id, generation: seal.generation, market: seal.market, resolution: seal.resolution, state: seal.state, barCount: seal.barCount }
          : null,
      },
      { status: 428 },
    );
  }

  const outcome = authorizeSeal(body.holdoutId, "owner:api");
  if (!outcome.ok) {
    const status = outcome.code === "SEAL_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ error: outcome.code, message: outcome.message }, { status });
  }
  return NextResponse.json({ seal: outcome.seal });
}
