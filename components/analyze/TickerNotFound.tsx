import Link from "next/link";
import { Search, TrendingUp } from "lucide-react";

const SUGGESTIONS = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "TSLA", "PLTR", "AMD"];

export function TickerNotFound({ ticker }: { ticker: string }) {
  return (
    // The testid is what lets the 30-stock acceptance matrix tell "this instrument resolved" from
    // "this page rendered". This surface returns HTTP 200, so a status check alone cannot: an
    // unknown symbol produced a 200 with a body, and the matrix counted it as a pass.
    <div className="min-h-[60vh] flex items-center justify-center px-4" data-testid="ticker-not-found">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-12 h-12 rounded-full bg-accent border border-border flex items-center justify-center mx-auto">
          <Search className="w-5 h-5 text-muted-foreground" />
        </div>

        <div>
          <h1 className="text-lg font-bold font-mono text-terminal">{ticker}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ticker not found. Check the symbol and try again.
          </p>
        </div>

        <div className="bg-panel border border-panel rounded p-4 text-left space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Try one of these</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((t) => (
              <Link
                key={t}
                href={`/analyze/${t}`}
                className="px-3 py-1 bg-accent border border-border rounded text-xs font-mono text-terminal hover:border-terminal/50 transition-colors"
              >
                {t}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex gap-3 justify-center">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-4 py-2 bg-terminal text-black text-xs font-bold rounded hover:bg-terminal/90 transition-colors"
          >
            <TrendingUp className="w-3 h-3" />
            Go to Dashboard
          </Link>
          <Link
            href="/watchlist"
            className="px-4 py-2 bg-accent border border-border text-xs rounded hover:border-terminal/30 transition-colors"
          >
            View Watchlist
          </Link>
        </div>
      </div>
    </div>
  );
}
