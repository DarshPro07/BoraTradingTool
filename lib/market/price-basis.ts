/**
 * The price basis a series is expressed in, and how to move between them.
 *
 * ## The defect this exists for
 *
 * Measured in the production store, 2026-08-16:
 *
 * ```
 *   RELIANCE  2024-10-24 = 2655.70   beside   2024-10-27 = 1334.35
 *   HDFCBANK  2025-08-24 = 1964.10   beside   2025-08-25 =  973.40
 * ```
 *
 * Yahoo retroactively adjusts its entire history when a corporate action occurs — a series
 * fetched today shows no step at all. `persistCandles` is idempotent by
 * `(ticker, resolution, time)` and never revisits a stored bar, so bars written BEFORE an action
 * keep the old basis forever while every bar written after arrives on the new one. The canonical
 * series therefore carried two adjustment bases at once, and a 1:2 split presented as a −50%
 * single-day drop with the long trend filter still intact: the strongest possible trigger for the
 * declared swing mean-reversion family, and not a market event.
 *
 * ## Why the basis is explicit rather than implicit
 *
 * A price series has no meaning without saying what it is a price OF. Three are legitimate and
 * they answer different questions:
 *
 *   RAW             what actually traded, at the number printed on the tape. The only honest
 *                   basis for execution simulation, fill modelling and cost accounting.
 *   SPLIT_ADJUSTED  a continuous series across share-count changes, dividends untouched. The
 *                   right basis for technical and price-pattern research, because a split is an
 *                   accounting event and not information about value.
 *   TOTAL_RETURN    splits and distributions both, so the series measures what an investor
 *                   actually earned. The right basis for anything dividend-sensitive.
 *
 * Mature backtesting systems separate these deliberately; the failure mode here was that the
 * separation was implicit, so the store silently held a mixture of two of them.
 *
 * ## Verify before accept — the constraint that shapes this API
 *
 * The store is NOT uniformly RAW. It is "raw as of the date each bar was ingested". An instrument
 * whose entire history was fetched *after* a split is already continuous end to end, and
 * back-adjusting it by the known ratio would halve a correct past — manufacturing exactly the
 * defect this module removes.
 *
 * So knowing that an action occurred is NOT sufficient authority to apply it. The normalizer first
 * measures whether THIS series actually steps at that boundary, and:
 *
 *   - steps by the declared ratio  → adjust, and record that it was applied
 *   - does not step               → SKIP, and record that the series was already on the new basis
 *   - steps by something else     → AMBIGUOUS: adjust nothing, and say so
 *
 * The third case is the one that matters most. A real −30% day beside a declared 1:2 split is not
 * a split; forcing the ratio would erase a genuine market move, and ignoring the mismatch quietly
 * would hide a disagreement between the provider's event feed and its own prices.
 */

export type PriceBasis = "AS_FETCHED" | "RAW" | "SPLIT_ADJUSTED" | "TOTAL_RETURN";

export const PRICE_BASES: readonly PriceBasis[] = [
  "AS_FETCHED",
  "RAW",
  "SPLIT_ADJUSTED",
  "TOTAL_RETURN",
];

/**
 * Why `AS_FETCHED` exists, and why `RAW` cannot be served from this store.
 *
 * VERIFIED against Yahoo on 2026-08-16, against RELIANCE's 1:1 bonus of ex-date 2024-10-28:
 *
 * ```
 *   2024-10-22   Yahoo today      O 1369.20  H 1376.00  L 1340.22  C 1343.35
 *                our store        O 2675.00  H 2714.95  L 2670.00  C 2677.05
 * ```
 *
 * Yahoo retroactively adjusts the **entire OHLC**, not merely the close, and `adjclose` is a
 * further dividend adjustment on top. So what a fetch returns for a past date depends on WHEN the
 * fetch happens, and a bar in this store carries whatever basis the provider was serving on the
 * day it was written: genuinely traded prices for bars written before an action, already-adjusted
 * prices for bars written after.
 *
 * That mixture is precisely what `AS_FETCHED` names. It is an honest label for a heterogeneous
 * series, and it is NOT a synonym for traded prices.
 *
 * `RAW` — the actual numbers printed on the tape — is therefore **not reconstructible** for
 * historical bars: it would need each bar's ingestion date and the action history between then and
 * now, and the ingestion ledger only began recording in migration 0023. Asking for RAW gets a
 * typed refusal rather than `AS_FETCHED` wearing a better name, because execution simulation and
 * cost accounting are exactly the places where the difference decides whether a fill was possible.
 *
 * Prospectively RAW becomes serviceable: a bar ingested today, with no action between its session
 * and now, IS its traded price. The refusal is about history, not about the concept.
 */
