import { getProvider } from "@/lib/providers";
import { getDb, schema } from "@/lib/db";
import { listCurrentInstruments } from "@/lib/market/catalog";
import { WatchlistManager, type WatchlistEntry } from "@/components/watchlist/WatchlistManager";

export const dynamic = "force-dynamic";

// Static thesis data for well-known tickers
const TICKER_META: Record<string, Pick<WatchlistEntry, "thesis" | "catalysts" | "riskLevel">> = {
  NVDA: { catalysts: ["AI GPU demand", "Data center expansion", "Blackwell ramp"], riskLevel: "medium", thesis: "Dominant AI compute supplier. Blackwell cycle driving supercycle in data center GPU spend." },
  MSFT: { catalysts: ["Copilot monetization", "Azure AI growth", "OpenAI leverage"], riskLevel: "low", thesis: "Best-positioned large cap for enterprise AI adoption via Azure + Copilot at scale." },
  META: { catalysts: ["Llama 4 release", "Ad revenue AI boost", "Ray-Ban glasses"], riskLevel: "medium", thesis: "Year of efficiency paid off. AI ad targeting driving margin expansion while Llama opens platform moat." },
  AMD:  { catalysts: ["MI300X ramp", "EPYC server share gains", "AI PC"], riskLevel: "high", thesis: "Best alternative GPU play. MI300X demand strong but execution risk vs NVDA's ecosystem lock-in." },
  PLTR: { catalysts: ["US government AI contracts", "AIP commercial adoption", "Boot camps"], riskLevel: "high", thesis: "AIP platform is genuinely differentiated. High multiple demands flawless execution and continued contract wins." },
  CRM:  { catalysts: ["Agentforce launch", "Einstein AI features", "Data Cloud"], riskLevel: "medium", thesis: "Agentforce is early but compelling. CRM data advantage positions Salesforce well for enterprise AI agent layer." },
  AAPL: { catalysts: ["Apple Intelligence features", "iPhone 16 cycle", "Services growth"], riskLevel: "low", thesis: "Apple Intelligence could re-accelerate the upgrade cycle. Services gross margins improving steadily." },
  GOOGL: { catalysts: ["Gemini monetization", "Search AI Overviews", "YouTube growth"], riskLevel: "medium", thesis: "Search AI concern overhyped — Gemini integration in Search maintains moat. Valuation discount to peers creates opportunity." },
};

// Default tickers to seed on first run
const DEFAULT_TICKERS = ["NVDA", "MSFT", "META", "AMD", "PLTR", "CRM", "AAPL", "GOOGL"];

export default async function WatchlistPage() {
  const db = getDb();

  // Seed defaults if watchlist is empty
  const existing = db.select().from(schema.userWatchlist).all();
  if (existing.length === 0) {
    for (const ticker of DEFAULT_TICKERS) {
      db.insert(schema.userWatchlist)
        .values({ ticker, addedAt: new Date() })
        .onConflictDoNothing()
        .run();
    }
  }

  const watchlistRows = db.select().from(schema.userWatchlist).all();
  const tickers = watchlistRows.map((r) => r.ticker);

  // Fetch quotes for all tickers in parallel
  const provider = getProvider();
  const quoteResults = await Promise.allSettled(tickers.map((t) => provider.getQuote(t)));

  // The watchlist stores bare symbols; /analyze needs a canonical id with its exchange. Resolved
  // here rather than guessed in the link, and left undefined when the catalog has no match so a
  // missing instrument is visible instead of producing a URL that 500s on arrival.
  const idBySymbol = new Map(listCurrentInstruments().map((instrument) => [instrument.symbol, instrument.id]));

  const entries: WatchlistEntry[] = tickers.map((ticker, i) => ({
    ticker,
    instrumentId: idBySymbol.get(ticker),
    quote: quoteResults[i].status === "fulfilled" ? quoteResults[i].value : null,
    ...TICKER_META[ticker],
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-screen-2xl mx-auto px-4 py-4">
        <WatchlistManager entries={entries} />
      </div>
    </div>
  );
}
