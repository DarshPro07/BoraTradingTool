"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * Author a strategy.
 *
 * Presets rather than a blank editor. A blank DSL editor is a wall: the author has to know the
 * feature names, the operators and the shape before anything can happen, and the first attempt
 * is almost always a schema error. Each preset compiles cleanly and uses only features the
 * engine can actually derive — so the first strategy anyone creates here is one the battery can
 * immediately run on, which is the whole point.
 *
 * The last preset deliberately uses `market_cap`. It compiles, it is a legitimate idea, and it
 * can never be backtested here — and seeing that warning at authoring time is the lesson the
 * two strategies already in the database learned the expensive way.
 */

interface Preset {
  id: string;
  label: string;
  note: string;
  dsl: Record<string, unknown>;
}

const PRESETS: Preset[] = [
  {
    id: "sma_cross",
    label: "SMA crossover",
    note: "Classic trend entry. Every feature derivable — the battery can run this today.",
    dsl: {
      name: "sma_cross_20_50",
      description: "Long when the 20-day mean crosses above the 50-day.",
      universe: { market: "US", maxPositions: 10 },
      entry: { crossover: ["sma20", "sma50"] },
      exit: { afterDays: 20, stopLossPct: 5 },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 5, slippageBps: 5 },
    },
  },
  {
    id: "rsi_reversion",
    label: "RSI mean reversion",
    note: "Buy oversold, exit on time or stop. Tests whether reversion survives costs.",
    dsl: {
      name: "rsi_reversion_30",
      description: "Long when RSI(14) falls below 30.",
      universe: { market: "US", maxPositions: 10 },
      entry: { feature: "rsi14", op: "lt", value: 30 },
      exit: { afterDays: 10, stopLossPct: 6 },
      sizing: { maxPositionPct: 4 },
      costs: { commissionBps: 5, slippageBps: 8 },
    },
  },
  {
    id: "gap_momentum",
    label: "Gap momentum (NSE)",
    note: "Overnight gap plus relative volume, on the Indian market.",
    dsl: {
      name: "gap_momentum_nse",
      description: "Long a gap up on elevated relative volume.",
      universe: { market: "NSE", maxPositions: 8 },
      entry: {
        all: [
          { feature: "gap_pct", op: "gt", value: 2 },
          { feature: "rvol", op: "gt", value: 1.5 },
        ],
      },
      exit: { afterDays: 5, stopLossPct: 4 },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 3, slippageBps: 10 },
    },
  },
  {
    id: "unsupported",
    label: "Large-cap filter (demonstrates a gap)",
    note: "Uses market_cap. Compiles, and can never be backtested here — the warning proves it.",
    dsl: {
      name: "largecap_momentum",
      description: "Momentum, restricted to large capitalisation.",
      universe: { market: "US", maxPositions: 10 },
      entry: {
        all: [
          { feature: "momentum_20d", op: "gt", value: 5 },
          { feature: "market_cap", op: "gt", value: 10_000_000_000 },
        ],
      },
      exit: { afterDays: 15, stopLossPct: 5 },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 5, slippageBps: 5 },
    },
  },
];

interface Result {
  ok: boolean;
  id?: string;
  name?: string;
  warnings?: string[];
  error?: string;
  message?: string;
  issues?: { path: string; message: string }[];
}

export function StrategyAuthor() {
  const router = useRouter();
  const [selected, setSelected] = useState<Preset>(PRESETS[0]);
  const [text, setText] = useState(() => JSON.stringify(PRESETS[0].dsl, null, 2));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  function choose(preset: Preset) {
    setSelected(preset);
    setText(JSON.stringify(preset.dsl, null, 2));
    setResult(null);
  }

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      let dsl: unknown;
      try {
        dsl = JSON.parse(text);
      } catch (caught) {
        // Reported here rather than sent to the server: a JSON syntax error is the author's
        // typing, not a rejection by the compiler, and conflating them hides which is which.
        setResult({ ok: false, error: "INVALID_JSON", message: caught instanceof Error ? caught.message : "Not valid JSON." });
        return;
      }

      const response = await mutationFetch("/api/strategy/author", {
        method: "POST",
        body: JSON.stringify({ dsl, createdBy: "owner" }),
      });
      const body = (await response.json()) as Result;
      setResult({ ...body, ok: response.ok });
      if (response.ok) router.refresh();
    } catch (caught) {
      setResult({ ok: false, error: "REQUEST_FAILED", message: caught instanceof Error ? caught.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="strategy-author">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => choose(preset)}
            data-testid={`preset-${preset.id}`}
            className={`border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
              selected.id === preset.id
                ? "border-terminal text-terminal"
                : "border-panel text-muted-foreground hover:text-foreground"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">{selected.note}</p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={16}
        data-testid="strategy-dsl"
        className="w-full bg-panel-alt border border-panel p-2 text-[11px] font-mono leading-relaxed focus:border-terminal focus:outline-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          data-testid="author-submit"
          className="inline-flex items-center gap-1.5 border border-panel bg-panel-alt px-3 py-1 text-[11px] uppercase tracking-wider hover:border-terminal hover:text-terminal transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          {busy ? "Compiling" : "Compile and save"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          Saved as <strong>draft</strong>. Nothing is validated until you spend a trial.
        </span>
      </div>

      {result ? (
        <div
          className={`border px-3 py-2 text-[11px] ${result.ok ? "border-gain/40 text-gain" : "border-loss/40 text-loss"}`}
          data-testid="author-result"
        >
          {result.ok ? (
            <>
              <div>
                Created <strong>{result.name}</strong> ({result.id}) as draft.
              </div>
              {result.warnings && result.warnings.length > 0 ? (
                <ul className="mt-1 space-y-0.5" data-testid="author-warnings">
                  {result.warnings.map((warning) => (
                    <li key={warning} className="text-amber leading-relaxed">
                      ⚠ {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
              <div>
                <strong>{result.error}</strong> — {result.message}
              </div>
              {result.issues ? (
                <ul className="mt-1 space-y-0.5">
                  {result.issues.map((issue) => (
                    <li key={`${issue.path}-${issue.message}`}>
                      {issue.path || "(root)"}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
