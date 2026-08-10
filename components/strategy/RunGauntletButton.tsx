"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";

/**
 * Spend a trial on one strategy.
 *
 * `runGauntlet` was fully implemented and thoroughly tested, then reachable only from the test
 * suite. A route was added later, and still nothing in the interface called it — so the most
 * consequential action in the system had no path from the application, and the validation funnel
 * could never show anything but zero. Five draft strategies and an empty graveyard were not a
 * measurement; they were the absence of one.
 *
 * ## Why two clicks
 *
 * This is irreversible. The evaluation is counted against the strategy's **family**, so it
 * permanently raises the bar every future candidate in that family must clear — `sma_cross_20_50`
 * and `sma_cross_10_30` are one search, and counting them separately is what defeats a
 * multiple-testing correction. A single click on a row in a table is not consent to that.
 *
 * The confirmation states the cost in the same words the route uses, so the interface cannot
 * quietly promise less than the server charges.
 */

interface Outcome {
  passed: boolean;
  summary: string;
  trialsCounted: number;
  trades: number;
  instrumentsEvaluated: number;
  /** 13b: the exact dataset the verdict was computed on. */
  datasetSnapshotId: string | null;
  datasetFingerprint: string | null;
}

export function RunGauntletButton({ specId, name }: { specId: string; name: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirming" | "running">("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run() {
    setState("running");
    setError(null);
    try {
      const response = await fetch("/api/strategy/gauntlet", {
        method: "POST",
        headers: { "content-type": "application/json", "x-marketpulse-csrf": "1" },
        body: JSON.stringify({ specId, confirm: true }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // A refusal is information, and each code means something different. Collapsing them into
        // "failed" would hide the one case that costs nothing: 503 means no candles were
        // available, so the holdout budget was never touched and nothing was spent.
        setError(body?.message ?? `Refused with ${response.status}.`);
        return;
      }

      setOutcome({
        passed: Boolean(body?.passed),
        summary: String(body?.summary ?? ""),
        trialsCounted: Number(body?.trialsCounted ?? 0),
        trades: Number(body?.trades ?? 0),
        instrumentsEvaluated: Number(body?.instrumentsEvaluated ?? 0),
        datasetSnapshotId: typeof body?.datasetSnapshotId === "string" ? body.datasetSnapshotId : null,
        datasetFingerprint: typeof body?.datasetFingerprint === "string" ? body.datasetFingerprint : null,
      });
      // The registry, funnel and graveyard are server-rendered from the trial ledger. Refresh is
      // what makes the result real on screen; local state would be a second, disagreeing copy.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setState("idle");
    }
  }

  if (outcome) {
    return (
      <div className="text-[10px] leading-relaxed" data-testid="gauntlet-outcome">
        {/* A burial is a result, not a failure of the run. The system exists to bury its own
            ideas, and phrasing this as an error would train the operator to avoid the button. */}
        <span className={outcome.passed ? "text-gain" : "text-amber"}>
          {outcome.passed ? "SURVIVED" : "BURIED"}
        </span>
        <span className="text-muted-foreground">
          {" · "}
          {outcome.trades} trades / {outcome.instrumentsEvaluated} instruments · {outcome.trialsCounted} trial
          {outcome.trialsCounted === 1 ? "" : "s"} counted
        </span>
        {outcome.summary ? <div className="text-muted-foreground mt-0.5">{outcome.summary}</div> : null}
        {outcome.datasetSnapshotId ? (
          <div className="text-muted-foreground mt-0.5" data-testid="gauntlet-provenance">
            dataset {outcome.datasetSnapshotId}
            {outcome.datasetFingerprint ? ` · fp ${outcome.datasetFingerprint.slice(0, 12)}` : ""} — the verdict is
            pinned to these exact bars
          </div>
        ) : null}
      </div>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex flex-col items-start gap-1">
        <p className="text-[10px] text-amber leading-relaxed max-w-[22rem]">
          This counts a trial against {name}&apos;s family and permanently raises the bar every future
          candidate in it must clear. It does not touch the sealed holdout.
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={run}
            data-testid="gauntlet-confirm"
            className="border border-loss px-2 py-0.5 text-[10px] uppercase tracking-wider text-loss hover:bg-loss/10 transition-colors"
          >
            Spend a trial
          </button>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="border border-panel px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-terminal transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setState("confirming")}
        disabled={state === "running"}
        data-testid="run-gauntlet"
        className="inline-flex items-center gap-1.5 border border-panel px-2 py-0.5 text-[10px] uppercase tracking-wider hover:border-terminal hover:text-terminal transition-colors disabled:opacity-60"
      >
        {state === "running" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <FlaskConical className="w-3 h-3" />
        )}
        {state === "running" ? "Running" : "Run gauntlet"}
      </button>
      {error ? (
        <span className="text-[10px] text-loss max-w-[22rem] leading-relaxed" data-testid="gauntlet-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