export const RAW_UNAVAILABLE_REASON =
  "This store cannot serve RAW traded prices for historical bars. The provider retroactively " +
  "adjusts its whole OHLC at each corporate action (verified against RELIANCE's 2024-10-28 1:1 " +
  "bonus: the same session reads 2677.05 as fetched then and 1343.35 as fetched now), so a stored " +
  "bar carries whatever basis was current on the day it was written. Reconstructing the tape " +
  "would need per-bar ingestion dates that predate the ingestion ledger. Ask for AS_FETCHED to " +
  "get the stored numbers unmodified, or SPLIT_ADJUSTED for a continuous series.";

/**
 * How closely the observed step must match the declared ratio before it is believed.
 *
 * Wide on purpose. The observed step is measured across a real session boundary, so it carries
 * that day's genuine move on top of the mechanical one: a 1:2 split on a day the stock also moved
 * 3% shows as 0.485 rather than 0.500. Tight tolerance here would reject real splits and leave the
 * discontinuity in place, which is the failure that costs evidence.
 */
export const RATIO_TOLERANCE = 0.12;

/** Thrown when a caller asks for a basis this store cannot honestly produce. */
export class PriceBasisUnavailableError extends Error {
  readonly code = "PRICE_BASIS_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "PriceBasisUnavailableError";
  }
}

export interface NormalizableBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CorporateAction {
  instrumentId: string;
  /** Unix seconds. The FIRST bar at or after this time trades on the new basis. */
  effectiveTime: number;
  kind: "SPLIT" | "DIVIDEND";
  /** SPLIT only: shares after per share before. A 2:1 split is `2`, so price divides by 2. */
  ratio: number | null;
  /** DIVIDEND only: cash per share, in the instrument's currency. */
  amount: number | null;
  /** Where the action came from — `yahoo:events`, `detected:store`, and so on. */
  source: string;
}

export interface AppliedAction {
  action: CorporateAction;
  /** The factor pre-boundary bars were divided by. */
  factor: number;
  observedRatio: number;
}

export interface SkippedAction {
  action: CorporateAction;
  observedRatio: number;
  reason: string;
}

export interface AmbiguousAction {
  action: CorporateAction;
  observedRatio: number;
  declaredRatio: number;
  reason: string;
}

export interface NormalizationOutcome {
  bars: NormalizableBar[];
  basis: PriceBasis;
  /** Actions whose discontinuity was observed and removed. */
  applied: AppliedAction[];
  /** Actions the series was already adjusted for. Not a problem — a fact worth recording. */
  skipped: SkippedAction[];
  /** Actions whose declared ratio disagrees with the prices. Nothing applied; needs a human. */
  ambiguous: AmbiguousAction[];
}

/**
 * How far from an action's nominal date the real boundary may sit, in seconds.
 *
 * Corporate-action dates do not line up with bar labels as neatly as they should. Yahoo dates
 * RELIANCE's 2:1 split `2024-10-28` while our stored series steps between `2024-10-24` and
 * `2024-10-27` — the store labels those three instruments a day early, and weekends move the
 * boundary again. Measuring the step at exactly the nominal instant landed INSIDE the post-split
 * half, read a ratio of 0.996, and concluded the series was already adjusted: every one of the 26
 * affected instruments was skipped.
 *
 * So the boundary is located rather than assumed, within a window wide enough for a weekend plus
 * a day of labelling drift. It is not a licence to find a step anywhere: whatever is found must
 * still match the declared ratio before anything is applied.
 */
export const BOUNDARY_SEARCH_SECONDS = 6 * 86_400;

interface Boundary {
  /** Index of the first bar on the far side of the step. */
  index: number;
  ratio: number;
}

/**
 * The bar boundary near `time` whose step best matches `target`.
 *
 * Returns null when the action falls outside the series entirely. When no boundary matches, the
 * closest one is still returned — the caller needs its ratio to distinguish "already adjusted"
 * from "the feed and the prices disagree".
 */
function locateBoundary(
  bars: readonly NormalizableBar[],
  time: number,
  target: number,
  windowSeconds: number,
): Boundary | null {
  let best: Boundary | null = null;
  for (let i = 1; i < bars.length; i += 1) {
    if (Math.abs(bars[i].time - time) > windowSeconds) continue;
    const before = bars[i - 1].close;
    const after = bars[i].close;
    if (before <= 0 || after <= 0) continue;
    const ratio = before / after;
    if (best === null || Math.abs(ratio - target) < Math.abs(best.ratio - target)) {
      best = { index: i, ratio };
    }
  }
  return best;
}

