import Link from "next/link";
import { parseInstrument } from "@/lib/market/instruments";
import { getNormalizedQuote } from "@/lib/market/service";

const TAPE_INSTRUMENTS = [
  "US:XNAS:AAPL",
  "US:XNAS:MSFT",
  "US:XNAS:NVDA",
  "US:XNYS:SPY",
  "IN:XNSE:RELIANCE",
  "IN:XNSE:TCS",
  "IN:XNSE:HDFCBANK",
  "IN:XNSE:NIFTYBEES",
];

export async function TickerTape() {
  const settled = await Promise.allSettled(
    TAPE_INSTRUMENTS.map((id) => getNormalizedQuote(parseInstrument(id))),
  );
  const quotes = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);

  // Never vanish. The tape disappearing silently when the quote source rate-limits reads as
  // the app being broken; a visible degraded strip reads as the data being degraded — which
  // is the truth.
  if (!quotes.length) {
    return (
      <div className="ticker-tape" aria-label="US and India market tape">
        <div className="ticker-degraded">
          <span className="pulse-amber ticker-degraded-dot" aria-hidden="true" />
          MARKET TAPE DEGRADED — no eligible quotes from the configured source; retrying on next refresh
        </div>
      </div>
    );
  }

  return (
    <div className="ticker-tape" aria-label="US and India market tape">
      <div className="animate-ticker">
        {[...quotes, ...quotes].map((quote, index) => {
          const gain = (quote.changePct ?? 0) >= 0;
          return (
            <span key={`${quote.instrument.id}-${index}`} className="ticker-item">
              <Link href={`/analyze/${encodeURIComponent(quote.instrument.id)}`}>
                <span className="ticker-exchange">{quote.instrument.exchange === "XNSE" ? "NSE" : quote.instrument.exchange === "XBOM" ? "BSE" : "US"}</span>
                {quote.instrument.symbol}
              </Link>
              <span>{formatMoney(quote.price, quote.currency)}</span>
              <span className={gain ? "text-gain" : "text-loss"}>
                {gain ? "+" : ""}{(quote.changePct ?? 0).toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function formatMoney(value: number, currency: "USD" | "INR") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
