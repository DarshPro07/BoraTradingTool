"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/system/Panel";
import { HypothesisComposer, type ComposeResult } from "@/components/research/HypothesisComposer";
import { RunGauntletButton } from "@/components/strategy/RunGauntletButton";
import { RunCycleButton } from "@/components/learning/RunCycleButton";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * The Strategy Factory as ONE flow (mission P3).
 *
 * Every capability here existed before this component — the professor triage, the free ledger
 * backtest, the two-click gauntlet, the forward/paper stage. What did not exist was the journey:
 * they were four unconnected panels, and a person who does not know the pipeline could not tell
 * that they are one pipeline. This component adds NO new capability; it sequences the existing
 * ones and keeps every refusal on screen as a stated step outcome.
 *
 * Two entrances, per the owner's directive:
 *   A. BUILD MY IDEA — prose in, then interpretation, backtest, validation, forward.
 *   B. FIND A STRATEGY FOR ME — the autonomous side made visible: what the learning cycle
 *      triaged, bred, rehearsed and buried, with a button to run one cycle now.
 */

interface BacktestReport {
  ok: boolean;
  specName?: string;
  summary?: string;
  servedFrom?: "ledger" | "fresh";
  trades?: unknown[];
  provenance?: {
    datasetSnapshotId: string;
    barCount: number | null;
    instruments: number | null;
    engineVersion: string;
    note: string;
  } | null;
  error?: string;
  message?: string;
}

interface CycleRun {
  ranAt: string;
  mode: string;
  rehearsed: number;
  wouldPass: number;
  rediscovered: number;
  findings: number;
  actions: string[];
}

interface DiscoverState {
  pulse: { lastRunAt: string | null; runsToday: number; stalled: boolean; lastMode: string | null } | null;
  latest: CycleRun | null;
  held: { id: string; title: string; status: string }[];
  authored: number;
  error: string | null;
}

type StepState = "done" | "active" | "waiting" | "held";

