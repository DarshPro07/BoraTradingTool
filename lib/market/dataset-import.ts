/**
 * Importing a static OHLCV dataset — HuggingFace, Kaggle, or any CSV dump.
 *
 * Why this exists: the backtest engine fetches candles live from Yahoo, which caps intraday
 * history at roughly 60 days at 1-minute resolution. That is not enough bars to validate an
 * intraday strategy, and no amount of waiting fixes it. A published dataset supplies the depth.
 *
 * Why it is not simply trusted: a downloaded price series is the least verifiable input this
 * system takes. It has no provider contract, no timestamps you can check against a quote, and
 * often no statement of how it was built. Three defects are common and none of them error —
 * they all produce a *better* backtest, which is exactly why they must be caught here:
 *
 *   1. **Split adjustment.** A series adjusted for a split that happened after the bar means the
 *      bar's price was never tradable at that value. Every historical decision made on it used
 *      information from the future. This is lookahead wearing the costume of data cleaning.
 *   2. **Survivorship.** A dataset assembled from currently-listed symbols has silently dropped
 *      everything that delisted, which is most of what would have lost you money.
 *   3. **Gaps and duplicates.** A missing session is indistinguishable from a flat one once the
 *      bars are in a table, and a duplicated bar double-counts a signal.
 *
 * So an import carries a declaration, and the declaration is recorded with the data. A dataset
 * whose adjustment status is unknown is imported as `unknown`, never as `unadjusted` — the
 * distinction between "we checked" and "nobody said" is the whole point.
 */

/** How the prices relate to what was actually tradable at the time. */
export type Adjustment =
  /** Prices as printed on the day. Safe for backtesting. */
  | "raw"
  /** Back-adjusted for later splits/dividends. Contains information from after the bar. */
  | "adjusted"
  /** The dataset does not say. Treated as unusable for validation until someone checks. */
  | "unknown";

export interface DatasetDeclaration {
  /** Where it came from, verbatim — `huggingface:org/name` or `kaggle:owner/slug`. */
  source: string;
  /** Licence as published. Absent is not "permissive". */
  license: string | null;
  adjustment: Adjustment;
  /**
   * Whether delisted instruments are present. `false` means the sample is survivorship-biased
   * and every result from it is optimistic by an unknown amount.
   */
  includesDelisted: boolean | null;
  resolution: string;
}

export interface ImportedCandle {
  ticker: string;
  resolution: string;
  /** Unix seconds at the bar open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export type RejectionCode =
  | "NON_FINITE"
  | "NON_POSITIVE_PRICE"
  | "INCOHERENT_BAR"
  | "DUPLICATE_TIME"
  | "OUT_OF_ORDER"
  | "NEGATIVE_VOLUME";

export interface Rejection {
  row: number;
  code: RejectionCode;
  detail: string;
}

export interface ImportReport {
  accepted: ImportedCandle[];
  rejected: Rejection[];
  /** Sessions where the gap to the previous bar exceeds the resolution by more than a factor. */
  gaps: { after: number; before: number; missingBars: number }[];
  /** Set when the declaration makes the data unfit for validation, with the reason. */
  unfitForValidation: string | null;
  summary: string;
}

/** Seconds per bar, for gap detection. Null for resolutions with no fixed spacing. */
function barSeconds(resolution: string): number | null {
  const minutes: Record<string, number> = { "1": 1, "5": 5, "15": 15, "30": 30, "60": 60 };
  if (resolution in minutes) return minutes[resolution] * 60;
  if (resolution === "D") return 86_400;
  return null;
}

/**
 * Whether a dataset may be used to *validate* a strategy, as opposed to merely explore one.
 *
 * Deliberately strict. A dataset that fails this is still importable and still useful for
 * looking at — it just cannot produce a number anyone should act on, and the gauntlet must be
 * able to refuse it by name rather than silently grading a contaminated input.
 */
