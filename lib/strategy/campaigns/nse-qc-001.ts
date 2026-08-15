import type { CampaignDeclaration } from "@/lib/strategy/campaign-registry";

/**
 * NSE-QC-001 — the first explicitly REGISTERED research campaign (owner directive 2026-08-15).
 *
 * This file IS the pin. The registry hashes each family's declaration into `declaration_hash`
 * and refuses to re-register a family whose declaration changed — so editing this file after
 * experiments have run does not silently redefine a family; it produces a loud refusal and the
 * only honest paths forward: a NEW family (new id, its own trial count) or a NEW campaign.
 *
 * Owner rules carried into this declaration, verbatim in docs/plans/nse-qc-001/02-contract.md:
 *   - a small set of explicitly registered families; variants are generated INSIDE a family's
 *     allowedVariantDimensions and every configuration costs a counted selection trial;
 *   - published results (the SSRN ORB studies recorded in docs/external/orb-research-inputs.md)
 *     are hypothesis INPUTS, never proof of edge;
 *   - do not silently alter the contract because early results look poor;
 *   - prefer no strategy over a statistically weak strategy.
 */
// Not Object.freeze: the registry's declaration_hash refusal is the real immutability; freeze
// only breaks literal-type inference here.
export const NSE_QC_001: CampaignDeclaration = {
  campaignId: "camp_nse_qc_001",
  name: "NSE-QC-001",
  question:
    "Across the eligible NSE universe (canonical master → data-quality → liquidity → " +
    "execution-feasible at the owner's capital), do any of five declared strategy families " +
    "hold a repeatable NET positive edge after the full effective-dated Indian cost stack, " +
    "surviving rehearsal → cost-aware gauntlet (DSR/PBO over counted trials) → sealed holdout " +
    "→ forward evidence → paper?",
  families: [
    {
      familyId: "fam_qc001_orb",
      name: "Opening Range Breakout (intraday)",
      economicHypothesis:
        "The first minutes of NSE trading concentrate overnight-information price discovery; " +
        "once the opening range is established, a decisive break of it carries " +
        "continuation odds above chance because stop-triggered and momentum-following order " +
        "flow reinforces the direction while the range itself priced the initial disagreement.",
      mechanism:
        "Opening range forms over the first W minutes → price closes beyond the range with " +
        "confirmation → enter in the break direction → continuation until target, stop, or " +
        "mandatory intraday exit before the close (no overnight exposure).",
      allowedVariantDimensions: {
        range_window: "5m-60m",
        confirmation: "close-beyond vs touch; relative-volume multiple 1.0-3.0x",
        stop: "0.25-1.5 ATR(14) or opposite side of the range",
        target: "1R-3R or time exit",
        entry_cutoff: "no new entries after 14:30 IST",
        min_range_filter: "0-1.0 ATR minimum range width",
      },
    },
    {
      familyId: "fam_qc001_rvol_breakout",
      name: "Relative-volume momentum breakout (intraday)",
      economicHypothesis:
        "Abnormal relative volume marks the arrival of new information or coordinated " +
        "participation; a break of a recent reference level ON abnormal volume continues " +
        "intraday more often than the same break on normal volume, because the volume anomaly " +
        "separates informed repricing from noise.",
      mechanism:
        "Relative volume vs a trailing session baseline exceeds a threshold → price breaks a " +
        "declared reference level (prior-day high/low or N-bar extreme) → enter with the break " +
        "→ exit on volume fade, target, stop, or intraday close.",
      allowedVariantDimensions: {
        rvol_baseline: "5-20 session lookback",
        rvol_threshold: "1.5x-5x",
        reference_level: "prior-day high/low or N-bar high/low, N in 20-78 bars",
        stop: "0.25-1.5 ATR(14)",
        target: "1R-3R or trailing",
        entry_cutoff: "no new entries after 14:30 IST",
      },
    },
    {
      familyId: "fam_qc001_intraday_mr",
      name: "Intraday mean reversion (midday fade)",
      economicHypothesis:
        "Away from the opening and closing auctions, NSE large-cap intraday paths over-extend " +
        "relative to short-horizon fair value under thin midday liquidity; stretched moves " +
        "WITHOUT abnormal volume revert toward VWAP or the short mean as liquidity providers " +
        "fade uninformed pressure.",
      mechanism:
        "A stretch measure (distance from VWAP or short SMA in ATR units, or a short-window " +
        "RSI extreme) fires inside the midday window with relative volume BELOW a ceiling → " +
        "fade the move → exit at the mean/VWAP touch, hard stop beyond the extension, or time " +
        "stop before the close.",
      allowedVariantDimensions: {
        stretch: "1.5-3.0 ATR(14) from VWAP/SMA, or RSI(2-5) beyond 90/10",
        window: "11:00-14:30 IST only",
        rvol_ceiling: "exclude entries when relative volume exceeds 1.5x-2.5x",
        target: "VWAP touch or half-reversion",
        stop: "0.5-1.5 ATR beyond the stretch extreme",
        max_hold: "30m-120m",
      },
    },
    {
      familyId: "fam_qc001_xsec_momentum",
      name: "Swing cross-sectional momentum",
      economicHypothesis:
        "Across NSE equities, relative strength ranked over one-to-twelve-week horizons " +
        "persists over the following one to four weeks — underreaction plus flow herding — so " +
        "holding the top-ranked names outperforms the eligible universe after delivery costs " +
        "at a weekly rebalance.",
      mechanism:
        "Rank the eligible universe by lookback return (skipping the most recent days to avoid " +
        "short-term reversal) → hold the top N as delivery positions → rotate on a fixed " +
        "cadence; an optional index-trend regime filter suspends new entries in downtrends.",
      allowedVariantDimensions: {
        lookback: "20-120 trading days",
        skip_recent: "0-5 trading days",
        top_n: "5-20 names",
        rebalance: "every 5-10 trading days",
        ranking: "raw return or volatility-scaled return",
        regime_filter: "none, or index above its own 100-200 day SMA",
      },
    },
    {
      familyId: "fam_qc001_swing_mr",
      name: "Swing mean reversion (oversold snap-back)",
      economicHypothesis:
        "Multi-day oversold dislocations in liquid NSE equities — sharp short-window drops " +
        "without a regime break — revert over the following two to ten sessions as forced and " +
        "emotional selling exhausts, provided the longer trend remains intact.",
      mechanism:
        "An N-day return below a volatility-scaled threshold (or a short-window RSI floor) " +
        "while price remains above a long moving average → enter long as delivery → exit at " +
        "the short-mean touch, a time stop, or a hard stop below the recent swing low.",
      allowedVariantDimensions: {
        drop_trigger: "3-10 day return below -(1.5-3.0) x 20-day volatility, or RSI(2-5) below 5-15",
        trend_filter: "close above 100-200 day SMA",
        max_hold: "2-10 sessions",
        target: "10-20 day SMA touch or fixed R",
        stop: "below the N-day swing low, or 1.5-2.5 ATR(14)",
      },
    },
  ],
};
