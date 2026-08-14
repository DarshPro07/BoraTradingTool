import { emit } from "@/lib/brain/event-bus";
import { loadStoredCandles, persistCandles, recordDatasetImport } from "@/lib/market/candle-store";
import type { ImportedCandle } from "@/lib/market/dataset-import";
import { resolveInstrument } from "@/lib/market/instruments";
import { findNseInstrument } from "@/lib/market/security-master";
import { getNormalizedCandles } from "@/lib/market/service";
import { MIN_BARS_FOR_RESEARCH } from "@/lib/research/bridge";

/**
 * In-product historical ingestion.
 *
 * ## The gap this closes
 *
 * `researchInstrument` refuses an instrument whose canonical store holds fewer than
 * `MIN_BARS_FOR_RESEARCH` daily bars, with `NO_STORED_DATA`. That refusal is CORRECT and is not
 * softened here — researching an instrument the system cannot see would be exactly the fabrication
 * the product forbids.
 *
 * The defect was that the product offered no way out of it. The only route to history was two
 * manual steps performed outside the application:
 *
 *   1. `python quant/nse_history.py`   → writes nse-daily.json
 *   2. `npx tsx scripts/import-nse-history.mts` → persistCandles + recordDatasetImport
 *
 * A capability that requires the user to run a CLI and know an internal file path is not a
 * capability the product has. So a fresh database could refuse forever, and the refusal blocked
 * BOTH 30-stock research breadth and the UI-first Golden Journey (whose research→strategy handoff
 * only enables on a verified run, which cannot happen without bars).
 *
 * ## What is deliberately preserved
 *
 * The CLI import's honest declarations travel with these bars unchanged. `adjustment: "raw"` and
 * `includesDelisted: false` are what make the dataset **unfit for validation**, and that
 * declaration — not the bars — is the reason the import exists. Ingesting through the product must
 * not launder a survivorship-biased, unadjusted sample into something that looks promotable.
 *
 * ## What this does NOT do
 *
 * It does not invent bars. If the source returns nothing, or returns fewer bars than the research
 * floor requires, it says so and the instrument stays un-researchable. A short read is reported,
 * never padded.
 */

/** Roughly two years of sessions — enough for the 60-bar floor with real slack. */
const LOOKBACK_SECONDS = 730 * 86_400;

export type IngestCode =
  | "INGESTED"
  | "ALREADY_READY"
  | "INSTRUMENT_UNKNOWN"
  | "SOURCE_UNAVAILABLE"
  | "INSUFFICIENT_SOURCE_BARS";

export interface IngestOutcome {
  ok: boolean;
  code: IngestCode;
  message: string;
  instrumentId: string | null;
  /** Bars held before this call — the number the refusal was based on. */
  storedBefore: number;
  /** Bars held after it. Equal to `storedBefore` whenever nothing was written. */
  storedAfter: number;
  required: number;
  /** Whether the instrument is now researchable. The single question the caller has. */
  ready: boolean;
  inserted: number;
  skipped: number;
  rejected: number;
  source: string | null;
  /** Why the persisted sample may be explored but never used to promote a strategy. */
  unfitForValidation: string | null;
}

const UNFIT_FOR_VALIDATION =
  "Unadjusted prices and currently-listed symbols only: a split reads as a price cliff, and the " +
  "absence of delisted names makes every result optimistic by an unknown amount. Usable for " +
  "exploring an idea, not for promoting one.";

function countStored(instrumentId: string): number {
  try {
    return loadStoredCandles(instrumentId, "D").length;
  } catch {
    // A store read that fails is not evidence of zero bars, but it is evidence we cannot claim
    // readiness. Reporting 0 here makes the caller re-ingest rather than assume.
    return 0;
  }
}

/**
 * Fetch, validate and persist daily history for one instrument, then report real readiness.
 *
 * Idempotent by construction: `persistCandles` skips bars already held, so calling this twice
 * inserts nothing the second time and returns `ALREADY_READY`.
 */