export function validationFitness(declaration: DatasetDeclaration): string | null {
  if (declaration.adjustment === "adjusted") {
    return "Prices are back-adjusted for later corporate actions, so each bar contains information from after it. A backtest on this measures a series that was never tradable.";
  }
  if (declaration.adjustment === "unknown") {
    return "The dataset does not state whether prices are split-adjusted. Unknown is not the same as unadjusted, and assuming the safe case is how a contaminated series becomes evidence.";
  }
  if (declaration.includesDelisted === false) {
    return "The dataset contains only surviving instruments, so every result is optimistic by an unmeasured amount. Usable for exploration, not for a trial.";
  }
  if (declaration.includesDelisted === null) {
    return "The dataset does not state whether delisted instruments are included, so survivorship bias cannot be ruled out.";
  }
  if (!declaration.license) {
    return "No licence is recorded. Reuse terms must be known before a dataset becomes part of an evidence chain.";
  }
  return null;
}

/**
 * Validate and normalise rows into candles.
 *
 * Rows are rejected individually rather than failing the import: one malformed line in a
 * multi-million-row dump should cost that line, not the dataset. But every rejection is
 * reported — a silent drop turns a data-quality problem into a mysteriously short series.
 */
export function importCandles(
  rows: readonly Partial<ImportedCandle>[],
  declaration: DatasetDeclaration,
): ImportReport {
  const accepted: ImportedCandle[] = [];
  const rejected: Rejection[] = [];
  const gaps: ImportReport["gaps"] = [];
  const seen = new Set<string>();
  let previousTime: number | null = null;

  rows.forEach((row, index) => {
    const { ticker, time, open, high, low, close } = row;
    const volume = row.volume ?? null;

    const numbers = [time, open, high, low, close];
    if (typeof ticker !== "string" || ticker.length === 0 || numbers.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      rejected.push({ row: index, code: "NON_FINITE", detail: "A required field is missing or not a finite number." });
      return;
    }

    // Zero is a real value for volume and a nonsense one for price. A bar priced at zero is a
    // parse failure that would otherwise become an infinite return.
    if (open! <= 0 || high! <= 0 || low! <= 0 || close! <= 0) {
      rejected.push({ row: index, code: "NON_POSITIVE_PRICE", detail: `Price at or below zero: o=${open} h=${high} l=${low} c=${close}` });
      return;
    }

    // high < low, or a close outside the range, means the row is not an OHLC bar whatever it
    // claims. Importing it would let a strategy "fill" at a price the bar never contained.
    if (high! < low! || open! > high! || open! < low! || close! > high! || close! < low!) {
      rejected.push({ row: index, code: "INCOHERENT_BAR", detail: `Open/close outside high/low: o=${open} h=${high} l=${low} c=${close}` });
      return;
    }

    if (volume !== null && (!Number.isFinite(volume) || volume < 0)) {
      rejected.push({ row: index, code: "NEGATIVE_VOLUME", detail: `Volume ${volume}` });
      return;
    }

    const key = `${ticker}@${time}`;
    if (seen.has(key)) {
      // A duplicated bar double-counts whatever signal it carries.
      rejected.push({ row: index, code: "DUPLICATE_TIME", detail: `${ticker} already has a bar at ${time}.` });
      return;
    }
    seen.add(key);

    if (previousTime !== null && time! < previousTime) {
      rejected.push({ row: index, code: "OUT_OF_ORDER", detail: `Bar at ${time} precedes ${previousTime}.` });
      return;
    }

    const spacing = barSeconds(declaration.resolution);
    if (spacing !== null && previousTime !== null) {
      const elapsed = time! - previousTime;
      // Two bars of slack absorbs ordinary session boundaries; beyond that it is a real hole and
      // a strategy reading across it would treat an absence as continuity.
      if (elapsed > spacing * 3) {
        gaps.push({ after: previousTime, before: time!, missingBars: Math.floor(elapsed / spacing) - 1 });
      }
    }
    previousTime = time!;

    accepted.push({
      ticker,
      resolution: declaration.resolution,
      time: time!,
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      volume: volume === null ? null : Math.trunc(volume),
    });
  });

  const unfitForValidation = validationFitness(declaration);

  return {
    accepted,
    rejected,
    gaps,
    unfitForValidation,
    summary:
      `${accepted.length} bar(s) accepted, ${rejected.length} rejected, ${gaps.length} gap(s) found. ` +
      (unfitForValidation
        ? `NOT usable for validation: ${unfitForValidation}`
        : "Declaration permits use in validation."),
  };
}
