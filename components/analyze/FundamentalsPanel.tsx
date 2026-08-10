import type { Fundamentals, Quote } from "@/lib/providers/types";
import { formatCompactMoney, formatMoney } from "@/lib/market/money";
import type { Currency } from "@/lib/market/types";

interface Props {
  fundamentals: Fundamentals;
  quote: Quote;
  currency: Currency;
}

function fmt(val: number | null, prefix = "", suffix = "", decimals = 2) {
  if (val === null || val === undefined) return "—";
  return `${prefix}${val.toFixed(decimals)}${suffix}`;
}

function fmtLarge(val: number | null, currency: Currency) {
  if (val === null) return "—";
  return formatCompactMoney(val, currency);
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-panel last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-semibold ${highlight ? "text-terminal" : ""}`}>{value}</span>
    </div>
  );
}

export function FundamentalsPanel({ fundamentals: f, currency }: Props) {
  return (
    <div className="bg-panel border border-panel rounded p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Fundamentals</h2>
      <Row label="P/E Ratio" value={fmt(f.pe, "", "x")} />
      <Row label="EPS (TTM)" value={f.eps !== null ? formatMoney(f.eps, currency) : "—"} />
      <Row label="Revenue (TTM)" value={fmtLarge(f.revenue, currency)} />
      <Row label="Revenue Growth" value={f.revenueGrowth !== null ? `${(f.revenueGrowth * 100).toFixed(1)}%` : "—"} highlight={(f.revenueGrowth ?? 0) > 0.15} />
      <Row label="Gross Margin" value={f.grossMargin !== null ? `${(f.grossMargin * 100).toFixed(1)}%` : "—"} />
      <Row label="Net Margin" value={f.netMargin !== null ? `${(f.netMargin * 100).toFixed(1)}%` : "—"} />
      <Row label="Debt/Equity" value={fmt(f.debtToEquity)} />
      <Row label="Free Cash Flow" value={fmtLarge(f.freeCashFlow, currency)} />
      <Row label="Book Value/Share" value={f.bookValue !== null ? formatMoney(f.bookValue, currency) : "—"} />
      <Row label="Dividend Yield" value={f.dividendYield !== null ? `${(f.dividendYield * 100).toFixed(2)}%` : "N/A"} />
      <Row label="Beta" value={fmt(f.beta)} />
      <Row label="52W High" value={f.fiftyTwoWeekHigh !== null ? formatMoney(f.fiftyTwoWeekHigh, currency) : "—"} />
      <Row label="52W Low" value={f.fiftyTwoWeekLow !== null ? formatMoney(f.fiftyTwoWeekLow, currency) : "—"} />
    </div>
  );
}
