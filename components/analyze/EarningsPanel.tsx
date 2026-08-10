import type { EarningsRecord } from "@/lib/providers/types";
import { formatMoney } from "@/lib/market/money";
import type { Currency } from "@/lib/market/types";

interface Props {
  earnings: EarningsRecord[];
  currency: Currency;
}

export function EarningsPanel({ earnings, currency }: Props) {
  return (
    <div className="bg-panel border border-panel rounded p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Earnings History</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-panel">
              <th className="text-left pb-2">Period</th>
              <th className="text-right pb-2">Actual</th>
              <th className="text-right pb-2">Est.</th>
              <th className="text-right pb-2">Surprise</th>
            </tr>
          </thead>
          <tbody>
            {earnings.slice(0, 8).map((e, i) => {
              const beat = (e.surprisePct ?? 0) > 0;
              return (
                <tr key={i} className="border-b border-panel/50 last:border-0">
                  <td className="py-1.5 font-mono text-muted-foreground">{e.period}</td>
                  <td className="py-1.5 text-right font-mono font-semibold">
                    {e.actual !== null ? formatMoney(e.actual, currency) : "—"}
                  </td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">
                    {e.estimate !== null ? formatMoney(e.estimate, currency) : "—"}
                  </td>
                  <td className={`py-1.5 text-right font-mono font-semibold ${beat ? "text-gain" : "text-loss"}`}>
                    {e.surprisePct !== null ? `${beat ? "+" : ""}${e.surprisePct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* EPS beat/miss bar chart */}
      <div className="mt-4 space-y-1">
        {earnings.slice(0, 6).reverse().map((e, i) => {
          const beat = (e.surprisePct ?? 0) > 0;
          const width = Math.min(Math.abs(e.surprisePct ?? 0) * 2, 100);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-12 shrink-0">{e.period}</span>
              <div className="flex-1 h-3 bg-accent rounded-sm overflow-hidden">
                <div
                  className={`h-full rounded-sm ${beat ? "bg-gain/60" : "bg-loss/60"}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className={`text-xs font-mono w-10 text-right ${beat ? "text-gain" : "text-loss"}`}>
                {e.surprisePct !== null ? `${beat ? "+" : ""}${e.surprisePct.toFixed(0)}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
