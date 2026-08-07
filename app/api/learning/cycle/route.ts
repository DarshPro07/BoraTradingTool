import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { runLearningCycle } from "@/lib/learning/cycle";

export const dynamic = "force-dynamic";

/** Runs one learning-mode iteration. Safe to schedule; the mode decides how much happens. */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return NextResponse.json(await runLearningCycle(`http-${process.pid}`));
}
