"use client";

import { useCallback, useEffect, useState } from "react";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * The one button. Start MarketPulse, then leave.
 *
 * Everything below the governance ceiling runs itself after this: data readiness, scanning,
 * candidate ranking, research, strategy authoring, validation, forward, paper, learning. The owner
 * sets the ceiling rarely and deliberately at `/learning`; this control never touches it.
 *
 * ## Why it polls
 *
 * A supervisor that is working and a supervisor that died look identical on a page that never
 * re-renders — which is the exact failure this screen exists to prevent. Polling the status
 * endpoint also RECONCILES a crashed run server-side, so opening `/brain` after a crash corrects a
 * phantom "RUNNING" rather than displaying it indefinitely.
 */

interface RunView {
  id: string;
  status: string;
  runtimeProfile: string;
  governanceCeiling: string;
  marketMode: string;
  nextAction: string | null;
  lastCheckpoint: string | null;
  reason: string | null;
  ticks: number;
  startedAt: string;
  heartbeatAt: string;
}

interface StatusView {
  running: boolean;
  run: RunView | null;
  last: RunView | null;
  marketMode: string;
  queue: Record<string, number>;
}

const POLL_MS = 5_000;

const TONE: Record<string, string> = {
  RUNNING: "text-gain",
  STARTING: "text-amber",
  DEGRADED: "text-amber",
  STOPPED: "text-muted-foreground",
  CRASHED: "text-loss",
};

function secondsAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function AutonomousControl({ profile }: { profile: string }) {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /**
   * Rendered only after mount. `heartbeat 3s ago` computed on the server and again on the client is
   * a guaranteed hydration mismatch — the same class of defect as the stale-bundle one, except this
   * one would be ours.
   */
  const [now, setNow] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/system/status", { cache: "no-store" });
      if (!response.ok) return;
      setStatus((await response.json()) as StatusView);
      setNow(Date.now());
    } catch {
      // A failed poll is not a failed system; the next tick tries again.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function act(path: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Through the SHARED helper, not a hand-rolled fetch. This control shipped without the CSRF
      // header and was a dead button that every unit test passed — the header is not something each
      // control should be trusted to remember.
      const response = await mutationFetch(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!response.ok && response.status !== 404) {
        const detail = (await response.json().catch(() => ({}))) as { message?: string };
        setError(detail.message ?? `Request failed (${response.status}).`);
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const run = status?.run ?? null;
  const running = status?.running === true;
  const shown = run ?? status?.last ?? null;

  return (
    <div className="p-3 space-y-3 font-mono text-[11px]" data-testid="autonomous-control">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void act("/api/system/start", { runtimeProfile: profile })}
          disabled={busy || running}
          aria-disabled={busy || running}
          data-testid="start-marketpulse"
          className="px-4 py-2 font-bold border border-current text-gain disabled:opacity-40"
        >
          {running ? "MARKETPULSE RUNNING" : busy ? "STARTING..." : "START MARKETPULSE"}
        </button>

        {running ? (
          <button
            type="button"
            onClick={() => void act("/api/system/stop", { reason: "Stopped from /brain." })}
            disabled={busy}
            data-testid="stop-marketpulse"
            className="px-3 py-2 border border-current text-muted-foreground"
          >
            STOP
          </button>
        ) : null}

        <span data-testid="system-status" className={TONE[shown?.status ?? ""] ?? "text-muted-foreground"}>
          {status === null ? "CHECKING..." : shown ? shown.status : "NEVER STARTED"}
        </span>

        {/* A run that never existed and a run that stopped an hour ago call for different actions. */}
        {!running && status?.last ? (
          <span className="text-muted-foreground">
            last run {now === null ? "" : secondsAgo(status.last.startedAt, now)}
          </span>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="text-loss">
          {error}
        </div>
      ) : null}

      {shown ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="RUN">{shown.id}</Field>
          <Field label="MARKET MODE">{shown.marketMode}</Field>
          <Field label="CEILING">{shown.governanceCeiling} — set by the owner, never by the machine</Field>
          <Field label="PROFILE">{shown.runtimeProfile}</Field>
          <Field label="TICKS">{shown.ticks}</Field>
          <Field label="HEARTBEAT">
            {now === null || !running ? "—" : secondsAgo(shown.heartbeatAt, now)}
          </Field>
          <Field label="QUEUE">
            {status
              ? Object.entries(status.queue)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(" ")
              : "—"}
          </Field>
          <Field label="CHECKPOINT">{shown.lastCheckpoint ?? "—"}</Field>
        </div>
      ) : null}

      <div data-testid="next-action" className="text-muted-foreground">
        {running
          ? `NEXT ACTION — ${shown?.nextAction ?? "…"}`
          : "Press Start once. Everything beneath the governance ceiling then runs without further clicks."}
      </div>

      {shown?.reason ? (
        <div className="text-amber" data-testid="system-reason">
          {shown.reason}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className="break-all">{children}</div>
    </div>
  );
}
