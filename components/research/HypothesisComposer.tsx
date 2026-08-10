"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/system/Panel";

/**
 * Write a trading idea in prose; the system answers with a strategy or a stated refusal.
 *
 * This is the owner's end of the "professor": the same triage and authoring engine the learning
 * cycle runs, reachable from the page where its output lands. The verdict language is shown
 * verbatim because the refusals are the product — "this is not a trading rule" and "this needs
 * data we do not hold" teach the owner what this deployment can actually test, which no green
 * checkmark ever would.
 */

export interface ComposeResult {
  ok: boolean;
  provenance?: {
    youSaid: { title: string; statement: string };
    interpreted: { feature: string; op: string; value: number; readFrom: string }[];
    assumptionsAdded: string[];
  } | null;
  hypothesisId?: string;
  alreadyExisted?: boolean;
  verdict?: string;
  reason?: string;
  authored?: { specId: string; name: string; familyId: string | null } | null;
  error?: string;
  message?: string;
}

const VERDICT_TONE: Record<string, string> = {
  EXPRESSIBLE: "text-gain",
  NEEDS_FEATURE: "text-amber",
  NOT_A_TRADING_RULE: "text-amber",
  UNCLEAR: "text-amber",
};

export function HypothesisComposer({ onOutcome }: { onOutcome?: (result: ComposeResult) => void } = {}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Controlled fields rendered by the server can accept keystrokes before React owns their
  // state, then lose those keystrokes during hydration. Keep the form visibly unavailable for
  // that short interval instead of accepting an idea the application cannot retain.
  useEffect(() => setHydrated(true), []);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/research/hypotheses", {
        method: "POST",
        headers: { "content-type": "application/json", "x-marketpulse-csrf": "1" },
        body: JSON.stringify({ title, statement, rationale: rationale || undefined, market: "NSE" }),
      });
      const body = (await response.json()) as ComposeResult;
      const outcome = { ...body, ok: response.ok };
      setResult(outcome);
      // The guided flow advances from the same outcome the panel renders — one truth, two views.
      onOutcome?.(outcome);
      if (response.ok && body.authored) router.refresh();
    } catch (caught) {
      setResult({ ok: false, error: "REQUEST_FAILED", message: caught instanceof Error ? caught.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="HYPOTHESIS — PROSE IN, STRATEGY OR REFUSAL OUT">
      <div className="p-3 space-y-2" data-testid="hypothesis-composer">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          State one economic idea. Thresholds are read from your own words — &quot;gap &gt;= 3%, relative
          volume &gt;= 1&quot; becomes an entry condition; prose without numbers is refused rather than
          guessed at. An expressible idea becomes a draft strategy in its own research family. Most
          real hypotheses are refused, and the refusal names exactly why — that is the system
          working, not failing.
        </p>

        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title — e.g. Gap-and-volume screen for NSE liquid names"
          className="w-full bg-transparent border border-panel px-2 py-1.5 text-xs focus:border-terminal outline-none"
          data-testid="hypothesis-title"
          disabled={!hydrated || busy}
        />
        <textarea
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          placeholder="Statement — the claim, with its numbers. e.g. Stocks gapping >= 3% on relative volume >= 1.5 continue upward intraday after costs."
          rows={3}
          className="w-full bg-transparent border border-panel px-2 py-1.5 text-xs font-mono leading-relaxed focus:border-terminal outline-none resize-y"
          data-testid="hypothesis-statement"
          disabled={!hydrated || busy}
        />
        <textarea
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Rationale (optional) — why this might be true."
          rows={2}
          className="w-full bg-transparent border border-panel px-2 py-1.5 text-xs leading-relaxed focus:border-terminal outline-none resize-y"
          data-testid="hypothesis-rationale"
          disabled={!hydrated || busy}
        />

        <button
          type="button"
          onClick={submit}
          disabled={!hydrated || busy}
          className="border border-terminal text-terminal px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-terminal/10 disabled:opacity-50"
          data-testid="hypothesis-submit"
        >
          {busy ? "Triaging…" : "Submit hypothesis"}
        </button>

        {result ? (
          <div
            className={`border px-3 py-2 text-[11px] leading-relaxed ${result.ok ? "border-panel" : "border-loss/40 text-loss"}`}
            data-testid="hypothesis-result"
          >
            {result.ok ? (
              <>
                <div className={VERDICT_TONE[result.verdict ?? ""] ?? ""}>
                  <strong>{result.verdict}</strong>
                  {result.alreadyExisted ? " (already recorded — nothing duplicated)" : null}
                </div>
                <div className="mt-1">{result.reason}</div>
                {result.authored ? (
                  <div className="mt-1 text-gain" data-testid="hypothesis-authored">
                    Draft strategy <strong>{result.authored.name}</strong>
                    {result.authored.familyId ? (
                      <> in family <strong>{result.authored.familyId}</strong> — the hypothesis is the family.</>
                    ) : null}
                  </div>
                ) : null}
                {result.provenance ? (
                  <div className="mt-2 border-t border-panel pt-2 space-y-1" data-testid="hypothesis-provenance">
                    <div className="text-[10px] tracking-widest text-muted-foreground">
                      YOU SAID → MARKETPULSE INTERPRETED → STRATEGY ACTUALLY TESTED
                    </div>
                    {result.provenance.interpreted.map((item) => (
                      <div key={item.feature} className="font-mono text-[10px]">
                        “{item.readFrom}” → <span className="text-terminal">{item.feature} {item.op} {item.value}</span>
                      </div>
                    ))}
                    <div className="text-[10px] text-muted-foreground">
                      Added by the system, not stated by you:{" "}
                      {result.provenance.assumptionsAdded.join("; ")}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div>
                <strong>{result.error}</strong> — {result.message}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
