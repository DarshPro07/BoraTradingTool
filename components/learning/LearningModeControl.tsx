"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutationFetch } from "@/lib/client/mutation-fetch";

const MODES = [
  { id: "off", label: "OFF", detail: "Nothing runs autonomously." },
  { id: "observing", label: "OBSERVING", detail: "Reads state and surfaces what is due. Changes nothing." },
  { id: "learning", label: "LEARNING", detail: "Also drains the research queue and extracts knowledge." },
  { id: "evolving", label: "EVOLVING", detail: "Also prepares code and strategy proposals for your review." },
] as const;

export function LearningModeControl({ current }: { current: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<string | null>(null);

  // The owner-token ceremony is gone, deliberately and by instruction. It used to sit here as a
  // form reading "UNLOCK OWNER CONTROLS" and a line promising fifteen minutes of access.
  //
  // It was removed from `requireOwnerMutationAccess` first, and leaving the form behind was the
  // real defect — worse than either state on its own. A control that appears to gate something
  // and gates nothing teaches the operator that the interface's claims are decorative, which is
  // the opposite of what every refusal message in this system is trying to establish.
  //
  // What still holds, and is asserted in `lib/security/request.test.ts`: the request must be
  // loopback-bound, carry the CSRF header, and present no bearer token. That last one is why an
  // autonomous agent still cannot flip its own mode or relax its own risk ceilings.

  async function setMode(mode: string) {
    setPending(mode);
    setError(null);
    try {
      const response = await mutationFetch("/api/learning", {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Could not switch mode (${response.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the application.");
    } finally {
      setPending(null);
    }
  }

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
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setMode(mode.id)}
            disabled={pending !== null}
            aria-pressed={current === mode.id}
            className={`border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
              current === mode.id ? "border-[var(--amber)] text-amber" : "border-panel hover:border-[var(--amber)]"
            }`}
          >
            <span className="block tracking-wider">{mode.label}</span>
            <span className="block text-[10px] text-muted-foreground mt-0.5">{mode.detail}</span>
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed border border-panel p-2">
        These controls are open to anything running on this machine. Mutations are restricted to
        loopback with a CSRF header, and a bearer token is refused — so the autonomous worker
        cannot change its own mode — but there is no owner password.
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
          Proposals always require your approval, in every mode.
        </span>
      </div>

      {error ? <p className="text-xs text-loss">{error}</p> : null}
      {cycle ? <p className="text-xs text-muted-foreground leading-relaxed">{cycle}</p> : null}
    </div>
  );
}
