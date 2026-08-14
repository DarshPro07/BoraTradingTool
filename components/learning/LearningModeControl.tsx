"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutationFetch } from "@/lib/client/mutation-fetch";

const LANES = [
  { id: "observation", label: "Observation", activeInRun: true },
  { id: "learning", label: "Learning", activeInRun: true },
  { id: "evolution", label: "Evolution", activeInRun: true },
  { id: "research", label: "Research", activeInRun: false },
  { id: "scanner", label: "Scanner", activeInRun: false },
  { id: "strategy", label: "Strategy", activeInRun: false },
  { id: "validation", label: "Validation", activeInRun: false },
  { id: "forward", label: "Forward", activeInRun: false },
  { id: "paper", label: "Paper", activeInRun: false },
  { id: "self-development", label: "SelfDevelopment", activeInRun: false },
] as const;

export function LearningModeControl({ current }: { current: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<string | null>(null);
  const runActive = current !== "off";

  async function runCycle() {
    setPending("cycle");
    setError(null);
    setCycle(null);
    try {
      const response = await mutationFetch("/api/learning/cycle", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        actions?: string[];
        skipped?: string[];
        worker?: { processed: number } | null;
      };
      if (!response.ok) {
        setError("The cycle did not complete.");
        return;
      }
      setCycle(
        [
          body.worker ? `Processed ${body.worker.processed} job(s).` : "No jobs processed.",
          ...(body.actions ?? []),
          ...(body.skipped ?? []),
        ].join(" "),
      );
      router.refresh();
    } catch {
      setError("Could not reach the application.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="border border-panel p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs tracking-wider">AUTO — {runActive ? "RUNNING" : "MAINTENANCE"}</span>
          <span className={runActive ? "text-xs text-gain" : "text-xs text-amber"}>{runActive ? "RUN" : "OFF"}</span>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
          No owner token is required for routine local operation. Mutations remain restricted to loopback,
          same-origin requests with the local session cookie and mutation header.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {LANES.map((lane) => {
          const state = !runActive ? "IDLE" : lane.activeInRun ? "ACTIVE" : "WAITING";
          return (
            <div key={lane.id} className="border border-panel px-3 py-2 text-xs">
              <span className="block tracking-wider">{lane.label}</span>
              <span className={state === "ACTIVE" ? "text-gain" : "text-muted-foreground"}>{state}</span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed border border-panel p-2">
        RUN is a single top-level mode. Observation, Learning and Evolution are concurrent lanes;
        market-priority lanes activate when there is queued work, data, or a scheduled cycle.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runCycle}
          disabled={pending !== null}
          className="border border-panel px-3 py-1.5 text-xs hover:border-[var(--amber)] disabled:opacity-50"
        >
          {pending === "cycle" ? "RUNNING…" : "RUN ONE CYCLE"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          Proposal approval still requires independent authority; token prompts are not the safety boundary.
        </span>
      </div>

      {error ? <p className="text-xs text-loss">{error}</p> : null}
      {cycle ? <p className="text-xs text-muted-foreground leading-relaxed">{cycle}</p> : null}
    </div>
  );
}
