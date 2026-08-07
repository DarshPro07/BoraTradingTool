"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, TrendingDown, Plus, X, Loader2 } from "lucide-react";
import type { Quote } from "@/lib/providers/types";
import { mutationFetch } from "@/lib/client/mutation-fetch";

export interface WatchlistEntry {
  ticker: string;
  quote: Quote | null;
  /**
   * Canonical instrument id, e.g. `US:XNAS:NVDA`.
   *
   * `/analyze` rejects a bare symbol by design — `parseInstrument` needs the exchange — so a
   * link built from `ticker` alone is dead on arrival. Optional because a watchlist row may
   * predate the catalog; the link falls back to the ticker and fails visibly rather than the
   * page pretending the destination exists.
   */
  instrumentId?: string;
  thesis?: string;
  catalysts?: string[];
  riskLevel?: "low" | "medium" | "high";
}

const RISK_STYLES = {
  low: "text-gain bg-green/10 border-gain/30",
  medium: "text-amber bg-amber/10 border-amber/30",
  high: "text-loss bg-red/10 border-loss/30",
};

export function WatchlistManager({ entries }: { entries: WatchlistEntry[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    if (entries.some((e) => e.ticker === ticker)) {
      setError(`${ticker} is already in your watchlist`);
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await mutationFetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add");
      setInput("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(ticker: string) {
    await mutationFetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Watchlist</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entries.length} stock{entries.length !== 1 ? "s" : ""}
            {isPending && <span className="ml-2 opacity-60">Refreshing…</span>}
          </p>
        </div>

        {/* Add ticker form */}
        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => { setInput(e.target.value.toUpperCase()); setError(null); }}
                placeholder="Add ticker…"
                maxLength={10}
                className="w-28 px-2 py-1 text-xs bg-accent border border-border rounded focus:outline-none focus:border-terminal/50 font-mono placeholder:text-muted-foreground/50"
              />
              <button
                type="submit"
                disabled={adding || !input.trim()}
                className="flex items-center gap-1 px-3 py-1 bg-terminal text-black text-xs font-bold rounded hover:bg-terminal/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Add
              </button>
            </div>
            {error && <p className="text-xs text-loss mt-1">{error}</p>}
          </div>
        </form>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <div className="bg-panel border border-panel rounded p-8 text-center text-muted-foreground text-xs">
          Your watchlist is empty. Add a ticker above to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((item) => {
            const isGain = (item.quote?.changePct ?? 0) >= 0;
            return (
              <div
                key={item.ticker}
                className="bg-panel border border-panel rounded p-4 hover:border-terminal/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="shrink-0">
                      {/* No canonical id means the instrument is not in the catalog, and
                          /analyze would reject a bare symbol. Rendering a link that is known to
                          fail is worse than rendering none: it invites a click that 500s. */}
                      {item.instrumentId ? (
                        <Link
                          href={`/analyze/${encodeURIComponent(item.instrumentId)}`}
                          className="text-terminal font-bold text-base hover:underline font-mono"
                        >
                          {item.ticker}
                        </Link>
                      ) : (
                        <span
                          className="text-muted-foreground font-bold text-base font-mono"
                          title="Not in the instrument catalog, so there is no analysis page for it"
                        >
                          {item.ticker}
                        </span>
                      )}
                      {item.riskLevel && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 border rounded text-xs ml-2 ${RISK_STYLES[item.riskLevel]}`}>
                          {item.riskLevel} risk
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {item.thesis ? (
                        <>
                          <p className="text-xs text-foreground">{item.thesis}</p>
                          {item.catalysts && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {item.catalysts.map((c) => (
                                <span key={c} className="text-xs px-2 py-0.5 bg-accent border border-border rounded text-muted-foreground">
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No thesis — visit analyze page for full details</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-3 shrink-0">
                    {/* The object existing does not mean its fields are populated. A quote can
                        arrive with a null price or changePct — `item.quote &&` passed that
                        through and `.toFixed()` on null took the whole page down with a 500.
                        Each number is now checked individually, and an absent one is shown as
                        absent rather than as a zero. */}
                    <div className="text-right">
                      <div className="text-base font-bold font-mono">
                        {typeof item.quote?.price === "number" && Number.isFinite(item.quote.price)
                          ? `$${item.quote.price.toFixed(2)}`
                          : <span className="text-muted-foreground text-xs font-normal">no quote</span>}
                      </div>
                      {typeof item.quote?.changePct === "number" && Number.isFinite(item.quote.changePct) ? (
                        <div className={`flex items-center gap-1 text-xs font-semibold justify-end ${isGain ? "text-gain" : "text-loss"}`}>
                          {isGain ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isGain ? "+" : ""}{item.quote.changePct.toFixed(2)}%
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground">change unavailable</div>
                      )}
                      {item.instrumentId ? (
                        <Link
                          href={`/analyze/${encodeURIComponent(item.instrumentId)}`}
                          className="text-xs text-terminal hover:underline mt-1 block"
                        >
                          Analyze →
                        </Link>
                      ) : (
                        <span className="text-[10px] text-muted-foreground mt-1 block">not in catalog</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(item.ticker)}
                      className="p-1 text-muted-foreground hover:text-loss transition-colors rounded hover:bg-accent"
                      title={`Remove ${item.ticker}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
