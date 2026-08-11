import { NextResponse } from "next/server";
import { liveRun, lastRun, marketModeNow, STALE_MS } from "@/lib/runtime/supervisor";
import { queueStats } from "@/lib/research/queue";

export const dynamic = "force-dynamic";

/**
 * What the machine is doing right now.
 *
 * Reading this RECONCILES stale runs as a side effect (`liveRun`), which is deliberate: the owner
 * opening `/brain` after a crash is exactly the moment a phantom "RUNNING" must be corrected. A
 * status endpoint that only reports would leave the lie on screen until something else happened to
 * write.
 *
 * `running: false` with a `last` run is a different state from `running: false` with none, and the
 * UI must be able to tell them apart — "stopped an hour ago" and "never started" call for different
 * actions.
 */
export async function GET() {
  const run = liveRun();
  const previous = run ? null : lastRun();

  return NextResponse.json({
    running: run !== null,
    run,
    last: previous,
    marketMode: marketModeNow(),
    queue: queueStats(),
    staleAfterMs: STALE_MS,
  });
}
