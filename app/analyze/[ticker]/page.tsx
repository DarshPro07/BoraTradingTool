import Link from "next/link";
import { BrainCircuit, FlaskConical } from "lucide-react";
import { buildResearchSnapshot } from "@/lib/market/service";
import { parseInstrument } from "@/lib/market/instruments";
import { writeStockContext } from "@/lib/data/context-writer";
import type { Quote } from "@/lib/providers/types";
import { QuoteHeader } from "@/components/analyze/QuoteHeader";
import { CandlestickChart } from "@/components/chart/CandlestickChart";
import { TechnicalsPanel } from "@/components/analyze/TechnicalsPanel";
import { FundamentalsPanel } from "@/components/analyze/FundamentalsPanel";
import { AnalystPanel } from "@/components/analyze/AnalystPanel";
import { EarningsPanel } from "@/components/analyze/EarningsPanel";
import { InsiderPanel } from "@/components/analyze/InsiderPanel";
import { NewsPanel } from "@/components/analyze/NewsPanel";
import { ResearchReport } from "@/components/analyze/ResearchReport";
import { ClaudePromptBlock } from "@/components/analyze/ClaudePromptBlock";
import { TickerNotFound } from "@/components/analyze/TickerNotFound";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AnalyzePage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  try {
    const instrument = parseInstrument(decodeURIComponent(rawTicker));
    const snapshot = await buildResearchSnapshot(instrument);
    const quote: Quote = {
      ticker: instrument.symbol,
      price: snapshot.quote.price,
      open: snapshot.quote.open ?? 0,
      high: snapshot.quote.high ?? 0,
      low: snapshot.quote.low ?? 0,
      prevClose: snapshot.quote.previousClose ?? 0,
      change: snapshot.quote.change ?? 0,
      changePct: snapshot.quote.changePct ?? 0,
      volume: snapshot.quote.volume ?? 0,
      avgVolume: snapshot.quote.volume ?? 0,
      fetchedAt: new Date(snapshot.quote.provenance.ingestedAt),
      sourceEventAt: snapshot.quote.provenance.sourceEventAt ? new Date(snapshot.quote.provenance.sourceEventAt) : undefined,
      provider: snapshot.quote.provenance.provider === "TEST_FIXTURE" ? "TEST_FIXTURE" : "YAHOO",
      mock: false,
    };

    void writeStockContext(instrument.id, {
      quote,
      candles: snapshot.candles.candles,
      profile: snapshot.profile,
      fundamentals: snapshot.fundamentals,
      analystRatings: snapshot.analystRatings,
      priceTarget: snapshot.priceTarget,
      earnings: snapshot.earnings,
      insider: snapshot.insider,
      news: snapshot.news,
      tech: snapshot.technicals,
      bullSignals: snapshot.signals.bull,
      bearSignals: snapshot.signals.bear,
      overallSignal: snapshot.signals.overall,
    }).catch(() => undefined);

    return (
      <div className="min-h-screen bg-background">
        <AutoRefresh intervalMs={30_000} />
        <div className="max-w-screen-2xl mx-auto px-4 py-4 space-y-4">
          <div className="flex flex-wrap gap-2 justify-end">
            <Link href={`/ai?instrument=${encodeURIComponent(instrument.id)}`} className="secondary-action">
              <BrainCircuit className="w-4 h-4" /> Analyze with AI
            </Link>
            <Link href={`/paper?instrument=${encodeURIComponent(instrument.id)}`} className="secondary-action">
              <FlaskConical className="w-4 h-4" /> Open paper ticket
            </Link>
          </div>

          <QuoteHeader
            quote={quote}
            profile={{ ...snapshot.profile, exchange: instrument.exchange }}
            overallSignal={snapshot.signals.overall}
            instrumentId={instrument.id}
            currency={instrument.currency}
          />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <CandlestickChart
              ticker={instrument.providerSymbol}
              initialCandles={snapshot.candles.candles}
              quotePrice={quote.price}
              sma20={snapshot.technicals.sma20}
              sma50={snapshot.technicals.sma50}
              sma200={snapshot.technicals.sma200}
              candleProvider={snapshot.candles.provenance.provider}
            />
            <TechnicalsPanel tech={snapshot.technicals} price={quote.price} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <FundamentalsPanel fundamentals={snapshot.fundamentals} quote={quote} />
            <AnalystPanel ratings={snapshot.analystRatings} priceTarget={snapshot.priceTarget} currentPrice={quote.price} />
            <EarningsPanel earnings={snapshot.earnings} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <InsiderPanel transactions={snapshot.insider} />
            <NewsPanel news={snapshot.news} />
          </div>

          <ResearchReport
            ticker={instrument.symbol}
            quote={quote}
            tech={snapshot.technicals}
            fundamentals={snapshot.fundamentals}
            bullSignals={snapshot.signals.bull}
            bearSignals={snapshot.signals.bear}
            overallSignal={snapshot.signals.overall}
            priceTarget={snapshot.priceTarget}
          />

          <ClaudePromptBlock instrumentId={instrument.id} symbol={instrument.symbol} price={quote.price} currency={instrument.currency} signal={snapshot.signals.overall} />
          <p className="text-xs text-muted-foreground text-center pb-4">
            Decision support only. Provider data and model output may be delayed or incomplete.
          </p>
        </div>
      </div>
    );
  } catch (error) {
    console.error("analyze page error", error);
    return <TickerNotFound ticker={rawTicker?.toUpperCase() ?? "?"} />;
  }
}
