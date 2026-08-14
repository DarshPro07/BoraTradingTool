"use client";

import { useState, useEffect, useRef } from "react";
import type { Quote, CompanyProfile } from "@/lib/providers/types";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  quote: Quote;
  profile: CompanyProfile;
  overallSignal: "buy" | "hold" | "sell";
  instrumentId: string;
  currency: "USD" | "INR";
}

const SIGNAL_STYLES = {
  buy:  "bg-green/20 text-gain border-gain/40",
  hold: "bg-amber/20 text-amber border-amber/40",
  sell: "bg-red/20 text-loss border-red/40",
};

const POLL_INTERVAL = 10_000; // 10 seconds

export function QuoteHeader({ quote: initial, profile, overallSignal, instrumentId, currency }: Props) {
  const [quote, setQuote] = useState(initial);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [ticking, setTicking] = useState(false);
  const prevPrice = useRef(initial.price);

  useEffect(() => {
    async function refresh() {
      setTicking(true);
      try {
        const res = await fetch(`/api/market/quote?instrumentId=${encodeURIComponent(instrumentId)}`);
        if (!res.ok) return;
        const normalized = await res.json();
        const data: Quote = {
          ticker: normalized.instrument.symbol,
          price: normalized.price,
          open: normalized.open ?? 0,
          high: normalized.high ?? 0,
          low: normalized.low ?? 0,
          prevClose: normalized.previousClose ?? 0,
          change: normalized.change ?? 0,
          changePct: normalized.changePct ?? 0,
          volume: normalized.volume ?? 0,
          avgVolume: normalized.volume ?? 0,
          fetchedAt: new Date(normalized.provenance.ingestedAt),
          mock: false,
        };

        // Flash the price if it moved
        if (data.price !== prevPrice.current) {
          setFlash(data.price > prevPrice.current ? "up" : "down");
          setTimeout(() => setFlash(null), 800);
          prevPrice.current = data.price;
        }

        setQuote(data);
        setLastUpdated(new Date());
      } catch {
        // keep showing last known price on network error
      } finally {
        setTicking(false);
      }
    }

    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [instrumentId]);

  const isGain = quote.changePct >= 0;

  const priceColor =
    flash === "up"   ? "text-gain transition-colors duration-300" :
    flash === "down" ? "text-loss transition-colors duration-300" :
    "transition-colors duration-500";

  return (
    <div className="bg-panel border border-panel rounded p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {/* Ticker + company info */}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-terminal font-mono">{quote.ticker}</h1>
            <span className="text-muted-foreground text-sm">{profile.name}</span>
            <Badge variant="outline" className="text-xs border-border text-muted-foreground">
              {profile.exchange}
            </Badge>
            {profile.sector && (
              <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                {profile.sector}
              </Badge>
            )}
          </div>

          {/* Price row */}
          <div className="flex items-baseline gap-3 mt-2">
            <span className={`text-4xl font-bold font-mono ${priceColor}`}>
              {formatMoney(quote.price, currency)}
            </span>
            <div className={`flex items-center gap-1 text-lg font-semibold ${isGain ? "text-gain" : "text-loss"}`}>
              {isGain ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              <span>{isGain ? "+" : ""}{quote.change.toFixed(2)}</span>
              <span>({isGain ? "+" : ""}{quote.changePct.toFixed(2)}%)</span>
            </div>

            {/* Data source provenance indicator */}
            {quote.mock ? (
              <div className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded bg-amber/15 border border-amber/40">
                <span className="w-1.5 h-1.5 rounded-full bg-amber" />
                <span className="text-xs text-amber font-mono font-semibold">SIMULATED</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 ml-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${ticking ? "bg-terminal animate-ping" : "bg-terminal animate-pulse"}`}
                />
                <span className="text-xs text-muted-foreground/60 font-mono">
                  {lastUpdated
                    ? `${lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                    : "RESEARCH DATA"}
                </span>
                {/* Show data source quality when not live */}
                {quote.provenance && quote.provenance.quality !== "LIVE" && (
                  <span className={`text-xs px-1 py-0.5 rounded ${
                    quote.provenance.quality === "DELAYED" ? "bg-amber/15 text-amber" :
                    quote.provenance.quality === "STALE" ? "bg-red/15 text-red" :
                    "bg-muted/15 text-muted-foreground"
                  }`}>
                    {quote.provenance.quality} · {quote.provenance.provider}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Signal badge */}
        <div className="flex flex-col items-end gap-2">
          <div className={`px-4 py-2 border rounded text-sm font-bold uppercase tracking-wider ${SIGNAL_STYLES[overallSignal]}`}>
            {overallSignal === "buy"  ? <TrendingUp   className="w-4 h-4 inline mr-1" /> :
             overallSignal === "sell" ? <TrendingDown  className="w-4 h-4 inline mr-1" /> :
                                        <Minus         className="w-4 h-4 inline mr-1" />}
            {overallSignal.toUpperCase()}
          </div>
          <span className="text-xs text-muted-foreground">Research Signal</span>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mt-4 pt-4 border-t border-panel">
        <Stat label="OPEN"       value={quote.open ? formatMoney(quote.open, currency) : "—"} />
        <Stat label="HIGH"       value={quote.high ? formatMoney(quote.high, currency) : "—"} />
        <Stat label="LOW"        value={quote.low ? formatMoney(quote.low, currency) : "—"} />
        <Stat label="PREV CLOSE" value={quote.prevClose ? formatMoney(quote.prevClose, currency) : "—"} />
        <Stat label="VOLUME"     value={fmtVol(quote.volume)} />
        <Stat label="AVG VOL"    value={fmtVol(quote.avgVolume)} />
      </div>
    </div>
  );
}

function formatMoney(value: number, currency: "USD" | "INR") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold font-mono mt-0.5">{value}</div>
    </div>
  );
}

function fmtVol(v: number | undefined) {
  if (!v) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toString();
}
