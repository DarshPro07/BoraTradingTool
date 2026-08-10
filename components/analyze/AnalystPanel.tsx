import type { AnalystRating, PriceTarget } from "@/lib/providers/types";
import { formatMoney } from "@/lib/market/money";
import type { Currency } from "@/lib/market/types";
import { TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  ratings: AnalystRating[];
  priceTarget: PriceTarget;
  currentPrice: number;
  currency: Currency;
}

export function AnalystPanel({ ratings, priceTarget, currentPrice, currency }: Props) {
  const latest = ratings[0];
  if (!latest) return null;

  const total = latest.buy + latest.strongBuy + latest.hold + latest.sell + latest.strongSell;
  const buyPct = total > 0 ? ((latest.buy + latest.strongBuy) / total) * 100 : 0;
  const holdPct = total > 0 ? (latest.hold / total) * 100 : 0;
  const sellPct = total > 0 ? ((latest.sell + latest.strongSell) / total) * 100 : 0;

  const upside = priceTarget.mean ? ((priceTarget.mean - currentPrice) / currentPrice) * 100 : 0;

  return (
    <div className="bg-panel border border-panel rounded p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Analyst Ratings</h2>

      <div className="flex gap-3 mb-4">
        <div className="flex-1 text-center p-2 bg-green/10 border border-gain/20 rounded">
          <div className="text-xl font-bold text-gain">{latest.buy + latest.strongBuy}</div>
          <div className="text-xs text-muted-foreground">Buy</div>
        </div>
        <div className="flex-1 text-center p-2 bg-amber/10 border border-amber/20 rounded">
          <div className="text-xl font-bold text-amber">{latest.hold}</div>
          <div className="text-xs text-muted-foreground">Hold</div>
        </div>
        <div className="flex-1 text-center p-2 bg-red/10 border border-loss/20 rounded">
          <div className="text-xl font-bold text-loss">{latest.sell + latest.strongSell}</div>
          <div className="text-xs text-muted-foreground">Sell</div>
        </div>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden mb-4">
        <div className="bg-gain" style={{ width: `${buyPct}%` }} />
        <div className="bg-amber" style={{ width: `${holdPct}%` }} />
        <div className="bg-loss" style={{ width: `${sellPct}%` }} />
      </div>

      <div className="border-t border-panel pt-3 space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Price Target</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono">{priceTarget.mean !== null ? formatMoney(priceTarget.mean, currency) : "—"}</span>
          {upside !== 0 && (
            <span className={`text-sm font-semibold flex items-center gap-1 ${upside > 0 ? "text-gain" : "text-loss"}`}>
              {upside > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {upside > 0 ? "+" : ""}{upside.toFixed(1)}% upside
            </span>
          )}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Low: <span className="text-loss font-mono">{priceTarget.low !== null ? formatMoney(priceTarget.low, currency) : "—"}</span></span>
          <span>Median: <span className="font-mono">{priceTarget.median !== null ? formatMoney(priceTarget.median, currency) : "—"}</span></span>
          <span>High: <span className="text-gain font-mono">{priceTarget.high !== null ? formatMoney(priceTarget.high, currency) : "—"}</span></span>
        </div>
      </div>
    </div>
  );
}
