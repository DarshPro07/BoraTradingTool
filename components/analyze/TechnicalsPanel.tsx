import type { TechnicalIndicators } from "@/lib/data/technicals";
import { formatMoney } from "@/lib/market/money";
import type { Currency } from "@/lib/market/types";

interface Props {
  tech: TechnicalIndicators;
  price: number;
  currency: Currency;
}

function rsiColor(rsi: number | null) {
  if (rsi === null) return "text-muted-foreground";
  if (rsi < 30) return "text-gain";
  if (rsi > 70) return "text-loss";
  return "text-foreground";
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-panel last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-xs font-mono font-semibold">{value}</span>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

export function TechnicalsPanel({ tech, price, currency }: Props) {
  const trendBadge = {
    bullish: "text-gain",
    bearish: "text-loss",
    neutral: "text-amber",
  }[tech.trend];

  return (
    <div className="bg-panel border border-panel rounded p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Technicals</h2>

      <div className="space-y-0">
        <Row label="RSI (14)" value={tech.rsi !== null ? tech.rsi.toFixed(1) : "—"} />
        <Row
          label="MACD"
          value={tech.macdLine !== null ? tech.macdLine.toFixed(3) : "—"}
          sub={tech.macdHist !== null ? `Hist: ${tech.macdHist.toFixed(3)}` : undefined}
        />
        <Row label="SMA 20" value={tech.sma20 !== null ? formatMoney(tech.sma20, currency) : "—"} sub={tech.sma20 ? (price > tech.sma20 ? "▲ above" : "▼ below") : undefined} />
        <Row label="SMA 50" value={tech.sma50 !== null ? formatMoney(tech.sma50, currency) : "—"} sub={tech.sma50 ? (price > tech.sma50 ? "▲ above" : "▼ below") : undefined} />
        <Row label="SMA 200" value={tech.sma200 !== null ? formatMoney(tech.sma200, currency) : "—"} sub={tech.sma200 ? (price > tech.sma200 ? "▲ above" : "▼ below") : undefined} />
        <Row label="BB Upper" value={tech.bbUpper !== null ? formatMoney(tech.bbUpper, currency) : "—"} />
        <Row label="BB Lower" value={tech.bbLower !== null ? formatMoney(tech.bbLower, currency) : "—"} />
        <Row label="Support" value={tech.support !== null ? formatMoney(tech.support, currency) : "—"} />
        <Row label="Resistance" value={tech.resistance !== null ? formatMoney(tech.resistance, currency) : "—"} />
      </div>

      <div className="mt-3 pt-3 border-t border-panel flex items-center justify-between">
        <span className="text-xs text-muted-foreground">TREND</span>
        <span className={`text-sm font-bold uppercase ${trendBadge}`}>{tech.trend}</span>
      </div>

      {tech.rsi !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Oversold</span>
            <span className={rsiColor(tech.rsi)}>RSI {tech.rsi}</span>
            <span>Overbought</span>
          </div>
          <div className="h-1.5 bg-accent rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${rsiColor(tech.rsi)}`}
              style={{ width: `${tech.rsi}%`, backgroundColor: tech.rsi < 30 ? "#00cc66" : tech.rsi > 70 ? "#cc3333" : "#ff6600" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
