"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface QuoteView {
  price: number;
  change: number | null;
  changePct: number | null;
}

interface Props {
  ticker: string;
  label: string;
  quote: QuoteView;
  currency?: "USD" | "INR";
  instrumentId?: string;
  /** Poll interval. 0 disables polling (used by tests and static contexts). */
  refreshMs?: number;
}

/**
 * A leader card that stays alive after the server render: it re-polls its own quote and
 * flashes green or red when the price actually moves. The flash only fires on a genuine
 * change — a terminal that blinks on every poll is noise, not information.
 */
export function IndexCard({
  ticker,
  label,
  quote: initial,
  currency = "USD",
  instrumentId = ticker,
  refreshMs = 20_000,
}: Props) {
  const [quote, setQuote] = useState<QuoteView>(initial);
  const [flash, setFlash] = useState<"gain" | "loss" | null>(null);
  const lastPrice = useRef(initial.price);

  useEffect(() => {
    if (!refreshMs) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/market/quote?instrumentId=${encodeURIComponent(instrumentId)}`);
        if (!response.ok || cancelled) return;
        const next = (await response.json()) as QuoteView & { price?: number };
        if (typeof next.price !== "number" || !Number.isFinite(next.price)) return;

        if (next.price !== lastPrice.current) {
          setFlash(next.price > lastPrice.current ? "gain" : "loss");
          lastPrice.current = next.price;
          // Clear after the animation so the same class can re-trigger on the next move.
          setTimeout(() => { if (!cancelled) setFlash(null); }, 950);
        }
        setQuote({ price: next.price, change: next.change ?? null, changePct: next.changePct ?? null });
      } catch {
        // A failed poll keeps the last known value on screen; the provenance banner elsewhere
        // is the honest channel for degraded data, not a blanked-out card.
      }
    };

    const timer = setInterval(poll, refreshMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [instrumentId, refreshMs]);

  const change = quote.change ?? 0;
  const changePct = quote.changePct ?? 0;
  const isGain = changePct >= 0;

  return (
    <Link
      href={`/analyze/${encodeURIComponent(instrumentId)}`}
      className="stat-tile block bg-panel border border-panel rounded p-3 hover:border-terminal/30 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xs text-muted-foreground font-mono">{ticker}</div>
        </div>
        {isGain ? <TrendingUp className="w-4 h-4 text-gain" /> : <TrendingDown className="w-4 h-4 text-loss" />}
      </div>
      <div className="mt-2">
        <div className={`text-xl font-bold font-mono ${flash === "gain" ? "flash-gain" : flash === "loss" ? "flash-loss" : ""}`}>
          {formatMoney(quote.price, currency)}
        </div>
        <div className={`flex items-center gap-1 text-xs font-semibold mt-0.5 ${isGain ? "text-gain" : "text-loss"}`}>
          <span>{isGain ? "+" : ""}{change.toFixed(2)}</span>
          <span>({isGain ? "+" : ""}{changePct.toFixed(2)}%)</span>
        </div>
      </div>
    </Link>
  );
}

function formatMoney(value: number, currency: "USD" | "INR") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
