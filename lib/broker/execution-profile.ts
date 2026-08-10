/**
 * Broker execution profiles — when a position is forced flat, by whom, on what authority.
 *
 * ## What this replaces
 *
 * `INTRADAY_CEILING` hardcoded IN=15:20 with a comment asserting it was Zerodha's MIS square-off.
 * That number was written from recollection and presented as fact; Zerodha's own documentation
 * (fetched 2026-08-09) says **15:25 for non-CAS stocks, 15:10 for CAS stocks, 15:26 for F&O**,
 * subject to change on volatile days, with a Rs 50 + GST charge per forced order. A constant can
 * carry none of that — not the broker, not the segment split, not the caveat, not the provenance.
 *
 * So the cutoff is now a **record**: effective-dated, per broker/exchange/segment/product, with
 * its source URL, retrieval date and a stated confidence. Consumers resolve a profile and handle
 * its absence; nothing falls back to a default, because the silent default is exactly the defect
 * this module exists to remove.
 *
 * ## What "fail closed" means here
 *
 * A query no record covers — BSE intraday today, any date before a window opens — returns
 * `{available: false, reason}`. The backtest engines turn that into a refusal, the DSL into a
 * validation error or warning. Before this module, BSE intraday silently inherited the IN
 * constant; now it is refused with the missing profile named.
 */

export type BrokerId = "ZERODHA" | "UPSTOX" | "US_EXCHANGE_ONLY";
export type ExchangeId = "NSE" | "BSE" | "XNAS";
export type SegmentId = "EQ" | "FO";
/** MIS = intraday with forced square-off; CNC = delivery; CASH = US cash equity. */
export type ProductTypeId = "MIS" | "CNC" | "CASH";

/**
 * The security class a rule is scoped to. Zerodha's timings split on Closing Auction Session
 * membership, effective 2026-08-03: CAS-participating equities square off at 15:10, the rest at
 * 15:25. CAS membership is exchange session structure, not a broker watchlist, and it is a
 * property of the *instrument* — which this system does not hold per stock, so the owner context
 * resolves NON_CAS and states the assumption.
 */
export type SecurityClass = "CAS" | "NON_CAS" | "ANY";

/**
 * VERIFIED    - one authoritative source, fetched, no disagreement known.
 * CONFLICTED  - official sources disagree; the profile adopts the conservative value and lists
 *               every disagreeing source. A simulation may proceed only because the choice is
 *               explicit and stated - it is a research assumption, not established broker truth.
 * UNVERIFIED  - no independent fetch behind the figure.
 * SUPERSEDED  - kept for history; a later window replaces it.
 */
export type VerificationStatus = "VERIFIED" | "CONFLICTED" | "UNVERIFIED" | "SUPERSEDED";

export interface SourceRef {
  readonly id: string;
  readonly url: string;
  readonly retrievedAt: string;
  /** The date the SOURCE says its rule takes effect, where stated. Not the retrieval date. */
  readonly sourceEffectiveDate?: string;
  /** 1 = most authoritative for this rule. Ties are a conflict, not a preference. */
  readonly priority: number;
  readonly confidence: SourceConfidence;
  /** The minute this source states, where the sources disagree. How the conflict is auditable. */
  readonly statedExitMinute?: number;
}

export type SourceConfidence =
  /** Fetched from the broker's own documentation by this system, on the recorded date. */
  | "independently_fetched"
  /** Cited in the owner's 2026-08-09 architecture review; not independently re-fetched. */
  | "owner_review_reported"
  /** No broker source exists for this row; the assumption is stated in `assumptions`. */
  | "assumed";

