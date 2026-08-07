import type { ImportedCandle } from "./dataset-import";

/**
 * Parsing a downloaded OHLCV file into candle rows.
 *
 * CSV only. Parquet needs a binary reader and this application has no dependency that can do it —
 * saying so is better than a half-parser that mangles a column and produces plausible prices.
 * Convert with `pandas.read_parquet(...).to_csv(...)` before importing.
 *
 * ## Why column mapping is the hard part
 *
 * Every published OHLCV dump names its columns differently — `Date`, `Datetime`, `timestamp`,
 * `time`, `Open`, `open`, `OPEN`, `Adj Close`, `close_price`. A parser that demands one spelling
 * fails on most real files; one that guesses loosely will happily map `Adj Close` onto `close`
 * and hand a back-adjusted series to the backtest without anyone noticing.
 *
 * So: aliases are explicit and closed, matching is case- and separator-insensitive, and an
 * ambiguous or missing column is a **refusal with the header printed**, never a silent default.
 */

export interface ParseOptions {
  /** Used when the file has no ticker column, which is usual for single-symbol dumps. */
  defaultTicker?: string;
  resolution: string;
}

export interface ParseResult {
  rows: Partial<ImportedCandle>[];
  /** Header names as found, so a refusal can show what the file actually contained. */
  header: string[];
  /** Set when the file cannot be parsed at all. `rows` is empty when this is present. */
  error: string | null;
  /**
   * Columns present in the file that this parser ignored. Reported because a dataset carrying
   * `adj_close` alongside `close` is telling you something about its adjustment status.
   */
  ignored: string[];
}

/** Closed alias lists. Adding a spelling is a decision, not something a regex does silently. */
const ALIASES: Record<string, readonly string[]> = {
  time: ["date", "datetime", "timestamp", "time", "dateandtime", "datetimeutc"],
  open: ["open", "openprice", "o"],
  high: ["high", "highprice", "h"],
  low: ["low", "lowprice", "l"],
  close: ["close", "closeprice", "c", "last", "lastprice"],
  volume: ["volume", "vol", "v", "quantity", "qty"],
  ticker: ["ticker", "symbol", "instrument", "name", "scrip", "tradingsymbol"],
};

/**
 * Deliberately absent from `close`'s aliases.
 *
 * `Adj Close` is the back-adjusted price — the exact quantity `dataset-import` refuses for
 * validation. Mapping it to `close` would defeat that check at the parsing layer, one file
 * earlier than anyone is looking.
 */
const ADJUSTED_MARKERS = ["adjclose", "adjustedclose", "adjopen", "adjustedopen"];

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-.]/g, "");
}

/**
 * Split one CSV line, honouring double-quoted fields.
 *
 * Written rather than imported because the alternative is a dependency for forty lines, and
 * `split(",")` is wrong the moment a company name contains a comma — which, in an Indian equity
 * dataset, it frequently does.
 */
function splitLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      fields.push(current);
      current = "";
    } else current += character;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Interpret a timestamp cell.
 *
 * Handles the four forms these files use: unix seconds, unix milliseconds, ISO 8601, and
 * `YYYY-MM-DD HH:MM:SS`. Returns null rather than guessing — an unparseable date must cost its
 * row, because a wrong one silently reorders the series.
 */
export function parseTime(raw: string): number | null {
  const value = raw.trim();
  if (value.length === 0) return null;

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    // Thirteen digits is milliseconds; ten is seconds. A millisecond value read as seconds lands
    // in the year 33,000 and sorts after everything, which reads as a gap rather than an error.
    if (value.length >= 12) return Math.floor(numeric / 1000);
    return numeric;
  }

  // `YYYY-MM-DD HH:MM:SS` is not ISO 8601 (no `T`) and Date.parse treats it as *local* time in
  // some runtimes and UTC in others. Normalised explicitly so an import is not timezone-dependent.
  const spaced = /^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2}(:\d{2})?)$/.exec(value);
  const candidate = spaced ? `${spaced[1]}T${spaced[2]}${spaced[3] ? "" : ":00"}Z` : value;

  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // Indian datasets frequently carry thousands separators inside quoted fields.
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned.length === 0) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export function parseCandleCsv(text: string, options: ParseOptions): ParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], header: [], error: "The file has no data rows.", ignored: [] };
  }

  const header = splitLine(lines[0]);
  const normalised = header.map(normaliseHeader);

  const indexOf = (field: string): number => {
    const aliases = ALIASES[field];
    for (let column = 0; column < normalised.length; column += 1) {
      if (aliases.includes(normalised[column])) return column;
    }
    return -1;
  };

  const columns = {
    time: indexOf("time"),
    open: indexOf("open"),
    high: indexOf("high"),
    low: indexOf("low"),
    close: indexOf("close"),
    volume: indexOf("volume"),
    ticker: indexOf("ticker"),
  };

  const missing = (["time", "open", "high", "low", "close"] as const).filter((field) => columns[field] < 0);
  if (missing.length > 0) {
    return {
      rows: [],
      header,
      error: `Missing required column(s): ${missing.join(", ")}. Header was: ${header.join(", ")}`,
      ignored: [],
    };
  }

  if (columns.ticker < 0 && !options.defaultTicker) {
    return {
      rows: [],
      header,
      error: "The file has no ticker column and no defaultTicker was supplied, so the bars cannot be attributed to an instrument.",
      ignored: [],
    };
  }

  const mapped = new Set(Object.values(columns).filter((column) => column >= 0));
  const ignored = header.filter((_, column) => !mapped.has(column));

  const rows: Partial<ImportedCandle>[] = lines.slice(1).map((line) => {
    const fields = splitLine(line);
    const time = parseTime(fields[columns.time] ?? "");
    return {
      ticker: columns.ticker >= 0 ? fields[columns.ticker] || options.defaultTicker : options.defaultTicker,
      resolution: options.resolution,
      // `undefined` rather than a fallback: `importCandles` rejects the row and says why, which
      // is the behaviour a malformed line should have.
      time: time ?? undefined,
      open: toNumber(fields[columns.open]),
      high: toNumber(fields[columns.high]),
      low: toNumber(fields[columns.low]),
      close: toNumber(fields[columns.close]),
      volume: columns.volume >= 0 ? toNumber(fields[columns.volume]) : undefined,
    };
  });

  return { rows, header, error: null, ignored };
}

/**
 * Whether the header suggests the file carries adjusted prices.
 *
 * A hint, not a verdict — the owner still declares `adjustment` explicitly. But a file with an
 * `Adj Close` column almost certainly has adjusted data somewhere in it, and surfacing that at
 * import time is cheaper than discovering it in a backtest that looked unusually good.
 */
export function suggestsAdjustedPrices(header: readonly string[]): boolean {
  return header.map(normaliseHeader).some((name) => ADJUSTED_MARKERS.includes(name));
}
