import Link from "next/link";
import { Activity, Database, Globe2 } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { IndexCard } from "@/components/dashboard/IndexCard";
import { MarketNewsFeed } from "@/components/dashboard/MarketNewsFeed";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { TopMoversPanel } from "@/components/dashboard/TopMoversPanel";
import { getMarketSession } from "@/lib/market/calendar";
import { INSTRUMENT_CATALOG, searchInstruments } from "@/lib/market/catalog";
import { getNormalizedQuote } from "@/lib/market/service";
import type { Exchange, NormalizedQuote } from "@/lib/market/types";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MarketView = "US" | "NSE" | "BSE";

const VIEW_CONFIG: Record<MarketView, { exchange: Exchange; label: string; subtitle: string }> = {
  US: { exchange: "XNAS", label: "United States", subtitle: "NASDAQ and NYSE cash equities" },
  NSE: { exchange: "XNSE", label: "NSE India", subtitle: "National Stock Exchange cash market" },
  BSE: { exchange: "XBOM", label: "BSE India", subtitle: "Bombay Stock Exchange cash market" },
};

const SECTORS: Record<MarketView, Record<string, string[]>> = {
  US: {
    Technology: ["US:XNAS:AAPL", "US:XNAS:MSFT", "US:XNAS:NVDA"],
    Consumer: ["US:XNAS:AMZN", "US:XNAS:TSLA", "US:XNAS:COST"],
    Financials: ["US:XNYS:JPM", "US:XNYS:V"],
    Energy: ["US:XNYS:XOM"],
    "Broad Market": ["US:XNYS:SPY", "US:XNAS:QQQ"],
  },
  NSE: {
    Technology: ["IN:XNSE:TCS", "IN:XNSE:INFY"],
    Banks: ["IN:XNSE:HDFCBANK", "IN:XNSE:ICICIBANK", "IN:XNSE:SBIN"],
    Consumer: ["IN:XNSE:ITC", "IN:XNSE:HINDUNILVR", "IN:XNSE:TITAN"],
    Industrials: ["IN:XNSE:LT", "IN:XNSE:ULTRACEMCO"],
    Energy: ["IN:XNSE:RELIANCE", "IN:XNSE:NTPC"],
    Auto: ["IN:XNSE:MARUTI", "IN:XNSE:TATAMOTORS"],
  },
  BSE: {
    Technology: ["IN:XBOM:532540", "IN:XBOM:500209"],
    Banks: ["IN:XBOM:500180", "IN:XBOM:532174", "IN:XBOM:500112"],
    Consumer: ["IN:XBOM:500875", "IN:XBOM:500696", "IN:XBOM:500820"],
    Industrials: ["IN:XBOM:500510"],
    Energy: ["IN:XBOM:500325"],
  },
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  const params = await searchParams;
  const view: MarketView = params.market === "NSE" || params.market === "BSE" ? params.market : "US";
  const config = VIEW_CONFIG[view];
  const primaryMarket = view === "US" ? "US" : "IN";
  const instruments = view === "US"
    ? INSTRUMENT_CATALOG.filter((instrument) => instrument.market === "US").slice(0, 20)
    : searchInstruments("", config.exchange).slice(0, 20);
  const provider = getProvider();
  // Quotes and news are independent, but news was awaited *after* the quote batch had already
  // resolved — so every render paid two full network round trips in series when one would do.
  // The quote fan-out is the slow half; news was queued behind it for no reason at all.
  const [quoteResults, news] = await Promise.all([
    Promise.allSettled(instruments.map((instrument) => getNormalizedQuote(instrument))),
    // Non-US views have no news source, and `Promise.all` needs a settled value rather than a
    // conditional await, or the branch would reintroduce the serialisation it just removed.
    view === "US" ? provider.getNews(undefined, 9).catch(() => []) : Promise.resolve([]),
  ]);
  const quotes = quoteResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const leaders = quotes.slice(0, 4);
  const sorted = [...quotes].sort((left, right) => (right.changePct ?? 0) - (left.changePct ?? 0));
  const gainers = sorted.slice(0, 5).map(toMover);
  const losers = sorted.slice(-5).reverse().map(toMover);
  const sectors = sectorBreadth(view, quotes);
  const status = getMarketSession(primaryMarket);

  return (
    <div className="min-h-screen bg-background">
      <AutoRefresh intervalMs={30_000} />
      <div className="max-w-screen-2xl mx-auto px-4 py-5 space-y-4">
        <section className="market-hero rise-1">
          <div>
            <p className="terminal-kicker">MKT / {config.exchange}</p>
            <h1>{config.label}</h1>
            <p>{config.subtitle}</p>
          </div>
          <div className="market-hero-status">
            <span className={status.session === "REGULAR" ? "status-dot status-dot-live" : "status-dot"} />
            <div>
              <strong>{status.session.replace("_", " ")}</strong>
              <small>{status.localTime} · {status.timezone}</small>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 rise-2">
          {leaders.map((quote) => (
            <IndexCard
              key={quote.instrument.id}
              ticker={quote.instrument.symbol}
              label={quote.instrument.name}
              quote={quote}
              currency={quote.currency}
              instrumentId={quote.instrument.id}
            />
          ))}
        </div>

        {!quotes.length && (
          <div className="inline-notice inline-notice-warning">
            <Database className="w-4 h-4" /> No eligible quotes are available from the configured research source.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
          <SectorHeatmap sectors={sectors} />
          <TopMoversPanel gainers={gainers} losers={losers} />
        </div>

        <section className="terminal-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-terminal" />
              <h2 className="text-xs font-bold uppercase tracking-wider">Research queue</h2>
            </div>
            <span className="text-[11px] text-muted-foreground">CANONICAL INSTRUMENTS · NATIVE CURRENCY</span>
          </div>
          <div className="research-queue">
            {instruments.slice(0, 10).map((instrument) => (
              <Link key={instrument.id} href={`/analyze/${encodeURIComponent(instrument.id)}`}>
                <span>{instrument.symbol}</span>
                <small>{instrument.exchange} · {instrument.currency}</small>
              </Link>
            ))}
          </div>
        </section>

        <MarketNewsFeed news={news} />

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Globe2 className="w-3.5 h-3.5" />
          Yahoo-derived research data may be delayed. Source quality is shown on detailed evidence screens.
        </div>
      </div>
    </div>
  );
}

function toMover(quote: NormalizedQuote) {
  return {
    ticker: quote.instrument.symbol,
    name: quote.instrument.name,
    price: quote.price,
    change: quote.change ?? 0,
    changePct: quote.changePct ?? 0,
    currency: quote.currency,
    instrumentId: quote.instrument.id,
  };
}

function sectorBreadth(view: MarketView, quotes: NormalizedQuote[]) {
  const byId = new Map(quotes.map((quote) => [quote.instrument.id, quote]));
  return Object.entries(SECTORS[view]).flatMap(([sector, ids]) => {
    const available = ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
    if (!available.length) return [];
    return [{
      sector,
      changePct: available.reduce((sum, quote) => sum + (quote.changePct ?? 0), 0) / available.length,
    }];
  });
}
