"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The held-hypothesis inbox (master item 15).
 *
 * A hypothesis that could not become a strategy is not garbage — it is recorded work waiting on
 * something specific: a feature the engine cannot derive yet, a statement too vague to compile,
 * or an idea that is not a trading rule at all. This panel makes that queue visible. Before it,
 * held hypotheses lived only in the database: recorded honestly, shown nowhere, which reads as
 * "lost" to the person who wrote them.
 */

interface HypothesisRow {
  id: string;
  title: string;
  statement: string;
  market: string;
  status: string;
  createdBy: string;
  /** The strategy this hypothesis became, when it did. */
  strategy: string | null;
}

export function HypothesisInbox() {
  const [rows, setRows] = useState<HypothesisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/research/hypotheses")
      .then(async (response) => {
        const body = (await response.json()) as { hypotheses?: HypothesisRow[]; message?: string };
        if (!response.ok || !Array.isArray(body.hypotheses)) {
          setError(body.message ?? "Hypotheses unavailable.");
          return;
        }
        setRows(body.hypotheses);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Request failed."));
  }, []);

  useEffect(load, [load]);

  if (error) {
    return (
      <div className="px-3 py-2 text-[11px] text-loss" data-testid="hypothesis-inbox-error">
        {error}
      </div>
    );
  }
  if (rows === null) return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading…</div>;

  const held = rows.filter((row) => row.strategy === null);
  const authored = rows.filter((row) => row.strategy !== null);

  return (
    <div className="p-3 space-y-2 text-[11px]" data-testid="hypothesis-inbox">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-muted-foreground">
          HELD {held.length} · AUTHORED {authored.length}
        </span>
        <button
          type="button"
          onClick={load}
          className="border border-panel px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          data-testid="hypothesis-inbox-refresh"
        >
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground" data-testid="hypothesis-inbox-empty">
          No hypotheses recorded yet. Write one above — refused ones are held here with their
          reason, not discarded.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {[...held, ...authored].map((row) => (
            <li key={row.id} className="border border-panel/60 px-2 py-1.5" data-testid="hypothesis-inbox-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{row.title}</span>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{row.market}</span>
                {row.strategy ? (
                  <span className="text-[9px] uppercase tracking-wider text-terminal">→ {row.strategy}</span>
                ) : (
                  <span className="text-[9px] uppercase tracking-wider text-amber">HELD · {row.status}</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{row.statement}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
