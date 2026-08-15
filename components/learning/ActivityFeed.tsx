import { recentCycleRuns, type CycleRunRecord } from "@/lib/learning/run-log";
import { StateBody } from "@/components/system/PanelState";

/**
 * What the system did while you were away.
 *
 * This is the answer to the complaint that autonomy was invisible. It reads the durable cycle
 * log, so it survives a reload and shows a history rather than the current render's state — a
 * feed built from component state would go blank on refresh and look exactly like a loop that
 * had never run.
 */

function clock(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(at: Date, now: Date): string {
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return "";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return at.toDateString() === yesterday.toDateString() ? "yesterday " : `${at.toISOString().slice(5, 10)} `;
}

/** One line per thing the cycle actually did, so a busy pass and an idle one look different. */
function lines(run: CycleRunRecord): { text: string; tone: string }[] {
  const rows = run.actions.map((text) => ({ text, tone: "" }));
  for (const text of run.skipped) rows.push({ text, tone: "text-muted-foreground" });
  return rows;
}

export function ActivityFeed({ limit = 12, now = new Date() }: { limit?: number; now?: Date }) {
  const runs = recentCycleRuns(limit);

  if (runs.length === 0) {
    return (
      <StateBody
        state="empty"
        reason="The autonomous loop has not run yet. Set a mode above off, then run a cycle — this feed records every pass, so an empty feed means none has happened rather than that none was recorded."
      />
    );
  }

  return (
    <ol className="space-y-2 text-xs" data-testid="activity-feed">
      {runs.map((run) => (
        <li key={run.id} className="border-l-2 border-panel pl-3 py-0.5 rise-1" data-testid="activity-run">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-terminal tabular-nums">
              {dayLabel(run.ranAt, now)}
              {clock(run.ranAt)}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{run.mode}</span>
            {run.durationMs > 0 ? (
              <span className="text-[10px] text-muted-foreground">{(run.durationMs / 1000).toFixed(1)}s</span>
            ) : null}
            {run.rediscovered > 0 ? (
              <span className="text-[10px] text-amber">{run.rediscovered} rediscovered</span>
            ) : null}
            {run.wouldPass > 0 ? (
              <span className="text-[10px] text-gain">{run.wouldPass} would pass</span>
            ) : null}
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {lines(run).map((line, index) => (
              // Observation lines quote STRATEGY IDS verbatim, and an authored id runs to ~55
              // unbroken characters (`gap_and_volume_screen_desktop_chromium_mstgkd94_ab3b77c3`).
              // With nothing to break on, one such line pushed the whole cockpit sideways on a
              // phone — the id has to wrap, because truncating it would hide which strategy the
              // machine is talking about.
              <li key={index} className={`text-[11px] leading-relaxed [overflow-wrap:anywhere] ${line.tone}`}>
                {line.text}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
