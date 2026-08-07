import { NextResponse } from "next/server";
import { requireOwnerMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { getLearningMode, setLearningMode } from "@/lib/governance/runtime";
import { AUTONOMOUS_PERMITTED, AUTONOMOUS_PROHIBITED } from "@/lib/governance/policy";
import { masteryByPlane, nextCurriculum } from "@/lib/learning/curriculum";
import { proposalStats } from "@/lib/learning/evolution";
import { queueStats } from "@/lib/research/queue";

export const dynamic = "force-dynamic";

const MODES = ["off", "observing", "learning", "evolving"] as const;

export async function GET() {
  const mode = getLearningMode();
  return NextResponse.json(
    {
      mode,
      modes: MODES,
      permitted: AUTONOMOUS_PERMITTED.map((action) => ({
        id: action.id,
        summary: action.summary,
        minimumMode: action.minimumMode,
        enabled: MODES.indexOf(mode) >= MODES.indexOf(action.minimumMode),
      })),
      // Always shown, never conditional: these are the things the system may never do.
      prohibited: AUTONOMOUS_PROHIBITED.map((action) => ({ id: action.id, reason: action.reason })),
      curriculum: nextCurriculum(undefined, 5),
      mastery: masteryByPlane(),
      proposals: proposalStats(),
      queue: queueStats(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PATCH(req: Request) {
  const denied = requireOwnerMutationAccess(req);
  if (denied) return denied;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  const mode = (parsed.value as { mode?: unknown }).mode;
  if (typeof mode !== "string" || !(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json(
      { error: "INVALID_MODE", message: `mode must be one of: ${MODES.join(", ")}` },
      { status: 400 },
    );
  }

  setLearningMode(mode as (typeof MODES)[number], "owner");
  return NextResponse.json({ mode: getLearningMode() });
}