/**
 * Express `bars` in `basis`, using `actions` as candidate corrections.
 *
 * Pure and deterministic: same inputs, byte-identical output. The store is never written here —
 * normalization produces a NEW series, leaving the raw traded prices intact for execution
 * simulation.
 */
export function normalizeSeries(
  bars: readonly NormalizableBar[],
  actions: readonly CorporateAction[],
  basis: PriceBasis,
  options: { tolerance?: number; windowSeconds?: number } = {},
): NormalizationOutcome {
  const tolerance = options.tolerance ?? RATIO_TOLERANCE;

  // AS_FETCHED is the stored series, untouched. RAW is a stronger claim this store cannot make
  // about history — see RAW_UNAVAILABLE_REASON — so it is refused rather than quietly aliased.
  if (basis === "RAW") throw new PriceBasisUnavailableError(RAW_UNAVAILABLE_REASON);
  if (basis === "AS_FETCHED" || bars.length === 0) {
    return { bars: [...bars], basis, applied: [], skipped: [], ambiguous: [] };
  }

  const relevant = actions
    .filter((action) => (basis === "TOTAL_RETURN" ? true : action.kind === "SPLIT"))
    .slice()
    .sort((a, b) => a.effectiveTime - b.effectiveTime);

  const applied: AppliedAction[] = [];
  const skipped: SkippedAction[] = [];
  const ambiguous: AmbiguousAction[] = [];

  /** factor[i] = what the bar at index i must be divided by. Built from the newest action back. */
  const factors = new Array<number>(bars.length).fill(1);

  for (const action of relevant) {
    const isSplit = action.kind === "SPLIT";
    const declared = isSplit ? action.ratio : null;

    if (isSplit && (declared === null || declared <= 0)) {
      ambiguous.push({
        action,
        observedRatio: Number.NaN,
        declaredRatio: Number.NaN,
        reason: "split action carries no usable ratio",
      });
      continue;
    }

    const boundary = locateBoundary(
      bars,
      action.effectiveTime,
      isSplit ? (declared as number) : 1,
      options.windowSeconds ?? BOUNDARY_SEARCH_SECONDS,
    );
    if (boundary === null) {
      // The action falls outside this series — before its first bar or after its last. Nothing to
      // verify and nothing to correct.
      continue;
    }
    const observedRatio = boundary.ratio;

    if (isSplit) {
      const ratio = declared as number;
      if (Math.abs(observedRatio - ratio) <= tolerance * ratio) {
        for (let i = 0; i < boundary.index; i += 1) factors[i] *= ratio;
        applied.push({ action, factor: ratio, observedRatio });
        continue;
      }
      if (Math.abs(observedRatio - 1) <= tolerance) {
        skipped.push({
          action,
          observedRatio,
          reason:
            `series is already split-adjusted across this boundary (closest step ${observedRatio.toFixed(3)}); ` +
            "applying the ratio would halve a correct past",
        });
        continue;
      }
      ambiguous.push({
        action,
        observedRatio,
        declaredRatio: ratio,
        reason:
          `prices step by ${observedRatio.toFixed(3)} where the declared ratio is ${ratio}; ` +
          "the event feed and the prices disagree, so nothing was adjusted",
      });
      continue;
    }

    // DIVIDEND, TOTAL_RETURN only.
    const amount = action.amount;
    const priorClose = bars[boundary.index - 1].close;
    if (amount === null || amount <= 0 || amount >= priorClose) {
      ambiguous.push({
        action,
        observedRatio,
        declaredRatio: Number.NaN,
        reason: `dividend amount ${String(amount)} is not usable against a prior close of ${priorClose}`,
      });
      continue;
    }
    const dividendFactor = 1 / (1 - amount / priorClose);
    for (let i = 0; i < boundary.index; i += 1) factors[i] *= dividendFactor;
    applied.push({ action, factor: dividendFactor, observedRatio });
  }

  const normalized = bars.map((bar, index) => {
    const factor = factors[index];
    if (factor === 1) return { ...bar };
    return {
      time: bar.time,
      open: bar.open / factor,
      high: bar.high / factor,
      low: bar.low / factor,
      close: bar.close / factor,
      // The share count moved the other way. Volume that is not scaled makes turnover
      // (price × volume) discontinuous even after the prices are made continuous.
      volume: bar.volume * factor,
    };
  });

  return { bars: normalized, basis, applied, skipped, ambiguous };
}
