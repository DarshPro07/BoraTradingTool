import { NextResponse } from "next/server";
import { autonomyPulse, excludedFixtureCount, recentCycleRuns } from "@/lib/learning/run-log";

export const dynamic = "force-dynamic";

/**
 * The autonomous run log, for the live terminal.
 *
 * Read-only and deliberately unauthenticated: it exposes what the system already prints in the
 * chrome, and the complaint it answers is precisely that the loop is unverifiable. Putting the
 * evidence behind the same gate as the *controls* would preserve the problem it exists to solve.
 *
 * It lives here rather than under `app/api/learning/`, which is owner-reviewed because that path
 * holds authority over learning mode. Reading a log is not an exercise of that authority.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 30;

  try {
    const runs = recentCycleRuns(limit);
    const pulse = autonomyPulse();
    return NextResponse.json({
      // Cycle rows written by a test process, excluded from the feed above. `audit_events` is
      // append-only by trigger, so these cannot be removed — reporting the number is the only
      // alternative to dropping them silently, and a log that hides rows without saying so is
      // exactly as untrustworthy as one full of fabrications.
      excludedFixtures: excludedFixtureCount(),
      pulse: {
        lastRunAt: pulse.lastRunAt?.toISOString() ?? null,
        minutesSinceLastRun: pulse.minutesSinceLastRun,
        runsToday: pulse.runsToday,
        stalled: pulse.stalled,
        lastMode: pulse.lastMode,
      },
      // Oldest first, so the terminal reads top-to-bottom like a log rather than newest-first
      // like a feed. A terminal that scrolls backwards is a terminal nobody can follow.
      runs: runs
        .slice()
        .reverse()
        .map((run) => ({
          id: run.id,
          ranAt: run.ranAt.toISOString(),
          mode: run.mode,
          driver: run.driver,
          durationMs: run.durationMs,
          actions: run.actions,
          skipped: run.skipped,
          rehearsed: run.rehearsed,
          wouldPass: run.wouldPass,
          rediscovered: run.rediscovered,
          findings: run.findings,
          jobsProcessed: run.jobsProcessed,
        })),
    });
  } catch (caught) {
    // The terminal must render an explanation rather than an empty box. "No cycles" and "the log
    // could not be read" are opposite facts and must never look alike.
    return NextResponse.json(
      {
        error: "RUN_LOG_UNAVAILABLE",
        message: caught instanceof Error ? caught.message.split("\n")[0] : "The run log could not be read.",
      },
      { status: 503 },
    );
  }
}