export interface BrokerExecutionProfile {
  readonly id: string;
  readonly broker: BrokerId;
  readonly exchange: ExchangeId;
  readonly segment: SegmentId;
  readonly product: ProductTypeId;
  /** Which instruments this rule covers. "ANY" = the split does not apply to this product. */
  readonly securityClass: SecurityClass;
  /** ISO date this profile takes effect. */
  readonly effectiveFrom: string;
  /** ISO date it stops applying, or null while current. */
  readonly effectiveTo: string | null;
  /** Exchange session, minutes since local midnight. Pinned to `lib/market/calendar.ts` by test. */
  readonly sessionOpenMinute: number;
  readonly sessionCloseMinute: number;
  /** After this, no fresh intraday order. Null = the broker does not document one. */
  readonly newEntryCutoffMinute: number | null;
  /** When the broker's RMS begins force-closing. Null = it never does (CNC). */
  readonly rmsSquareOffStartMinute: number | null;
  /**
   * The deadline a simulation must be flat by. Null = overnight holding is allowed.
   *
   * Kept separate from `rmsSquareOffStartMinute` even though they coincide today: the RMS start
   * is a fact about the broker, the exit deadline is a modelling decision derived from it, and a
   * future profile may reasonably set the deadline earlier than the RMS as margin.
   */
  readonly mandatoryExitMinute: number | null;
  /** e.g. "MIS may be converted to CNC before the cutoff, subject to full margin." */
  readonly productConversion: string | null;
  /** Charged per order the broker squares off itself. Null where the concept does not apply. */
  readonly autoSquareOffCharge: { readonly amount: number; readonly gstRate: number } | null;
  /**
   * Leverage policy. `maxLeverage` is the regulatory/broker ceiling, NOT a promise for any given
   * stock — real MIS margins vary per instrument by VaR+ELM, which this system does not hold.
   * Consumers must treat leveraged figures as upper bounds and say so.
   */
  readonly marginPolicy: { readonly maxLeverage: number; readonly reference: string };
  /** Primary source first. A CONFLICTED profile lists every disagreeing source here. */
  readonly sources: readonly SourceRef[];
  readonly verificationStatus: VerificationStatus;
  /** Set when verificationStatus is CONFLICTED: the ids of the sources that disagree. */
  readonly conflictingSourceIds?: readonly string[];
  readonly policyVersion: string;
  readonly status: "active" | "superseded" | "draft";
  /** Every scope limit and caveat, stated. Surfaced in compile warnings and verdicts. */
  readonly assumptions: readonly string[];
}

/** The broker the owner actually uses. One line to change when that changes. */
export const OWNER_BROKER: BrokerId = "ZERODHA";

const SUPPORT_SQUAREOFF: SourceRef = {
  id: "zerodha-support-squareoff-2026-08-09",
  url: "https://support.zerodha.com/category/trading-and-markets/trading-faqs/market-sessions/articles/intraday-auto-square-off-timings",
  retrievedAt: "2026-08-09",
  priority: 1,
  confidence: "independently_fetched",
};

const CAS_GUIDANCE: SourceRef = {
  id: "zerodha-zconnect-cas-2026-08-09",
  url: "https://zerodha.com/z-connect/general/everything-you-need-to-know-about-closing-auction-session-cas",
  retrievedAt: "2026-08-09",
  sourceEffectiveDate: "2026-08-03",
  priority: 1,
  confidence: "owner_review_reported",
};

