import type { DataProviderId } from "./data-source-registry";

/**
 * What each source may be USED FOR — a separate axis from what it can technically deliver.
 *
 * ## Why this exists (owner directive, 2026-08-16)
 *
 * `canSatisfy()` answers "does this source return the bars I need?". That is not the same
 * question as "may this system use those bars for this purpose?", and conflating them is how a
 * research prototype quietly becomes a product standing on data it has no right to use.
 *
 * The distinction became concrete the same day: NSE's equity-quote surface returned HTTP 403 to
 * sixty consecutive server-side requests. The technically-minded response is to reach for a
 * headless browser, persistent sessions and proxy rotation — all of which would work. The
 * correct response is that NSE's Terms of Use prohibit systematic or automated collection
 * (scraping, data mining, extraction, harvesting), so **the 403 is not an obstacle to route
 * around; it is the answer**. This module makes that reasoning mechanical rather than a matter
 * of anyone remembering it.
 *
 * ## Two axes, deliberately not merged
 *
 * A dataset can be unusable for validation because of DATA QUALITY (`unfitForValidation` in the
 * ingest path: unadjusted prices, no delisted names) or because of USAGE RIGHTS (here). Both are
 * real, they have different remedies, and a caller must be able to tell which one blocked it.
 */

export type AutomationStatus = "ALLOWED" | "LICENSED" | "RESTRICTED" | "PROHIBITED" | "UNKNOWN";
export type CommercialUseStatus = "ALLOWED" | "LICENSE_REQUIRED" | "PERSONAL_RESEARCH_ONLY" | "UNKNOWN";
export type RedistributionStatus = "ALLOWED" | "RESTRICTED" | "PROHIBITED" | "UNKNOWN";

/** What the data would be used FOR. Ordered loosely by how much a wrong source would cost. */
export type DataPurpose =
  | "IDENTITY"
  | "DISPLAY"
  | "RESEARCH"
  | "BACKTEST"
  | "VALIDATION"
  | "LIVE_TRADING";

export interface SourceUsagePolicy {
  sourceId: DataProviderId;
  automationStatus: AutomationStatus;
  commercialUse: CommercialUseStatus;
  redistribution: RedistributionStatus;
  sourceTermsUrl: string | null;
  /** Terms change. A stale reading is UNKNOWN, never a permission. */
  termsVerifiedAt: string;
  allowedPurposes: readonly DataPurpose[];
  /** Why the policy is what it is, in the terms' own terms. */
  note: string;
}

/** Terms read longer ago than this are treated as UNKNOWN — the same rule as capability claims. */
export const TERMS_FRESHNESS_DAYS = 180;

/**
 * Is this deployment commercial? Today it is not: MarketPulse is the owner's personal research
 * system and places no orders. Flipping this must be a deliberate act, because it REVOKES every
 * source whose terms permit personal research only — which is exactly the guard that stops a
 * research prototype from becoming a product on data it may not use commercially.
 */
export function isCommercialDeployment(env?: { MARKETPULSE_COMMERCIAL_USE?: string }): boolean {
  return (env ?? process.env).MARKETPULSE_COMMERCIAL_USE === "1";
}

