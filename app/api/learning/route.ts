import { NextResponse } from "next/server";
import { requireOwnerMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { getLearningMode, setLearningMode } from "@/lib/governance/runtime";
import { AUTONOMOUS_PERMITTED, AUTONOMOUS_PROHIBITED } from "@/lib/governance/policy";
import { masteryByPlane, nextCurriculum } from "@/lib/learning/curriculum";
import { proposalStats } from "@/lib/learning/evolution";
import { queueStats } from "@/lib/research/queue";

export const dynamic = "force-dynamic";

/**
 * What the RUNTIME actually distinguishes. `getLearningMode()` (lib/governance/runtime.ts) coerces
 * every stored value except "off" to "evolving", so the machine has one top-level RUN state, not
 * four tiers — Observe/Learn/Evolve are concurrent lanes under it, not modes to switch between.
 * This response reports that truth rather than advertising four co-equal selectable modes; the
 * legacy four-value `LearningMode` type and the coercion itself are slated for cleanup in a
 * protected-file change (docs/plans/mode-taxonomy/).
 */
const EFFECTIVE_MODES = ["off", "evolving"] as const;
/** Still ACCEPTED by PATCH for backward compatibility; non-off values are coerced to evolving. */
const ACCEPTED_MODES = ["off", "observing", "learning", "evolving"] as const;

export async function GET() {
  const mode = getLearningMode();
  return NextResponse.json(
    {
      mode,
      /** The single top-level state the UI shows: AUTO is on unless the machine is off. */
      auto: mode !== "off",
      modes: EFFECTIVE_MODES,
      permitted: AUTONOMOUS_PERMITTED.map((action) => ({
        id: action.id,
        summary: action.summary,
        minimumMode: action.minimumMode,
        // Honest under single-AUTO: "evolving" is the top tier and enables every autonomous
        // action; "off" enables none. No middle tier exists to be half-enabled.
        enabled: mode === "evolving",
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
  if (typeof mode !== "string" || !(ACCEPTED_MODES as readonly string[]).includes(mode)) {
    return NextResponse.json(
      { error: "INVALID_MODE", message: `mode must be one of: ${ACCEPTED_MODES.join(", ")}` },
      { status: 400 },
    );
  }

  // A non-off selection is stored and then read back as "evolving" (single AUTO). The response
  // reports the EFFECTIVE mode, so a caller who sends "observing" is told plainly it resolved to
  // "evolving" rather than being led to believe an intermediate tier is in force.
  setLearningMode(mode as (typeof ACCEPTED_MODES)[number], "owner");
  return NextResponse.json({ requested: mode, mode: getLearningMode() });
}
