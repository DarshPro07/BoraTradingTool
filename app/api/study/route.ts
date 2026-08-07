import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { gradeStudyAnswer, nextStudyCard } from "@/lib/learning/study";

export const dynamic = "force-dynamic";

/**
 * The study session endpoint.
 *
 * It lives at `app/api/study/` rather than under `app/api/learning/`, which is owner-reviewed
 * because that path carries authority over learning *mode*. Answering a flashcard exercises no
 * such authority — it writes one row of the owner's own study history — and folding it in there
 * would have meant editing a protected path to add a feature that needs none of its power.
 */

export async function GET() {
  const card = nextStudyCard();
  return NextResponse.json(
    // Null is the honest shape for "nothing is due": an empty card object would render as a blank
    // question, which reads as a broken screen rather than a finished queue.
    { card },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value as { conceptId?: unknown; answer?: unknown; recalled?: unknown };
  if (typeof body.conceptId !== "string" || body.conceptId.trim().length === 0) {
    return NextResponse.json(
      { error: "INVALID_CONCEPT", message: "conceptId is required." },
      { status: 400 },
    );
  }

  const outcome = gradeStudyAnswer({
    conceptId: body.conceptId,
    answer: typeof body.answer === "string" ? body.answer : undefined,
    recalled: typeof body.recalled === "boolean" ? body.recalled : undefined,
  });

  if (!outcome.ok) {
    const status = outcome.error === "UNKNOWN_CONCEPT" ? 404 : 400;
    const message =
      outcome.error === "UNKNOWN_CONCEPT"
        ? "No such concept. Mastery was not recorded."
        : outcome.error === "NOT_GRADEABLE"
          ? "That concept has no multiple-choice question, so an answer cannot be graded. Send `recalled` instead."
          : "Send either `answer` (multiple choice) or `recalled` (self-report).";
    return NextResponse.json({ error: outcome.error, message }, { status });
  }

  return NextResponse.json({
    ...outcome.result,
    // The next card comes back with the grade so the panel never has to round-trip twice, and so
    // a session that has just emptied the queue says so immediately.
    next: nextStudyCard(),
  });
}
