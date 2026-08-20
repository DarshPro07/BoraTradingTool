/**
 * `nse_india_vix_day_character_study` — a research PROGRAMME, not a strategy.
 *
 * ## The question, deliberately not "does India VIX predict returns"
 *
 * > Which pre-known day-character conditions systematically change the distribution of outcomes
 * > across a bank of unrelated, unoptimised intraday strategies?
 *
 * The strategies are thermometers, not candidates. Nobody asks which earns most; the question is
 * whether some ex-ante state shifts a broad population of them together. That is much harder to
 * fake than a single tuned rule, and it fails cleanly when the answer is no.
 *
 * Kept entirely separate from QC-001.
 *
 * ## Adapted from a US design, NOT ported literally
 *
 * The source uses ES/NQ, CBOE VIX, VIX9D/VIX, VIX/VIX3M and an overnight Globex range. Three of
 * those have no honest NSE equivalent, and inventing proxies to preserve the feature count would be
 * exactly the fabrication this system exists to refuse. They are omitted with reasons below.
 */

/** India VIX is computed from NIFTY option prices, so NIFTY is primary — BANKNIFTY only secondary. */
export const PRIMARY_INSTRUMENT = "NIFTY_FUTURES_FRONT_MONTH" as const;
export const SECONDARY_INSTRUMENT = "BANKNIFTY_FUTURES_FRONT_MONTH" as const;

/**
 * NSE equity derivatives trade 09:15-15:40 IST, so the US design's 15:55 cutoff does not apply.
 * Every day-character label must be computable from information available by 10:00 IST.
 */
export const SESSION = Object.freeze({
  openIst: "09:15",
  /** All day-character information frozen here. Anything needing the day's range is a label leak. */
  informationCutoffIst: "10:00",
  flatByIst: "15:35",
  closeIst: "15:40",
});

/**
 * Three price representations, never conflated.
 *
 * Execution reads the UNADJUSTED front contract. Back-adjusted continuous series are for features
 * and charts only — this repository has already paid for the lesson that an adjustment basis can
 * invent historical prices that never traded.
 */
export const PRICE_REPRESENTATIONS = Object.freeze({
  execution: "UNADJUSTED_FRONT_CONTRACT",
  features: "BACK_ADJUSTED_CONTINUOUS",
  provenance: "EXPLICIT_ROLL_CALENDAR",
});

export interface DayCharacterLabel {
  id: string;
  knownBy: "10:00_IST" | "PRIOR_CLOSE" | "CALENDAR";
  description: string;
  requiredData: readonly string[];
}

/**
 * Version 1 label bank — deliberately 10, not 14.
 *
 * Every label is known at the prior close, derivable by 10:00 IST, or a pure calendar fact. More
 * labels means more multiplicity, and the max-statistic permutation below pays for every one.
 */
export const LABELS: readonly DayCharacterLabel[] = Object.freeze([
  { id: "india_vix_prior_close", knownBy: "PRIOR_CLOSE", description: "India VIX at the previous close.", requiredData: ["india_vix_daily"] },
  { id: "india_vix_rel_20d", knownBy: "PRIOR_CLOSE", description: "Prior India VIX against its trailing 20-day distribution.", requiredData: ["india_vix_daily"] },
  { id: "india_vix_change_open", knownBy: "10:00_IST", description: "India VIX near 10:00 minus previous close. Needs intraday VIX.", requiredData: ["india_vix_intraday"] },
  { id: "realized_vol_30d", knownBy: "PRIOR_CLOSE", description: "Trailing 30-session realized volatility of NIFTY futures.", requiredData: ["nifty_futures_daily"] },
  { id: "gap_open_atr", knownBy: "10:00_IST", description: "Today's open against previous close, scaled by ATR.", requiredData: ["nifty_futures_1m"] },
  { id: "prior_day_range_atr", knownBy: "PRIOR_CLOSE", description: "Previous session's range in ATR units.", requiredData: ["nifty_futures_daily"] },
  { id: "prior_day_close_location", knownBy: "PRIOR_CLOSE", description: "Where the previous close sat within its own range.", requiredData: ["nifty_futures_daily"] },
  { id: "day_of_week", knownBy: "CALENDAR", description: "Calendar fact.", requiredData: [] },
  { id: "days_to_expiry", knownBy: "CALENDAR", description: "From CONTRACT METADATA, never inferred from the weekday. See EXPIRY_RULE.", requiredData: ["nse_contract_metadata"] },
  { id: "event_today", knownBy: "CALENDAR", description: "RBI MPC / CPI / WPI / Budget / expiry / prior-night FOMC. The CALENDAR only, never the outcome.", requiredData: ["nse_event_calendar"] },
]);

/**
 * Labels from the US design omitted rather than approximated.
 *
 * Each would have been easy to fake, and each fake would have been undetectable in the output.
 */
