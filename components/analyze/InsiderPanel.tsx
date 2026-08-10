import type { InsiderTransaction } from "@/lib/providers/types";
import { formatMoney } from "@/lib/market/money";
import type { Currency } from "@/lib/market/types";
import { TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  transactions: InsiderTransaction[];
  currency: Currency;
}

export function InsiderPanel({ transactions, currency }: Props) {
  const netChange = transactions.reduce((sum, t) => sum + t.change, 0);
  const purchases = transactions.filter((t) => t.change > 0).length;
  const sales = transactions.filter((t) => t.change < 0).length;

  return (
    <div className="bg-panel border border-panel rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Insider Activity</h2>
        <div className={`flex items-center gap-1 text-xs font-semibold ${netChange > 0 ? "text-gain" : "text-loss"}`}>
          {netChange > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          Net: {netChange > 0 ? "+" : ""}{netChange.toLocaleString()} shares
        </div>
      </div>

      <div className="flex gap-4 mb-3 text-xs">
        <span className="text-gain">{purchases} purchases</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-loss">{sales} sales</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-panel">
              <th className="text-left pb-2">Insider</th>
              <th className="text-right pb-2">Shares</th>
              <th className="text-right pb-2">Price</th>
              <th className="text-right pb-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 8).map((t, i) => {
              const isBuy = t.change > 0;
              return (
                <tr key={i} className="border-b border-panel/50 last:border-0">
                  <td className="py-1.5">
                    <div className="font-semibold truncate max-w-[140px]">{t.name}</div>
                    <div className={`text-xs ${isBuy ? "text-gain" : "text-loss"}`}>
                      {isBuy ? "PURCHASE" : "SALE"}
                    </div>
                  </td>
                  <td className={`py-1.5 text-right font-mono font-semibold ${isBuy ? "text-gain" : "text-loss"}`}>
                    {isBuy ? "+" : ""}{t.change.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">
                    {t.transactionPrice ? formatMoney(t.transactionPrice, currency) : "—"}
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground">{t.transactionDate}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
