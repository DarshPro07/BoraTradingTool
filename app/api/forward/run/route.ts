import { NextResponse } from "next/server";
import { runPaperPass } from "@/lib/forward/paper";
import { runShadowPass } from "@/lib/forward/shadow";
import { requireMutationAccess } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Run one shadow pass on demand. The learning cycle runs this automatically at learning mode;
 * this door exists for the owner and for end-to-end verification. It spends nothing: no trial,
 * no holdout — only prospective observation over stored bars.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  // Optional time-travel (queue item 10, first consumer): evaluate "as of" a stated moment
  // instead of the wall clock. Deterministic journeys advance a date and watch a signal appear;
  // the watermark still forbids anything retroactive, so travel cannot rewrite history.
  let asOf: Date | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { asOf?: unknown };
    if (body.asOf !== undefined) {
      const parsed = typeof body.asOf === "number" ? new Date(body.asOf * 1000) : new Date(String(body.asOf));
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "BAD_AS_OF", message: "asOf must be an ISO date string or unix seconds." },
          { status: 400 },
        );
      }
      asOf = parsed;
    }
  } catch {
    // No body at all is fine — the wall clock serves.
  }

  // Shadow first (signals), then paper (intents/fills/closes on those signals). Same asOf: one
  // deterministic moment for both stages, two strictly separate ledgers. The instant is resolved
  // HERE and handed to both passes, so the mode/evaluatedAsOf echoed below attests what actually
  // ran — a replay result must carry its label from the server, not from client inference (P2:
  // never label replay as live).
  const evaluatedAt = asOf ?? new Date();
  const shadow = runShadowPass(evaluatedAt);
  const paper = runPaperPass(evaluatedAt);
  return NextResponse.json({
    ...shadow,
    paper,
    mode: asOf ? "REPLAY" : "LIVE",
    evaluatedAsOf: evaluatedAt.toISOString(),
  });
}