function StepMarker({ n, label, state }: { n: number; label: string; state: StepState }) {
  const tone =
    state === "done"
      ? "text-gain border-gain/50"
      : state === "active"
        ? "text-terminal border-terminal"
        : state === "held"
          ? "text-amber border-amber/50"
          : "text-muted-foreground border-panel";
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`} data-testid={`factory-step-${n}`}>
      <span>{state === "done" ? "✓" : state === "held" ? "◦" : n}</span>
      {label}
    </span>
  );
}

export function GuidedStrategyFlow() {
  const [entrance, setEntrance] = useState<"build" | "discover">("build");
  const [outcome, setOutcome] = useState<ComposeResult | null>(null);
  const [backtest, setBacktest] = useState<BacktestReport | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [discover, setDiscover] = useState<DiscoverState | null>(null);

  const authored = outcome?.ok && outcome.authored ? outcome.authored : null;
  const heldReason = outcome?.ok && !outcome.authored ? outcome.reason ?? "Held without a stated reason." : null;

  const steps: { n: number; label: string; state: StepState }[] = [
    { n: 1, label: "Idea", state: outcome ? "done" : "active" },
    {
      n: 2,
      label: "Interpretation",
      state: !outcome ? "waiting" : authored ? "done" : "held",
    },
    {
      n: 3,
      label: "Backtest (free)",
      state: !authored ? "waiting" : backtest ? "done" : "active",
    },
    {
      n: 4,
      label: "Validate (spends a trial)",
      state: backtest?.ok ? "active" : "waiting",
    },
    { n: 5, label: "Forward & paper", state: backtest?.ok ? "active" : "waiting" },
  ];

  async function runBacktest() {
    if (!authored) return;
    setBacktestBusy(true);
    setBacktest(null);
    try {
      const response = await mutationFetch("/api/strategy/trades", {
        method: "POST",
        body: JSON.stringify({ specId: authored.specId }),
      });
      const body = (await response.json()) as BacktestReport;
      setBacktest({ ...body, ok: response.ok });
    } catch (caught) {
      setBacktest({ ok: false, error: "REQUEST_FAILED", message: caught instanceof Error ? caught.message : "Request failed." });
    } finally {
      setBacktestBusy(false);
    }
  }

  const loadDiscover = useCallback(async () => {
    try {
      const [cyclesResponse, hypothesesResponse] = await Promise.all([
        fetch("/api/cycles?limit=5"),
        fetch("/api/research/hypotheses"),
      ]);
      const cycles = (await cyclesResponse.json()) as {
        pulse?: DiscoverState["pulse"];
        runs?: CycleRun[];
        message?: string;
      };
      const hypotheses = (await hypothesesResponse.json()) as {
        hypotheses?: { id: string; title: string; status: string; strategy: string | null }[];
      };
      const rows = hypotheses.hypotheses ?? [];
      setDiscover({
        pulse: cycles.pulse ?? null,
        // /api/cycles returns oldest-first so a terminal reads downward; the latest is the last.
        latest: cycles.runs && cycles.runs.length > 0 ? cycles.runs[cycles.runs.length - 1] : null,
        held: rows.filter((row) => row.strategy === null).map((row) => ({ id: row.id, title: row.title, status: row.status })),
        authored: rows.filter((row) => row.strategy !== null).length,
        error: cyclesResponse.ok ? null : cycles.message ?? "Run log unavailable.",
      });
    } catch (caught) {
      setDiscover({
        pulse: null,
        latest: null,
        held: [],
        authored: 0,
        error: caught instanceof Error ? caught.message : "Request failed.",
      });
    }
  }, []);

  useEffect(() => {
    if (entrance === "discover" && discover === null) void loadDiscover();
  }, [entrance, discover, loadDiscover]);

  return (
    <Panel title="STRATEGY FACTORY — ONE FLOW, IDEA TO EVIDENCE">
      <div className="p-3 space-y-3" data-testid="factory-flow">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={entrance === "build"}
            onClick={() => setEntrance("build")}
            className={`border px-2.5 py-1 text-[10px] uppercase tracking-wider ${
              entrance === "build" ? "border-terminal text-terminal" : "border-panel text-muted-foreground hover:text-foreground"
            }`}
            data-testid="factory-mode-build"
          >
            Build my idea
          </button>
          <button
            type="button"
            aria-pressed={entrance === "discover"}
            onClick={() => setEntrance("discover")}
            className={`border px-2.5 py-1 text-[10px] uppercase tracking-wider ${
              entrance === "discover" ? "border-terminal text-terminal" : "border-panel text-muted-foreground hover:text-foreground"
            }`}
            data-testid="factory-mode-discover"
          >
            Find a strategy for me
          </button>
        </div>

        {entrance === "build" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5" data-testid="factory-rail">
              {steps.map((step) => (
                <StepMarker key={step.n} {...step} />
              ))}
            </div>

            {/* Step 1-2: the professor. The composer renders the interpretation (YOU SAID →
                INTERPRETED → TESTED) itself; the flow only advances on its outcome. */}
            <HypothesisComposer onOutcome={(result) => { setOutcome(result); setBacktest(null); }} />

            {heldReason ? (
              <div className="border border-amber/40 px-3 py-2 text-[11px] leading-relaxed" data-testid="factory-held">
                <span className="text-amber uppercase tracking-wider text-[10px]">Held — the flow stops here honestly.</span>
                <p className="mt-1 text-muted-foreground">
                  {heldReason} The idea is kept in the hypothesis inbox below with this reason — it
                  is work waiting on something specific, not work lost.
                </p>
              </div>
            ) : null}

            {authored ? (
              <div className="border border-panel px-3 py-2 space-y-2" data-testid="factory-backtest-step">
                <div className="text-[10px] tracking-widest text-muted-foreground">
                  STEP 3 — BACKTEST {authored.name}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={runBacktest}
                    disabled={backtestBusy}
                    className="border border-terminal text-terminal px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-terminal/10 disabled:opacity-50"
                    data-testid="factory-backtest"
                  >
                    {backtestBusy ? "Replaying…" : "Run backtest (free)"}
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    A replay over recorded bars. No trial, no holdout — this can be re-run freely.
                  </span>
                </div>

                {backtest ? (
                  backtest.ok ? (
                    <div className="text-[11px] space-y-1" data-testid="factory-backtest-result">
                      <p>{backtest.summary}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {backtest.trades?.length ?? 0} trade(s) ·{" "}
                        {backtest.servedFrom === "ledger" ? "served from the stored experiment ledger" : "fresh experiment"} · snapshot{" "}
                        {backtest.provenance?.datasetSnapshotId ?? "?"} · {backtest.provenance?.barCount ?? "?"} bars — full
                        per-trade detail (clauses, fees, chart) is in TRADE INSPECTION below.
                      </p>
                    </div>
                  ) : (
                    <div className="text-[11px] border border-amber/40 px-2 py-1.5" data-testid="factory-backtest-result">
                      <span className="text-amber">
                        <strong>{backtest.error}</strong> — {backtest.message}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Nothing was invented to fill the gap. When the named data exists, this step
                        runs — the strategy is saved and loses nothing by waiting.
                      </p>
                    </div>
                  )
                ) : null}
              </div>
            ) : null}

            {backtest?.ok && authored ? (
              <div className="border border-panel px-3 py-2 space-y-2" data-testid="factory-validate">
                <div className="text-[10px] tracking-widest text-muted-foreground">
                  STEP 4 — VALIDATE (THIS ONE COSTS)
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  The gauntlet counts a permanent trial against this idea&apos;s family. Rehearsal in the
                  autonomous cycle answers &quot;is it worth a trial?&quot; for free first.
                </p>
                <RunGauntletButton specId={authored.specId} name={authored.name} />
              </div>
            ) : null}

            {backtest?.ok && authored ? (
              <div className="border border-panel px-3 py-2 space-y-1" data-testid="factory-forward">
                <div className="text-[10px] tracking-widest text-muted-foreground">STEP 5 — FORWARD &amp; PAPER</div>
                <p className="text-[11px] leading-relaxed">
                  After the gauntlet, activate this strategy as a forward challenger on{" "}
                  <Link href="/paper" className="text-terminal">the Paper desk</Link>: it freezes this exact
                  version and records predictions before their outcomes exist — the only unbiased
                  evidence here. REPLAY mode lets you run that validation against any recorded
                  moment, market open or closed.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2 text-[11px]" data-testid="factory-discover">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              At learning mode the cycle does this unattended: triage recorded hypotheses, breed
              candidates from survivors, rehearse them on recorded snapshots for free, and bury
              what fails. Most candidates die — that is the system working. This view reads the
              same durable run log the terminal does.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <RunCycleButton />
              <button
                type="button"
                onClick={() => void loadDiscover()}
                className="border border-panel px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                data-testid="factory-discover-refresh"
              >
                Refresh
              </button>
            </div>

            {discover === null ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : discover.error ? (
              <p className="text-amber" data-testid="factory-discover-error">
                {discover.error} — &quot;no runs&quot; and &quot;the log could not be read&quot; are different facts.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="factory-discover-counts">
                  <div>Held ideas: {discover.held.length}</div>
                  <div>Authored strategies: {discover.authored}</div>
                  <div>Rehearsed last run: {discover.latest?.rehearsed ?? 0}</div>
                  <div>Would pass: {discover.latest?.wouldPass ?? 0}</div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {discover.pulse?.lastRunAt
                    ? `Last cycle ${new Date(discover.pulse.lastRunAt).toLocaleString()} (mode ${discover.pulse.lastMode ?? "?"}, ${discover.pulse.runsToday} today${discover.pulse.stalled ? " — STALLED" : ""}).`
                    : "No autonomous cycle has run in this database yet — press Run cycle now to watch one."}
                </p>
                {discover.held.length > 0 ? (
                  <ul className="space-y-1" data-testid="factory-discover-held">
                    {discover.held.slice(0, 3).map((row) => (
                      <li key={row.id} className="border border-panel/60 px-2 py-1 text-[10px]">
                        <span className="text-amber uppercase tracking-wider mr-2">{row.status}</span>
                        {row.title}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
