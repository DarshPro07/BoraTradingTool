import Link from "next/link";
import { autonomyPulse, lastCycleRun, STALL_AFTER_MINUTES } from "@/lib/learning/run-log";
import { getLearningMode } from "@/lib/governance/runtime";

/**
 * The line that answers "is it actually doing anything?"
 *
 * A badge reading `LEARNING` looks identical whether the loop has run a hundred times or has
 * never started. This shows the mode *and* the age of the last cycle *and* what that cycle did,
 * so a stopped loop is visibly stopped rather than quietly indistinguishable from a busy one.
 */

/**
 * Name the driver in words the owner can act on.
 *
 * "this tab" is the one that matters: it means autonomy stops the moment the browser closes, so
 * a run log that looks healthy right now will simply end. The scheduler survives a reboot; the
 * daemon does not. Rendering the raw worker id would leave that distinction unread.
 */
function driverLabel(driver: string): string {
  if (driver === "scheduler") return "scheduler";
  if (driver === "daemon") return "daemon (stops on reboot)";
  if (driver === "unknown") return "driver unrecorded";
  return "this tab";
}

function ago(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AutonomyStrip() {
  // This component lives in the root layout, so anything it throws takes down **every page**.
  //
  // That is exactly what happened when better-sqlite3's native addon was missing: a single
  // unbuilt binary turned "the autonomy strip cannot read its log" into "the entire application
  // returns 500", including screens that need no database at all. The blast radius of a layout
  // component is the whole site, so it degrades rather than throws.
  let mode = "unknown";
  let pulse: ReturnType<typeof autonomyPulse> | null = null;
  let last: ReturnType<typeof lastCycleRun> = null;
  let unavailable: string | null = null;

  try {
    mode = getLearningMode();
    pulse = autonomyPulse();
    last = lastCycleRun();
  } catch (caught) {
    unavailable = caught instanceof Error ? caught.message.split("\n")[0] : "The local database is unavailable.";
  }

  if (unavailable !== null || pulse === null) {
    return (
      <div className="autonomy-strip" data-testid="autonomy-strip" data-mode="unavailable">
        <span className="autonomy-dot" />
        <span className="text-loss" data-testid="autonomy-mode">
          UNAVAILABLE
        </span>
        <span className="autonomy-sep" aria-hidden="true">
          ·
        </span>
        {/* Named, not hidden. "Autonomy state unknown" and "autonomy is off" are opposite
            facts, and a strip that silently showed OFF here would be the worst of both. */}
        <span className="text-muted-foreground" data-testid="autonomy-unavailable">
          Autonomy state cannot be read — the local database did not open. This is not the same
          as autonomy being off.
        </span>
        <span className="autonomy-spacer" />
        <Link href="/data-quality" className="text-terminal text-[10px] uppercase tracking-wider">
          Diagnose →
        </Link>
      </div>
    );
  }

  const displayMode = mode === "off" ? "MAINTENANCE" : "RUN";
  const tone: string =
    mode === "off"
      ? "text-muted-foreground"
      : pulse.stalled
        ? "text-loss"
        : pulse.lastRunAt
          ? "text-gain"
          : "text-amber";

  return (
    <div className="autonomy-strip" data-testid="autonomy-strip" data-mode={mode === "off" ? "maintenance" : "run"}>
      <Link href="/learning" className="autonomy-mode" title="AUTO runtime lanes and recent cycle evidence">
        <span className={`autonomy-dot ${mode !== "off" && !pulse.stalled ? "autonomy-dot-live" : ""}`} />
        <span className={tone} data-testid="autonomy-mode">
          {displayMode}
        </span>
      </Link>

      <span className="autonomy-sep" aria-hidden="true">
        ·
      </span>

      <span data-testid="autonomy-last">
        {pulse.lastRunAt === null ? (
          // Never run is not the same as stalled, and must not be reported as one.
          <span className="text-amber">never run</span>
        ) : pulse.stalled ? (
          <span className="text-loss">
            stalled — last cycle {ago(pulse.minutesSinceLastRun ?? 0)} (over {STALL_AFTER_MINUTES}m)
            {last ? ` · ${driverLabel(last.driver)}` : ""}
          </span>
        ) : (
          <span>
            last cycle {ago(pulse.minutesSinceLastRun ?? 0)}
            {last ? ` · ${driverLabel(last.driver)}` : ""}
          </span>
        )}
      </span>

      {last ? (
        <>
          <span className="autonomy-sep" aria-hidden="true">
            ·
          </span>
          <span className="text-muted-foreground" data-testid="autonomy-detail">
            {last.actions.length} action{last.actions.length === 1 ? "" : "s"}
            {last.rehearsed > 0 ? ` · ${last.rehearsed} rehearsed` : ""}
            {last.wouldPass > 0 ? ` · ${last.wouldPass} would pass` : ""}
            {last.findings > 0 ? ` · ${last.findings} need attention` : ""}
            {last.durationMs > 0 ? ` · ${(last.durationMs / 1000).toFixed(1)}s` : ""}
          </span>
        </>
      ) : null}

      <span className="autonomy-spacer" />

      <span className="text-muted-foreground" data-testid="autonomy-today">
        {pulse.runsToday} cycle{pulse.runsToday === 1 ? "" : "s"} today
      </span>
    </div>
  );
}
