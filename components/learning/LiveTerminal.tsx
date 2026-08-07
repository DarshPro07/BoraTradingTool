"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Everything the autonomous loop did, as a log you can watch.
 *
 * The complaint this answers, verbatim: *"i also do not trust that this learning mode is working
 * or not"*. That doubt was rational. The loop reported itself in one sentence of prose, with no
 * timestamp, no duration and no names — and a summary nobody can check is indistinguishable from
 * a summary that was made up.
 *
 * So this shows the parts a claim can be verified against: when it ran, which driver ran it, how
 * long it took, and every action and refusal in full. Nothing here is generated for display —
 * each line is a row already written to `audit_events` by the cycle itself.
 */

interface Run {
  id: number;
  ranAt: string;
  mode: string;
  driver: string;
  durationMs: number;
  actions: string[];
  skipped: string[];
  rehearsed: number;
  wouldPass: number;
  findings: number;
  jobsProcessed: number;
}

interface Pulse {
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  runsToday: number;
  stalled: boolean;
  lastMode: string | null;
}

const POLL_MS = 10_000;

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "--:--:--" : at.toLocaleTimeString([], { hour12: false });
}

function driverLabel(driver: string): string {
  if (driver === "scheduler") return "scheduler";
  if (driver === "daemon") return "daemon";
  if (driver === "unknown") return "unrecorded";
  return "browser";
}

export function LiveTerminal() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [excluded, setExcluded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/cycles?limit=50", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.message ?? `The run log returned ${response.status}.`);
        return;
      }
      setRuns(body.runs as Run[]);
      setPulse(body.pulse as Pulse);
      setExcluded(Number(body.excludedFixtures ?? 0));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The run log is unreachable.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Only auto-scroll while the operator is at the bottom. Yanking the view down mid-read is how
  // a live log becomes unreadable exactly when something interesting appears.
  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: "end" });
  }, [runs, follow]);

  return (
    <section className="terminal-panel" data-testid="live-terminal">
      <div className="panel-heading flex items-center justify-between gap-2">
        <span>AUTONOMY — LIVE</span>
        <span className="flex items-center gap-2 text-[10px] normal-case tracking-normal">
          {pulse ? (
            <span className={pulse.stalled ? "text-loss" : pulse.lastRunAt ? "text-gain" : "text-amber"}>
              {pulse.lastRunAt === null
                ? "never run"
                : pulse.stalled
                  ? `stalled ${Math.floor(pulse.minutesSinceLastRun ?? 0)}m`
                  : `${pulse.runsToday} today`}
            </span>
          ) : null}
          <label className="flex items-center gap-1 text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
            follow
          </label>
        </span>
      </div>

      <div className="p-3 font-mono text-[11px] leading-relaxed max-h-[28rem] overflow-y-auto">
        {error ? (
          <p className="text-loss">
            {/* Not an empty box. "No cycles" and "the log could not be read" are opposite facts. */}
            run log unavailable — {error}
          </p>
        ) : runs === null ? (
          <p className="text-muted-foreground">reading run log…</p>
        ) : runs.length === 0 ? (
          <p className="text-amber">
            No cycle has ever run. This is not a stalled loop — it is one that was never started.
            Set a learning mode, then run a cycle or register the scheduler.
          </p>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="mb-2">
              <div className="text-muted-foreground">
                <span className="text-terminal">{clock(run.ranAt)}</span>{" "}
                <span className="text-amber">{run.mode}</span>{" "}
                <span>({driverLabel(run.driver)})</span>{" "}
                <span>{(run.durationMs / 1000).toFixed(1)}s</span>
                {run.rehearsed > 0 ? <span> · {run.rehearsed} rehearsed</span> : null}
                {run.wouldPass > 0 ? <span className="text-gain"> · {run.wouldPass} would pass</span> : null}
                {run.findings > 0 ? <span className="text-amber"> · {run.findings} need attention</span> : null}
                {run.jobsProcessed > 0 ? <span> · {run.jobsProcessed} jobs</span> : null}
              </div>
              {run.actions.map((action, index) => (
                <div key={`a${index}`} className="pl-4">
                  <span className="text-gain">+</span> {action}
                </div>
              ))}
              {/* Refusals shown in full, not summarised. A skipped step is the loop explaining
                  what it declined to guess, which is the most trustworthy thing it prints. */}
              {run.skipped.map((skipped, index) => (
                <div key={`s${index}`} className="pl-4 text-muted-foreground">
                  <span className="text-amber">~</span> {skipped}
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {excluded > 0 ? (
        <p className="border-t border-panel px-3 py-1.5 text-[10px] text-muted-foreground">
          {excluded} cycle row(s) written by a test process are hidden. The audit log is append-only by database
          trigger, so they cannot be deleted — only excluded here.
        </p>
      ) : null}
    </section>
  );
}