export const EXECUTION_PROFILES: readonly BrokerExecutionProfile[] = Object.freeze([
  {
    id: "ZERODHA_NSE_EQ_MIS_NONCAS_2026_08",
    broker: "ZERODHA",
    exchange: "NSE",
    segment: "EQ",
    product: "MIS",
    securityClass: "NON_CAS",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    sessionOpenMinute: 9 * 60 + 15,
    sessionCloseMinute: 15 * 60 + 30,
    // "After the square-off window, traders cannot place fresh MIS/CO orders" - same clock.
    newEntryCutoffMinute: 15 * 60 + 25,
    rmsSquareOffStartMinute: 15 * 60 + 25,
    mandatoryExitMinute: 15 * 60 + 25,
    productConversion: "MIS may be converted to CNC before the square-off window, subject to full delivery margin.",
    autoSquareOffCharge: { amount: 50, gstRate: 0.18 },
    marginPolicy: {
      maxLeverage: 5,
      reference:
        "SEBI peak-margin regime caps intraday leverage at 5x (20% margin floor); actual per-stock " +
        "MIS margin is VaR+ELM and varies. Zerodha margin bulletin, cited in owner review 2026-08-09.",
    },
    sources: [SUPPORT_SQUAREOFF, CAS_GUIDANCE],
    verificationStatus: "VERIFIED",
    policyVersion: "2026-08-09.2",
    status: "active",
    assumptions: [
      "Instruments are assumed non-CAS. CAS-participating equities square off at 15:10 under a separate profile; per-instrument CAS membership is not held in this system.",
      "The 15:25 timing is documented for the CAS regime effective 2026-08-03. Its application to earlier dates in this window is an explicitly conservative research assumption - verification does not extend backwards.",
      "Zerodha's RMS may adjust square-off timings on volatile days; this profile carries the documented normal case.",
    ],
  },
  {
    id: "ZERODHA_NSE_EQ_MIS_CAS_2026_08",
    broker: "ZERODHA",
    exchange: "NSE",
    segment: "EQ",
    product: "MIS",
    securityClass: "CAS",
    // The Closing Auction Session regime itself begins here; no CAS rule predates it.
    effectiveFrom: "2026-08-03",
    effectiveTo: null,
    sessionOpenMinute: 9 * 60 + 15,
    sessionCloseMinute: 15 * 60 + 30,
    newEntryCutoffMinute: 15 * 60 + 10,
    rmsSquareOffStartMinute: 15 * 60 + 10,
    mandatoryExitMinute: 15 * 60 + 10,
    productConversion: "MIS may be converted to CNC before the square-off window, subject to full delivery margin.",
    autoSquareOffCharge: { amount: 50, gstRate: 0.18 },
    marginPolicy: {
      maxLeverage: 5,
      reference: "SEBI peak-margin regime; per-stock margins vary and are not held here.",
    },
    sources: [SUPPORT_SQUAREOFF, CAS_GUIDANCE],
    verificationStatus: "VERIFIED",
    policyVersion: "2026-08-09.2",
    status: "active",
    assumptions: [
      "CAS membership is exchange session structure, not a broker watchlist. This system holds no per-instrument CAS list, so nothing resolves this profile automatically - it exists so the split is modelled rather than flattened into one number.",
    ],
  },
  {
    id: "ZERODHA_NSE_FO_MIS_2026_08",
    broker: "ZERODHA",
    exchange: "NSE",
    segment: "FO",
    product: "MIS",
    securityClass: "ANY",
    effectiveFrom: "2026-08-03",
    effectiveTo: null,
    sessionOpenMinute: 9 * 60 + 15,
    sessionCloseMinute: 15 * 60 + 30,
    newEntryCutoffMinute: null,
    rmsSquareOffStartMinute: 15 * 60 + 25,
    // CONFLICTED: Zerodha's own current documentation disagrees with itself. The general support
    // page and the 2026-07-29 leverage bulletin say 15:26; the CAS guidance effective 2026-08-03
    // says 15:25. Neither is chosen as truth - the CONSERVATIVE value (earlier exit, less credit
    // for the final minute) is adopted as an explicitly documented research assumption, and both
    // sources are listed so the conflict is auditable. This is exactly the situation the
    // verificationStatus field exists for; resolving it needs the broker, not a preference.
    mandatoryExitMinute: 15 * 60 + 25,
    productConversion: null,
    autoSquareOffCharge: { amount: 50, gstRate: 0.18 },
    marginPolicy: { maxLeverage: 1, reference: "F&O margining is not modelled in this system." },
    sources: [
      { ...CAS_GUIDANCE, id: "zerodha-zconnect-cas-fo-1525", statedExitMinute: 15 * 60 + 25 },
      {
        id: "zerodha-support-fo-1526",
        url: "https://support.zerodha.com/category/trading-and-markets/trading-faqs/market-sessions/articles/intraday-auto-square-off-timings",
        retrievedAt: "2026-08-09",
        priority: 2,
        confidence: "independently_fetched",
        statedExitMinute: 15 * 60 + 26,
      },
    ],
    verificationStatus: "CONFLICTED",
    conflictingSourceIds: ["zerodha-zconnect-cas-fo-1525", "zerodha-support-fo-1526"],
    policyVersion: "2026-08-09.2",
    status: "active",
    assumptions: [
      "Official Zerodha sources disagree (15:25 vs 15:26). The conservative 15:25 is adopted as a research assumption, not established broker truth. No F&O simulation exists in this system today; this row records the conflict so nothing later inherits one figure silently.",
    ],
  },
  {
    id: "ZERODHA_NSE_EQ_CNC_2026_08",
    broker: "ZERODHA",
    exchange: "NSE",
    segment: "EQ",
    product: "CNC",
    securityClass: "ANY",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    sessionOpenMinute: 9 * 60 + 15,
    sessionCloseMinute: 15 * 60 + 30,
    newEntryCutoffMinute: null,
    rmsSquareOffStartMinute: null,
    mandatoryExitMinute: null,
    productConversion: "CNC may be converted to MIS during market hours, subject to MIS margin.",
    autoSquareOffCharge: null,
    marginPolicy: { maxLeverage: 1, reference: "Delivery is fully funded; no leverage." },
    sources: [SUPPORT_SQUAREOFF],
    verificationStatus: "VERIFIED",
    policyVersion: "2026-08-09.2",
    status: "active",
    assumptions: [],
  },
  {
    id: "UPSTOX_NSE_EQ_MIS_2026_08",
    broker: "UPSTOX",
    exchange: "NSE",
    segment: "EQ",
    product: "MIS",
    securityClass: "NON_CAS",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    sessionOpenMinute: 9 * 60 + 15,
    sessionCloseMinute: 15 * 60 + 30,
    newEntryCutoffMinute: 15 * 60 + 20,
    rmsSquareOffStartMinute: 15 * 60 + 20,
    mandatoryExitMinute: 15 * 60 + 20,
    productConversion: null,
    autoSquareOffCharge: null,
    marginPolicy: {
      maxLeverage: 5,
      reference: "SEBI peak-margin regime; per-stock margins vary and are not held here.",
    },
    sources: [
      {
        id: "upstox-helpcenter-review-2026-08-09",
        url: "https://upstox.com/help-center/t-252634/",
        retrievedAt: "2026-08-09",
        priority: 1,
        confidence: "owner_review_reported",
      },
    ],
    verificationStatus: "UNVERIFIED",
    policyVersion: "2026-08-09.2",
    status: "active",
    assumptions: [
      "The 15:20 cut-off comes from the owner's 2026-08-09 review citing Upstox documentation; it has not been independently fetched.",
    ],
  },
  {
    id: "US_XNAS_EQ_CASH_2026_08",
    broker: "US_EXCHANGE_ONLY",
    exchange: "XNAS",
    segment: "EQ",
    product: "CASH",
    securityClass: "ANY",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    sessionOpenMinute: 9 * 60 + 30,
    sessionCloseMinute: 16 * 60,
    newEntryCutoffMinute: null,
    rmsSquareOffStartMinute: null,
    mandatoryExitMinute: 16 * 60,
    productConversion: null,
    autoSquareOffCharge: null,
    marginPolicy: { maxLeverage: 1, reference: "US margin is not modelled; cash only." },
    sources: [
      {
        id: "us-exchange-close-assumed",
        url: "about:blank",
        retrievedAt: "2026-08-09",
        priority: 1,
        confidence: "assumed",
      },
    ],
    verificationStatus: "UNVERIFIED",
    policyVersion: "2026-08-09.2",
    status: "active",
    assumptions: [
      "No US broker is configured; the exchange close stands in for a square-off deadline.",
      "US work is on hold per the owner (ADR 0006); this profile exists so US backtests state their assumption rather than crash.",
    ],
  },
]);