export const SOURCE_USAGE_POLICIES: Readonly<Partial<Record<DataProviderId, SourceUsagePolicy>>> = Object.freeze({
  "nse-official": {
    sourceId: "nse-official",
    // The security-master and index-constituent CSVs are files NSE deliberately publishes as
    // downloads. Retrieving a published file is not the systematic harvesting of the site that
    // the Terms prohibit — but redistribution is a different matter and stays prohibited.
    automationStatus: "ALLOWED",
    commercialUse: "LICENSE_REQUIRED",
    redistribution: "PROHIBITED",
    sourceTermsUrl: "https://www.nseindia.com/static/nse-terms-of-use",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["IDENTITY", "DISPLAY", "RESEARCH", "BACKTEST", "VALIDATION"],
    note:
      "Official downloadable reference files. Commercial market-data use is governed by NSE Data " +
      "agreements, so a commercial deployment needs a licence before relying on this.",
  },
  "nse-equity-quote": {
    sourceId: "nse-equity-quote",
    // The decisive entry. It is not merely blocked — it is PROHIBITED, so the block must not be
    // treated as a technical problem awaiting a cleverer client.
    automationStatus: "PROHIBITED",
    commercialUse: "LICENSE_REQUIRED",
    redistribution: "PROHIBITED",
    sourceTermsUrl: "https://www.nseindia.com/static/nse-terms-of-use",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: [],
    note:
      "NSE's Terms of Use prohibit systematic or automated collection — scraping, data mining, " +
      "extraction, harvesting. The 403 this surface returns to server-side requests is therefore " +
      "the ANSWER, not an obstacle: defeating it with a headless browser, session replay or proxy " +
      "rotation is out of bounds however well it would work.",
  },
  yahoo: {
    sourceId: "yahoo",
    automationStatus: "RESTRICTED",
    commercialUse: "PERSONAL_RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    sourceTermsUrl: "https://legal.yahoo.com/in/en/yahoo/terms/otos/index.html",
    termsVerifiedAt: "2026-08-16",
    // Deliberately excludes VALIDATION and LIVE_TRADING. That matches what the ingest path
    // already says on data-quality grounds ("usable for exploring an idea, not for promoting
    // one") — the two axes agree here, and each states its own reason.
    allowedPurposes: ["DISPLAY", "RESEARCH", "BACKTEST"],
    note:
      "yfinance states it is for research and education and that Yahoo Finance data is intended " +
      "for personal use; Yahoo's terms prohibit automated collection without prior permission and " +
      "commercial exploitation without permission. Excellent for this research build; NOT a " +
      "foundation for a commercial product or for validation-grade evidence.",
  },
  "upstox-v3": {
    sourceId: "upstox-v3",
    // A broker API used with the owner's own credentials under its developer terms — the one
    // structured source whose automation is unambiguously intended.
    automationStatus: "LICENSED",
    commercialUse: "LICENSE_REQUIRED",
    redistribution: "PROHIBITED",
    sourceTermsUrl: "https://upstox.com/developer/api-documentation/",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["DISPLAY", "RESEARCH", "BACKTEST", "VALIDATION", "LIVE_TRADING"],
    note:
      "Authenticated developer API: automation is the intended use. The strongest candidate for " +
      "validation-grade and eventual live data, pending the owner's credentials.",
  },
  "jugaad-data": {
    sourceId: "jugaad-data",
    // Technically useful, but its mechanism reaches NSE's website — the surface whose terms
    // prohibit automated collection. Classified rather than quietly wired in as a fallback.
    automationStatus: "RESTRICTED",
    commercialUse: "UNKNOWN",
    redistribution: "UNKNOWN",
    sourceTermsUrl: "https://github.com/jugaad-py/jugaad-data",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["RESEARCH"],
    note:
      "TECHNICALLY_USEFUL but LEGAL/TERMS_RISK_FOR_AUTOMATED_PRODUCT_USE: it accesses NSE's site, " +
      "which prohibits automated collection. RESEARCH_ONLY_UNTIL_USAGE_RIGHTS_CONFIRMED — never " +
      "an invisible production fallback.",
  },
  openchart: {
    sourceId: "openchart",
    automationStatus: "RESTRICTED",
    commercialUse: "UNKNOWN",
    redistribution: "UNKNOWN",
    sourceTermsUrl: "https://github.com/marketcalls/openchart",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["RESEARCH"],
    note: "Same NSE-site mechanism as jugaad-data, and separately unhealthy as probed.",
  },
  nsepython: {
    sourceId: "nsepython",
    automationStatus: "RESTRICTED",
    commercialUse: "UNKNOWN",
    redistribution: "UNKNOWN",
    sourceTermsUrl: "https://github.com/aeron7/nsepython",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["RESEARCH"],
    note: "Same NSE-site mechanism; separately capability-limited (historical equity endpoints 404).",
  },
  "aeron7-archive": {
    sourceId: "aeron7-archive",
    automationStatus: "ALLOWED",
    commercialUse: "UNKNOWN",
    redistribution: "UNKNOWN",
    sourceTermsUrl: "https://github.com/aeron7/nifty-banknifty-intraday-data",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["RESEARCH"],
    note: "Offline research archive: may train and challenge, may never stand as validation truth.",
  },
  "rajgmishra-dataset": {
    sourceId: "rajgmishra-dataset",
    automationStatus: "ALLOWED",
    commercialUse: "UNKNOWN",
    redistribution: "UNKNOWN",
    sourceTermsUrl: "https://github.com/rajgmishra/nifty50-15min-ohlc",
    termsVerifiedAt: "2026-08-16",
    allowedPurposes: ["RESEARCH"],
    note: "Research dataset, originally Zerodha-sourced per its own README. Research-only.",
  },
});