export async function ingestInstrumentHistory(rawInstrumentId: string): Promise<IngestOutcome> {
  const empty = {
    storedBefore: 0,
    storedAfter: 0,
    required: MIN_BARS_FOR_RESEARCH,
    ready: false,
    inserted: 0,
    skipped: 0,
    rejected: 0,
    source: null,
    unfitForValidation: null,
  };

  let instrument;
  try {
    instrument = resolveInstrument(rawInstrumentId);
  } catch (caught) {
    return {
      ok: false,
      code: "INSTRUMENT_UNKNOWN",
      message: caught instanceof Error ? caught.message : `Cannot resolve ${rawInstrumentId}.`,
      instrumentId: null,
      ...empty,
    };
  }

  /**
   * An NSE instrument must exist in the official security master before history is written for it.
   *
   * `resolveInstrument` parses SYNTAX and falls back to the parsed id when the master has no match
   * (`findNseInstrument(parsed.id) ?? parsed`), so a well-formed but never-listed symbol such as
   * `IN:XNSE:NOT-A-REAL-ZZZ` resolves happily. That is right for the resolver — but writing candle
   * rows for a symbol NSE never listed would put a phantom instrument into the canonical store,
   * and canonical identity is supposed to come from the exchange's own master (§34), not from
   * whatever string a caller could spell correctly.
   *
   * Checked only for XNSE, because that is the exchange whose master this system holds.
   */
  if (instrument.exchange === "XNSE" && !findNseInstrument(instrument.id)) {
    return {
      ok: false,
      code: "INSTRUMENT_UNKNOWN",
      message:
        `${instrument.id} is well-formed but is not in the NSE security master, so there is no ` +
        "canonical security to attach history to. Ingesting it would create a phantom instrument " +
        "in the canonical store.",
      instrumentId: null,
      ...empty,
    };
  }

  const storedBefore = countStored(instrument.id);
  if (storedBefore >= MIN_BARS_FOR_RESEARCH) {
    return {
      ok: true,
      code: "ALREADY_READY",
      message:
        `The canonical store already holds ${storedBefore} daily bars for ${instrument.id}; ` +
        `${MIN_BARS_FOR_RESEARCH} are required. Nothing to ingest.`,
      instrumentId: instrument.id,
      ...empty,
      storedBefore,
      storedAfter: storedBefore,
      ready: true,
    };
  }

  const to = Math.floor(Date.now() / 1000);
  let fetched;
  try {
    fetched = await getNormalizedCandles(instrument, "D", to - LOOKBACK_SECONDS, to);
  } catch (caught) {
    return {
      ok: false,
      code: "SOURCE_UNAVAILABLE",
      message:
        `No source could supply daily history for ${instrument.id}: ` +
        `${caught instanceof Error ? caught.message : String(caught)}. ` +
        "The store is unchanged and the instrument remains un-researchable.",
      instrumentId: instrument.id,
      ...empty,
      storedBefore,
      storedAfter: storedBefore,
    };
  }

  // Re-validate at the boundary rather than trusting the provider. A bar that reaches the store is
  // indistinguishable from history forever after — the same reasoning as the CLI importer.
  const candles: ImportedCandle[] = [];
  let rejected = 0;
  for (const bar of fetched.candles) {
    const finite = [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value));
    if (!finite || bar.high < bar.low || !Number.isFinite(bar.time)) {
      rejected += 1;
      continue;
    }
    candles.push({
      ticker: instrument.id,
      resolution: "D",
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : null,
    });
  }

  const source = fetched.provenance?.provider ?? "unknown";

  if (candles.length === 0) {
    return {
      ok: false,
      code: "SOURCE_UNAVAILABLE",
      message:
        `${source} returned no usable daily bars for ${instrument.id} ` +
        `(${rejected} rejected as malformed). The store is unchanged.`,
      instrumentId: instrument.id,
      ...empty,
      storedBefore,
      storedAfter: storedBefore,
      rejected,
      source,
    };
  }

  const result = persistCandles(candles);
  const storedAfter = countStored(instrument.id);

  // The wake signal. New canonical bars are the event that matures forecasts and satisfies data
  // dependencies, so their arrival is announced rather than discovered by the next poll. Emitted
  // only when something was actually written — an ingest that inserted nothing changed nothing.
  if (result.inserted > 0) {
    emit({ kind: "DATA_INGESTED", instrumentId: instrument.id, bars: result.inserted, source });
  }

  recordDatasetImport(
    {
      source: `${source} daily history (in-product ingestion)`,
      license: null,
      // "raw", not "adjusted": the prices that actually traded. An adjusted series carries
      // information from after the bar.
      adjustment: "raw",
      includesDelisted: false,
      resolution: "D",
    },
    { inserted: result.inserted, skipped: result.skipped, rejected, unfitForValidation: UNFIT_FOR_VALIDATION },
    "in-product-ingestion",
  );

  const ready = storedAfter >= MIN_BARS_FOR_RESEARCH;

  return {
    ok: ready,
    // A short read is reported as its own outcome. Padding it, or calling it success because bars
    // were written, would put the instrument back in the refusal state with no explanation.
    code: ready ? "INGESTED" : "INSUFFICIENT_SOURCE_BARS",
    message: ready
      ? `Ingested ${result.inserted} daily bar(s) for ${instrument.id} from ${source}; the store now ` +
        `holds ${storedAfter} and ${MIN_BARS_FOR_RESEARCH} are required. Research is now possible. ` +
        `The dataset is declared unfit for validation — ${UNFIT_FOR_VALIDATION}`
      : `${source} supplied only ${storedAfter} daily bar(s) for ${instrument.id}; ` +
        `${MIN_BARS_FOR_RESEARCH} are required. The instrument remains un-researchable — a short ` +
        "history is reported, never padded.",
    instrumentId: instrument.id,
    storedBefore,
    storedAfter,
    required: MIN_BARS_FOR_RESEARCH,
    ready,
    inserted: result.inserted,
    skipped: result.skipped,
    rejected,
    source,
    unfitForValidation: UNFIT_FOR_VALIDATION,
  };
}

/** Readiness without side effects, for a surface that needs to ask before it acts. */
export function instrumentReadiness(rawInstrumentId: string): {
  instrumentId: string | null;
  /**
   * Whether the exchange's own master actually lists this security. A syntactically valid id is
   * not the same thing as a real instrument, and reporting `ready: false` without saying which of
   * the two reasons applies would send a caller to ingest something that can never exist.
   */
  known: boolean;
  stored: number;
  required: number;
  ready: boolean;
} {
  try {
    const instrument = resolveInstrument(rawInstrumentId);
    const known = instrument.exchange !== "XNSE" || Boolean(findNseInstrument(instrument.id));
    const stored = countStored(instrument.id);
    return {
      instrumentId: instrument.id,
      known,
      stored,
      required: MIN_BARS_FOR_RESEARCH,
      ready: known && stored >= MIN_BARS_FOR_RESEARCH,
    };
  } catch {
    return {
      instrumentId: null,
      known: false,
      stored: 0,
      required: MIN_BARS_FOR_RESEARCH,
      ready: false,
    };
  }
}