export interface ProfileQuery {
  broker: BrokerId;
  exchange: ExchangeId;
  segment: SegmentId;
  product: ProductTypeId;
  at: Date;
  /**
   * Defaults to NON_CAS, the stated assumption for this system's liquid large-cap universe.
   * Rows scoped "ANY" match every query; a CAS row is returned only when asked for explicitly.
   */
  securityClass?: SecurityClass;
}

export type ProfileResolution =
  | { available: true; profile: BrokerExecutionProfile }
  | { available: false; reason: string };

/**
 * The profile in force for a query, or a stated absence.
 *
 * `records` is injectable so date-window behaviour is provable in tests with synthetic versions,
 * without fabricating historical claims about real brokers in the shipped table.
 */
export function executionProfileFor(
  query: ProfileQuery,
  records: readonly BrokerExecutionProfile[] = EXECUTION_PROFILES,
): ProfileResolution {
  const day = query.at.toISOString().slice(0, 10);
  const wantedClass = query.securityClass ?? "NON_CAS";
  const profile = records.find(
    (row) =>
      row.status === "active" &&
      row.broker === query.broker &&
      row.exchange === query.exchange &&
      row.segment === query.segment &&
      row.product === query.product &&
      (row.securityClass === "ANY" || row.securityClass === wantedClass) &&
      day >= row.effectiveFrom &&
      (row.effectiveTo === null || day <= row.effectiveTo),
  );
  if (profile) return { available: true, profile };

  const near = records
    .filter((row) => row.broker === query.broker && row.exchange === query.exchange)
    .map((row) => `${row.id} (${row.product}/${row.securityClass}, from ${row.effectiveFrom})`)
    .join("; ");
  return {
    available: false,
    reason:
      `No execution profile covers ${query.broker}/${query.exchange}/${query.segment}/` +
      `${query.product}/${wantedClass} on ${day}. ${near ? `Known for this broker+exchange: ${near}.` : "None exists for this broker and exchange."} ` +
      "Refused rather than defaulted: a simulation running against an assumed broker deadline is " +
      "the defect this table replaced.",
  };
}

