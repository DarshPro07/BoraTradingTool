"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play, Loader2 } from "lucide-react";

/**
 * Run one autonomous cycle now.
 *
 * Exists because "wait up to fifteen minutes to find out whether autonomy works" is not a
 * testable proposition. The mutation route is loopback-only and requires the CSRF header, so
 * this is the same call an operator would make from a terminal — not a privileged shortcut.
 */
export function RunCycleButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/learning/cycle", {
        method: "POST",
        headers: { "x-marketpulse-csrf": "1" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // A refusal is information: mode off, wrong origin, missing token. Show which.
        setError(body?.title ?? body?.detail ?? `Refused with ${res.status}.`);
        return;
      }
      // The feed and the strip are server-rendered from the durable log, so a refresh is what
      // makes the new run appear — not local state, which would disagree with the log.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={running}
        data-testid="run-cycle"
        className="inline-flex items-center gap-1.5 border border-panel bg-panel-alt px-3 py-1 text-[11px] uppercase tracking-wider hover:border-terminal hover:text-terminal transition-colors disabled:opacity-60"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
        {running ? "Running" : "Run cycle now"}
      </button>
      {error ? (
        <span className="text-[10px] text-loss" data-testid="run-cycle-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
