import type { MarketMover } from "@/lib/providers/types";
import Link from "next/link";

interface Props {
  gainers: DisplayMover[];
  losers: DisplayMover[];
}

type DisplayMover = MarketMover & { currency?: "USD" | "INR"; instrumentId?: string };

function MoverRow({ mover, isGain }: { mover: DisplayMover; isGain: boolean }) {
  return (
    <Link href={`/analyze/${encodeURIComponent(mover.instrumentId ?? mover.ticker)}`} className="flex items-center justify-between py-1.5 hover:bg-accent px-1 rounded transition-colors">
      <div>
        <span className="text-xs font-semibold text-terminal">{mover.ticker}</span>
        <span className="text-xs text-muted-foreground ml-1.5 truncate max-w-[100px] inline-block">{mover.name}</span>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono">{formatMoney(mover.price, mover.currency ?? "USD")}</div>
        <div className={`text-xs font-semibold ${isGain ? "text-gain" : "text-loss"}`}>
          {isGain ? "+" : ""}{mover.changePct.toFixed(2)}%
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

export function TopMoversPanel({ gainers, losers }: Props) {
  return (
    <div className="terminal-panel rise-3 p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Top Movers</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-gain mb-2">▲ Gainers</h3>
          {gainers.map((m) => <MoverRow key={m.ticker} mover={m} isGain />)}
          {!gainers.length && <p className="text-xs text-muted-foreground">Unavailable</p>}
        </div>
        <div>
          <h3 className="text-xs font-semibold text-loss mb-2">▼ Losers</h3>
          {losers.map((m) => <MoverRow key={m.ticker} mover={m} isGain={false} />)}
          {!losers.length && <p className="text-xs text-muted-foreground">Unavailable</p>}
        </div>
      </div>
    </div>
  );
}