export type UsageVerdict = "PERMITTED" | "NOT_PERMITTED" | "UNKNOWN";

export interface UsageDecision {
  verdict: UsageVerdict;
  /** Set when the verdict is not PERMITTED — a coded reason a caller can branch on. */
  code: "SOURCE_USAGE_NOT_PERMITTED" | "SOURCE_TERMS_UNKNOWN" | "SOURCE_TERMS_STALE" | null;
  reason: string;
}

/**
 * May this source be used for this purpose, right now, in this deployment?
 *
 * Returns UNKNOWN rather than a permission when the policy is missing or its terms reading has
 * gone stale — "we never checked" and "we checked and it is allowed" must never look alike.
 */
export function usagePermitted(
  sourceId: DataProviderId,
  purpose: DataPurpose,
  options: { now?: Date; commercial?: boolean } = {},
): UsageDecision {
  const policy = SOURCE_USAGE_POLICIES[sourceId];
  const now = options.now ?? new Date();
  const commercial = options.commercial ?? isCommercialDeployment();

  if (!policy) {
    return {
      verdict: "UNKNOWN",
      code: "SOURCE_TERMS_UNKNOWN",
      reason: `${sourceId} has no declared usage policy — read its terms before using it for ${purpose}.`,
    };
  }

  const ageDays = (now.getTime() - Date.parse(policy.termsVerifiedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > TERMS_FRESHNESS_DAYS) {
    return {
      verdict: "UNKNOWN",
      code: "SOURCE_TERMS_STALE",
      reason:
        `${sourceId}'s terms were last read ${policy.termsVerifiedAt}, beyond the ` +
        `${TERMS_FRESHNESS_DAYS}-day horizon. Re-read them; a stale reading is not a permission.`,
    };
  }

  if (policy.automationStatus === "PROHIBITED") {
    return {
      verdict: "NOT_PERMITTED",
      code: "SOURCE_USAGE_NOT_PERMITTED",
      reason: `${sourceId} prohibits automated collection. ${policy.note}`,
    };
  }

  if (commercial && policy.commercialUse !== "ALLOWED") {
    return {
      verdict: "NOT_PERMITTED",
      code: "SOURCE_USAGE_NOT_PERMITTED",
      reason:
        `${sourceId} may not be used commercially (${policy.commercialUse}) and this deployment ` +
        `is declared commercial. ${policy.note}`,
    };
  }

  if (!policy.allowedPurposes.includes(purpose)) {
    return {
      verdict: "NOT_PERMITTED",
      code: "SOURCE_USAGE_NOT_PERMITTED",
      reason:
        `${sourceId} is not permitted for ${purpose} (allowed: ` +
        `${policy.allowedPurposes.join(", ") || "nothing"}). ${policy.note}`,
    };
  }

  return { verdict: "PERMITTED", code: null, reason: `${sourceId} permits ${purpose}.` };
}
