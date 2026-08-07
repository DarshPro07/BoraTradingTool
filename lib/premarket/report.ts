import { INSTRUMENT_CATALOG, searchInstruments } from "@/lib/market/catalog";
import { getMarketPhase, UNAVAILABLE_PREMARKET_INPUTS, type PhaseReading } from "@/lib/market/phases";
import { getNormalizedQuote } from "@/lib/market/service";
import type { Instrument, Market, NormalizedQuote } from "@/lib/market/types";

/**
 * Pre-market report for one market.
 *
 * Deliberately narrow. It reports the overnight move and where it sits against the rest of the
 * board, because that is what the configured data sources genuinely support. It does not
 * report auction imbalance, ban lists or price bands, because this deployment has no
 * entitlement to any of them — and a report that silently omits the F&O ban list reads exactly
 * like one where nothing was banned.
 *
 * So every report carries `unavailable`. What the system could not see is part of the answer.
 */

export interface GapRow {
  instrumentId: string;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  /** Percent change against the prior official close, as supplied by the provider. */
  gapPct: number;
}

export interface PreMarketReport {
  market: Market;
  phase: PhaseReading;
  /** Instruments sorted by the size of the overnight move, largest absolute first. */
  gaps: GapRow[];
  breadth: { advancing: number; declining: number; unchanged: number; medianGapPct: number };
  /** Instruments that were requested but produced no usable quote, and why that matters. */
  missingQuotes: string[];
  unavailable: typeof UNAVAILABLE_PREMARKET_INPUTS;
  generatedAt: string;
  /** Plain statement of what this report can and cannot support a decision about. */
  caveat: string;
}

const UNIVERSE_SIZE = 20;

function universe(market: Market) {
  return market === "US"
    ? INSTRUMENT_CATALOG.filter((instrument) => instrument.market === "US").slice(0, UNIVERSE_SIZE)
    : searchInstruments("", "XNSE").slice(0, UNIVERSE_SIZE);
}

function toGapRow(quote: NormalizedQuote): GapRow | null {
  // A zero price is a provider fault, not a free stock. Dropping it is safer than ranking it.
  if (!quote.price || !Number.isFinite(quote.price)) return null;
  return {
    instrumentId: quote.instrument.id,
    symbol: quote.instrument.symbol,
    name: quote.instrument.name,
    price: quote.price,
    currency: quote.currency,
    gapPct: quote.changePct ?? 0,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * `fetchQuote` is injected rather than mocked. The provider fixture in `lib/market/service`
 * hands every instrument the same +0.5% change and cannot fail, so it can prove neither that
 * gaps rank correctly nor that a provider fault costs one row instead of the report — which is
 * the only behaviour here worth testing.
 */
export async function buildPreMarketReport(
  market: Market,
  now = new Date(),
  fetchQuote: (instrument: Instrument) => Promise<NormalizedQuote> = getNormalizedQuote,
): Promise<PreMarketReport> {
  const phase = getMarketPhase(market, now);
  const instruments = universe(market);

  // Settled, not all: one provider failure should cost that instrument's row, not the report.
  const settled = await Promise.allSettled(instruments.map((instrument) => fetchQuote(instrument)));

  const gaps: GapRow[] = [];
  const missingQuotes: string[] = [];
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      missingQuotes.push(instruments[index].symbol);
      return;
    }
    const row = toGapRow(result.value);
    if (row) gaps.push(row);
    else missingQuotes.push(instruments[index].symbol);
  });

  gaps.sort((left, right) => Math.abs(right.gapPct) - Math.abs(left.gapPct));

  const relevant = UNAVAILABLE_PREMARKET_INPUTS.filter(
    (entry) => entry.market === market || entry.market === "BOTH",
  );

  return {
    market,
    phase,
    gaps,
    breadth: {
      advancing: gaps.filter((row) => row.gapPct > 0).length,
      declining: gaps.filter((row) => row.gapPct < 0).length,
      unchanged: gaps.filter((row) => row.gapPct === 0).length,
      medianGapPct: median(gaps.map((row) => row.gapPct)),
    },
    missingQuotes,
    unavailable: relevant,
    generatedAt: now.toISOString(),
    caveat:
      phase.phase === "REGULAR"
        ? "The session is open; these moves are intraday, not overnight gaps."
        : `${relevant.length} pre-market input(s) are unavailable to this deployment. Treat this as an overnight-move summary, not a complete pre-market picture.`,
  };
}
