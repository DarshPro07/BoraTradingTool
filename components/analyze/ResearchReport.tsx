import type { Quote, Fundamentals, PriceTarget } from "@/lib/providers/types";
import type { TechnicalIndicators, Signal } from "@/lib/data/technicals";
import { formatMoney } from "@/lib/market/money";
import type { Currency } from "@/lib/market/types";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

interface Props {
  ticker: string;
  quote: Quote;
  tech: TechnicalIndicators;
  fundamentals: Fundamentals;
  bullSignals: Signal[];
  bearSignals: Signal[];
  overallSignal: "buy" | "hold" | "sell";
  priceTarget: PriceTarget;
  currency: Currency;
}

const SIGNAL_CONFIG = {
  buy: { label: "BUY", icon: TrendingUp, cls: "text-gain", bg: "bg-green/10 border-gain/30" },
  hold: { label: "HOLD", icon: Minus, cls: "text-amber", bg: "bg-amber/10 border-amber/30" },
  sell: { label: "SELL", icon: TrendingDown, cls: "text-loss", bg: "bg-red/10 border-loss/30" },
};

export function ResearchReport({ ticker, quote, tech, fundamentals, bullSignals, bearSignals, overallSignal, priceTarget, currency }: Props) {
  const cfg = SIGNAL_CONFIG[overallSignal];
  const Icon = cfg.icon;
  const upside = priceTarget.mean ? ((priceTarget.mean - quote.price) / quote.price) * 100 : null;

  return (
    <div className="bg-panel border border-panel rounded p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 pb-4 border-b border-panel">
        <div>
          <h2 className="text-sm font-bold text-terminal uppercase tracking-wider">Research Report</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {ticker} · Generated {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 border rounded ${cfg.bg}`}>
          <Icon className={`w-5 h-5 ${cfg.cls}`} />
          <span className={`text-lg font-bold ${cfg.cls}`}>{cfg.label}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bull signals */}
        <div>
          <h3 className="text-xs font-bold text-gain uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Bull Signals ({bullSignals.length})
          </h3>
          {bullSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No significant bull signals detected.</p>
          ) : (
            <div className="space-y-2">
              {bullSignals.map((s, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-green/5 border border-gain/20 rounded">
                  <span className="text-gain text-xs mt-0.5">▲</span>
                  <div>
                    <div className="text-xs font-semibold text-gain">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bear signals */}
        <div>
          <h3 className="text-xs font-bold text-loss uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingDown className="w-3 h-3" /> Bear Signals ({bearSignals.length})
          </h3>
          {bearSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No significant bear signals detected.</p>
          ) : (
            <div className="space-y-2">
              {bearSignals.map((s, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-red/5 border border-loss/20 rounded">
                  <span className="text-loss text-xs mt-0.5">▼</span>
                  <div>
                    <div className="text-xs font-semibold text-loss">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-panel">
        <Metric label="Price" value={formatMoney(quote.price, currency)} />
        <Metric
          label="Price Target"
          value={priceTarget.mean ? formatMoney(priceTarget.mean, currency) : "—"}
          sub={upside !== null ? `${upside > 0 ? "+" : ""}${upside.toFixed(1)}% upside` : undefined}
          subCls={upside !== null ? (upside > 0 ? "text-gain" : "text-loss") : ""}
        />
        <Metric label="P/E Ratio" value={fundamentals.pe ? `${fundamentals.pe.toFixed(1)}x` : "—"} />
        <Metric
          label="Trend"
          value={tech.trend.toUpperCase()}
          cls={tech.trend === "bullish" ? "text-gain" : tech.trend === "bearish" ? "text-loss" : "text-amber"}
        />
      </div>

      {/* Disclaimer */}
      <div className="mt-4 pt-3 border-t border-panel flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber" />
        <p>
          This Research Report is generated by rule-based algorithms and API data aggregation. It is <strong>not financial advice</strong>.
          All signals are model-generated research opinions. Consult a licensed financial advisor before making investment decisions.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, cls, subCls }: { label: string; value: string; sub?: string; cls?: string; subCls?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-base font-bold font-mono mt-0.5 ${cls ?? ""}`}>{value}</div>
      {sub && <div className={`text-xs ${subCls ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}