/**
 * The profile the owner's own trading implies for a DSL universe + resolution.
 *
 * NSE intraday resolves the NON_CAS equity MIS profile, and the assumption travels with it. BSE
 * has no record, so the resolution is honestly unavailable. US resolves the exchange-only
 * stand-in, whose UNVERIFIED status flows into every warning derived from it.
 */
export function executionContextFor(
  universeMarket: "US" | "NSE" | "BSE",
  resolution: string,
  at: Date,
): ProfileResolution {
  const intraday = resolution !== "D";
  if (universeMarket === "US") {
    return executionProfileFor({ broker: "US_EXCHANGE_ONLY", exchange: "XNAS", segment: "EQ", product: "CASH", at, securityClass: "ANY" });
  }
  return executionProfileFor({
    broker: OWNER_BROKER,
    exchange: universeMarket,
    segment: "EQ",
    product: intraday ? "MIS" : "CNC",
    at,
  });
}

function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** One line of provenance for warnings and UI: what binds, whose rule, on what authority. */
export function describeExecution(profile: BrokerExecutionProfile): string {
  const primary = profile.sources[0];
  const deadline =
    profile.mandatoryExitMinute === null
      ? "no forced exit; overnight holding is allowed"
      : `forced flat by ${formatMinute(profile.mandatoryExitMinute)} local time`;
  const confidence =
    primary.confidence === "independently_fetched"
      ? `source fetched ${primary.retrievedAt}`
      : primary.confidence === "owner_review_reported"
        ? `reported in owner review ${primary.retrievedAt}, not independently fetched`
        : "assumed - no broker source";
  const charge =
    profile.autoSquareOffCharge === null
      ? ""
      : ` A broker-forced square-off costs Rs ${profile.autoSquareOffCharge.amount} + GST per order.`;
  const status =
    profile.verificationStatus === "VERIFIED"
      ? ""
      : profile.verificationStatus === "CONFLICTED"
        ? ` Status CONFLICTED: official sources disagree (${(profile.conflictingSourceIds ?? []).join(", ")}); the conservative value is used as a stated research assumption.`
        : ` Status ${profile.verificationStatus}.`;
  return `${profile.broker} ${profile.exchange} ${profile.product} (${profile.securityClass}): ${deadline} (${confidence}; policy ${profile.policyVersion}).${charge}${status}`;
}
