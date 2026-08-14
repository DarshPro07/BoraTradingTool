"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * Fires an autonomous cycle on a timer while the app is open.
 *
 * Honest boundary: this is not a durable scheduler. It runs in the browser, so it works while a
 * tab is open and stops when the last one closes. That is genuinely useful — the owner leaves
 * the terminal running and comes back to a populated feed — but a system that must work with no
 * tab open needs an OS-level scheduler calling `POST /api/learning/cycle`, and claiming
 * otherwise would be the kind of overstatement this codebase exists to avoid.
 *
 * The cycle itself decides how much happens; at mode `off` it records a run that did nothing,
 * which is what keeps "disabled" distinguishable from "broken".
 */
export function AutonomyTicker({
  everyMinutes = 15,
  enabled = true,
}: {
  everyMinutes?: number;
  enabled?: boolean;
}) {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const period = Math.max(1, everyMinutes) * 60_000;

    async function tick() {
      // Overlapping cycles would double-drain the research queue and race on the same rows.
      if (running.current || document.hidden) return;
      running.current = true;
      try {
        const res = await mutationFetch("/api/learning/cycle", { method: "POST" });
        if (res.ok) router.refresh();
      } catch {
        // A failed tick is not worth surfacing — the strip already shows the age of the last
        // successful run, which is the fact that matters.
      } finally {
        running.current = false;
      }
    }

    const id = setInterval(tick, period);
    return () => clearInterval(id);
  }, [enabled, everyMinutes, router]);

  return null;
}