export const OMITTED_LABELS: readonly { id: string; reason: string }[] = Object.freeze([
  {
    id: "vix9d_over_vix",
    reason:
      "No official India VIX 9-day index exists. A near-week implied-vol measure needs authorised " +
      "NIFTY option-surface data; manufacturing one would fabricate the variable under test.",
  },
  {
    id: "vix_over_vix3m",
    reason:
      "India VIX is a constant-30-calendar-day measure from near/next NIFTY expiries. There is no " +
      "official 3-month series to divide by.",
  },
  {
    id: "overnight_range_in_atr",
    reason:
      "ES/NQ trade nearly around the clock; NSE NIFTY futures do not, so there is no overnight " +
      "range to measure. GIFT Nifty could substitute only under a licensed data path.",
  },
]);

/**
 * Expiry must come from contract metadata, effective-dated. NEVER from the weekday.
 *
 * NSE moved the derivatives expiry convention from Thursday to Tuesday for contracts expiring from
 * September 2025. A rule reading `if (weekday === TUESDAY) expiry` would be silently wrong across
 * every earlier year and right afterwards — precisely the defect class this repository keeps
 * finding: individually plausible code over a wrong model of reality.
 */
export const EXPIRY_RULE = Object.freeze({
  source: "NSE_CONTRACT_METADATA",
  inferFromWeekday: false,
  note:
    "Convention changed Thursday -> Tuesday for contracts expiring from September 2025. Read " +
    "expiry_date and roll_date per contract; derive days_to_expiry from those.",
});

/** Unoptimised, direction-balanced measuring instruments. Never tuned, never ranked by profit. */
export const STRATEGY_BANK = Object.freeze([
  "opening_range_breakout",
  "twap_fade",
  "twap_trend_follow",
  "five_minute_momentum_continuation",
  "intraday_ma_crossover",
  "stretched_bar_reversal",
]);

/**
 * Randomisation fixed ONCE and fingerprinted before any label result exists.
 *
 * Otherwise "400 configs did not work, generate another 400" becomes uncounted search. Every long
 * config is mirrored by a short twin so market drift cannot masquerade as a volatility effect.
 */
export const CONFIG_BANK = Object.freeze({
  size: 400,
  seed: 20260817,
  directionBalanced: true,
  fingerprintBeforeResults: true,
});

/**
 * Buckets from TRAILING quantiles only, computed from observations available before today.
 *
 * Full-sample quintiles would let the future decide which bucket today belongs to — the lookahead
 * the truncation control exists to catch.
 */
export const BUCKETING = Object.freeze({ method: "TRAILING_QUANTILES", fullSample: false });

/**
 * The luck test: block permutation of labels with trades held fixed, corrected by max-statistic.
 *
 * Max-stat rather than treating N labels as N independent tests, because they are strongly
 * correlated — every India VIX label moves with the others. For each shuffled world compute every
 * label's headline effect and keep the LARGEST; compare each real label against that null. Holm is
 * reported alongside, not instead.
 */
export const LUCK_TEST = Object.freeze({
  method: "BLOCK_PERMUTATION_WITH_MAX_STATISTIC",
  primaryBlockSessions: 63,
  sensitivityBlocks: Object.freeze([21, 63, 126]),
  blockRationale:
    "63 sessions is roughly a quarter, long enough to preserve volatility regimes. Recorded as a " +
    "choice rather than a constant, and reported at 21/63/126 so no answer rests on it.",
  alsoReport: "HOLM",
});

/** Effective-dated, because Indian derivative charges change and a flat number would be wrong. */
export const COST_MODEL_COMPONENTS = Object.freeze([
  "brokerage",
  "securities_transaction_tax",
  "exchange_transaction_charges",
  "sebi_turnover_fee",
  "stamp_duty",
  "gst",
  "slippage_scaled_by_realized_volatility",
]);

/**
 * Minimum sample is chosen BEFORE any performance is inspected, then frozen.
 *
 * The US design's 200/1000 figures are not adopted: they describe a different instrument at a
 * different frequency. Filter by sample size, never by profitability.
 */
export const SAMPLE_RULE = Object.freeze({
  chooseBeforeInspectingPerformance: true,
  basis: "STATISTICAL_PRECISION_ON_EFFECTIVE_SAMPLE",
  minimumTradesWholeSample: null,
  minimumTradesPerBucket: null,
  note: "Left null deliberately. Filled once the NIFTY bank's actual trade counts are known, and frozen then.",
});

/**
 * Everything this study needs and this deployment does not have.
 *
 * NSE's terms prohibit systematic automated collection from the website, so none of this may be
 * scraped. It needs an authorised feed, broker data, or a manually supplied snapshot.
 */
export const REQUIRED_DATA: readonly string[] = Object.freeze([
  "nifty_futures_1m",
  "nifty_futures_daily",
  "nse_contract_metadata",
  "india_vix_daily",
  "india_vix_intraday",
  "nse_event_calendar",
  "banknifty_futures_1m",
]);

/** Implementation order. The dashboard is last, and that is not negotiable. */
export const PHASES: readonly string[] = Object.freeze([
  "1. NIFTY futures only",
  "2. India VIX + the available labels",
  "3. Six neutral strategy families",
  "4. Fixed, direction-balanced randomised config bank",
  "5. Lookahead + positive/null controls",
  "6. Trailing quintiles",
  "7. Block-permutation / max-stat luck test",
  "8. Follow-up robustness incl. days-to-expiry interaction",
  "9. BANKNIFTY replication",
  "10. Dashboard, reading every number from result artifacts",
]);
