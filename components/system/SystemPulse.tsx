"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutationFetch } from "@/lib/client/mutation-fetch";

const STATUS_POLL_MS = 30_000;
/**
 * Poll interval once the core has been found unreachable.
 *
 * A quant core that is not installed does not appear between one thirty-second tick and the
 * next, so polling at the healthy rate spends a request every thirty seconds, on every open tab,
 * forever, to re-learn the same answer. Backing off keeps the indicator honest while making the
 * cost proportional to the chance of a change.
 */
const UNREACHABLE_POLL_MS = 300_000;
/** How long the operator must be idle before the system starts working on its own. */
const IDLE_THRESHOLD_MS = 120_000;
/** Floor between autonomous cycles, so an idle tab never becomes a busy loop. */
const MIN_CYCLE_GAP_MS = 300_000;

interface Status {
  learningMode: string;
  quantCore: { reachable: boolean; stale: boolean; transport: string; message?: string | null };
}

type Activity = "idle" | "working" | "off";

export function SystemPulse() {
  const [status, setStatus] = useState<Status | null>(null);
  const [activity, setActivity] = useState<Activity>("off");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const lastInteraction = useRef(Date.now());
  const lastCycle = useRef(0);
  const running = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/quantcore/status", { cache: "no-store" });
      if (!response.ok) return;
      setStatus((await response.json()) as Status);
    } catch {
      // Leave the previous status in place; the page is still usable offline.
    }
  }, []);

  // Track interaction so autonomous work only starts once the operator steps away.
  useEffect(() => {
    const mark = () => {
      lastInteraction.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "visibilitychange"] as const;
    for (const event of events) window.addEventListener(event, mark, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, mark);
    };
  }, []);

  // Keyed on reachability alone, deliberately not on `status`. The effect calls `refreshStatus`
  // on mount, and `refreshStatus` sets `status` — so depending on the whole object would re-arm
  // the effect on every poll and fire another request immediately, which is an infinite loop.
  // A boolean only changes when reachability actually flips.
  const reachable = status?.quantCore.reachable ?? null;
  useEffect(() => {
    void refreshStatus();
    const period = reachable === false ? UNREACHABLE_POLL_MS : STATUS_POLL_MS;
    const timer = setInterval(() => void refreshStatus(), period);
    return () => clearInterval(timer);
  }, [refreshStatus, reachable]);

  useEffect(() => {
    if (!status) return;
    if (status.learningMode === "off") {
      setActivity("off");
      return;
    }

    const tick = async () => {
      if (running.current) return;
      const now = Date.now();
      const idleFor = now - lastInteraction.current;
      if (idleFor < IDLE_THRESHOLD_MS) return;
      if (now - lastCycle.current < MIN_CYCLE_GAP_MS) return;
      if (document.visibilityState === "hidden") return;

      running.current = true;
      lastCycle.current = now;
      setActivity("working");
      try {
        const response = await mutationFetch("/api/learning/cycle", { method: "POST" });
        if (response.ok) {
          const body = (await response.json()) as {
            worker?: { processed: number } | null;
            actions?: string[];
            blockedBy?: { holder: string } | null;
          };
          // A cycle refused by the lease processed nothing *because it never ran*. Reporting that
          // as "nothing queued" would claim the queue was inspected and found empty — and would
          // make a tab that never wins the lease indistinguishable from a system with no work.
          if (body.blockedBy) {
            setLastResult(`${body.blockedBy.holder} is already running one`);
          } else {
            const processed = body.worker?.processed ?? 0;
            setLastResult(
              processed > 0
                ? `processed ${processed} research job${processed === 1 ? "" : "s"}`
                : "nothing queued",
            );
          }
        }
      } catch {
        setLastResult("cycle unreachable");
      } finally {
        running.current = false;
        setActivity("idle");
        void refreshStatus();
      }
    };

    setActivity("idle");
    const timer = setInterval(() => void tick(), 20_000);
    return () => clearInterval(timer);
  }, [status, refreshStatus]);

  // Never render nothing. A status fetch that fails used to remove the only live indicator in
  // the chrome entirely, which reads as a dead page rather than as an unreachable core.
  const core = status?.quantCore;
  const dotClass = !status
    ? "bg-[var(--muted-foreground)] pulse-dim"
    : !core?.reachable
      ? "bg-[var(--red)] pulse-red"
      : core.stale
        ? "bg-[var(--amber)] pulse-amber"
        : "bg-[var(--green)] pulse-live";

  const label = !status
    ? "LINKING"
    : activity === "working"
      ? "WORKING"
      : status.learningMode === "off"
        ? "IDLE"
        : status.learningMode.toUpperCase();

  const title = !status
    ? "Contacting the system status endpoint."
    : activity === "working"
      ? "The system is running a research cycle while you are away."
      : !core?.reachable
        ? `Quant core unreachable. ${core?.message ?? ""}`.trim()
        : status.learningMode === "off"
          ? "Autonomy is off. Enable it under System → Learning."
          : `Autonomy is ${status.learningMode}. Work starts after two minutes idle.${
              lastResult ? ` Last cycle: ${lastResult}.` : ""
            }`;

  return (
    <span className="system-pulse" title={title} aria-live="polite">
      <span className={`system-pulse-dot ${dotClass}`} aria-hidden="true" />
      <span className={activity === "working" ? "text-amber" : "text-muted-foreground"}>{label}</span>
      {activity === "working" ? <span className="working-bar system-pulse-bar" aria-hidden="true" /> : null}
    </span>
  );
}
