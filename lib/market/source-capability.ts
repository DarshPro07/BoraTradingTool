import type { DataProviderId } from "./data-source-registry";
import { usagePermitted, type DataPurpose } from "./source-usage-policy";

/**
 * What each data source CAN actually do — declared, evidenced and dated, so the planner asks a
 * question instead of discovering a limitation by repeatedly failing requests.
 *
 * ## The claim contract (owner rule, 2026-08-16)
 *
 * This repository shipped a wrong "intraday history cannot be backfilled" claim that had neither
 * a citation nor a probe behind it — it was an assumption written in the voice of a fact. The
 * rule that replaces it:
 *
 *     An external-capability claim carries a sourceCitation OR probeEvidence, plus verifiedAt.
 *     A claim older than its freshness horizon reads UNKNOWN — never truth.
 *
 * UNKNOWN is not "no". It means the machine must re-probe before relying on it, exactly as
 * `RESOURCE_NOT_PROVIDED` means "ask", not "zero".
 */

export interface ExternalCapabilityClaim {
  /** Documentation the claim rests on, when it rests on documentation. */
  sourceCitation?: string;
  /** A probe actually run from this machine, when the claim rests on observation. */
  probeEvidence?: string;
  /** ISO date the evidence above was gathered. */
  verifiedAt: string;
}

export interface SourceCapability {
  sourceId: DataProviderId;
  /** Full daily/EOD history. */
  dailyHistorical: boolean;
  /** Historical intraday bars (as opposed to today's session only). */
  intradayHistorical: boolean;
  /**
   * How far back intraday history reaches. `null` = the source serves no intraday history;
   * a number = a trailing window in days; a date = a fixed floor (Upstox: minute data from
   * 2022-01).
   */
  intradayLookbackDays: number | null;
  intradayHistoryFloor: string | null;
  /** May this source define canonical instrument identity? Only the exchange's own files may. */
  canonicalIdentity: boolean;
  /** May results from this source stand as validation/holdout truth? Research datasets may not. */
  validationAuthority: boolean;
  /** Does using it require credentials the owner must supply? */
  authenticated: boolean;
  /** Live/streaming quotes or bars. */
  realtime: boolean;
  claim: ExternalCapabilityClaim;
  /** Set when the source is known-unhealthy right now; the planner must route around it. */
  disabledReason?: string;
}

/** A claim older than this reads UNKNOWN — external services change without telling us. */
export const CAPABILITY_FRESHNESS_DAYS = 90;

export const SOURCE_CAPABILITIES: Readonly<Partial<Record<DataProviderId, SourceCapability>>> = Object.freeze({
  "nse-official": {
    sourceId: "nse-official",
    dailyHistorical: false,
    intradayHistorical: false,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: true,
    validationAuthority: true,
    authenticated: false,
    realtime: false,
    claim: {
      sourceCitation: "NSE official archives (MAIN/SME/ETF/REIT/INVIT security lists)",
      probeEvidence: "the live security master holds 3,325 securities synced from these files",
      verifiedAt: "2026-08-16",
    },
  },
  yahoo: {
    sourceId: "yahoo",
    dailyHistorical: true,
    intradayHistorical: true,
    // A trailing window, NOT an archive: intraday beyond ~60 days is not served at all. The
    // accumulator's 59-day request keeps a deliberate margin off that boundary rather than
    // testing it every session.
    intradayLookbackDays: 60,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    validationAuthority: false,
    authenticated: false,
    realtime: false,
    claim: {
      sourceCitation: "yfinance documents intraday (5m/15m) limited to the most recent 60 days",
      probeEvidence:
        "2026-08-16 from this machine: TCS.NS 5m over a 55-day window returned 4,125 bars / 55 " +
        "sessions raw, 2,903 bars / 39 sessions through lib/providers/yahoo after the window fix",
      verifiedAt: "2026-08-16",
    },
  },
  "upstox-v3": {
    sourceId: "upstox-v3",
    dailyHistorical: true,
    intradayHistorical: true,
    intradayLookbackDays: null,
    // The strongest DEEP intraday source available to this deployment — the one that answers
    // requirements Yahoo's 60-day window structurally cannot.
    intradayHistoryFloor: "2022-01-01",
    canonicalIdentity: false,
    validationAuthority: true,
    authenticated: true,
    realtime: true,
    claim: {
      sourceCitation:
        "Upstox Historical Candle Data V3: DAILY candles from January 2000 (measured 2026-08-17: " +
        "RELIANCE 6,598 bars from 2000-01-03, paged in decade windows; >decade rejects UDAPI1148). " +
        "Minute candles from January 2022, intervals 1-300m (1-15m in one-month chunks); " +
        "Intraday V3 is current-day only",
      verifiedAt: "2026-08-17",
    },
    // Stated at the granularity the owner has to reason about, because the two surfaces differ and
    // one flat "disabled" would be false in both directions.
    //
    //   DAILY HISTORICAL  in use. The documented V3 historical-candle endpoint answers an
    //                     unauthenticated request; 60 instruments were backfilled through it.
    //   EVERYTHING ELSE   unavailable. Intraday history, quotes, streaming and any order path need
    //                     an OAuth app and access token, and no owner credential exists.
    //
    // Owner decision 2026-08-17: keep the integration and do not open an account under time
    // pressure. Nothing is lost by leaving the authenticated surface dormant.
    disabledReason:
      "AUTH_REQUIRED for intraday, quotes and orders — no owner credentials configured. Daily " +
      "historical reads need no token and are active; see lib/providers/upstox.ts",
  },
  "jugaad-data": {
    sourceId: "jugaad-data",
    dailyHistorical: true,
    intradayHistorical: false,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    validationAuthority: false,
    authenticated: false,
    realtime: false,
    claim: {
      sourceCitation:
        "jugaad-py/jugaad-data: live and historical NSE stocks/indices/F&O and bhavcopy " +
        "downloads, with caching to avoid hammering NSE",
      verifiedAt: "2026-08-16",
    },
    disabledReason: "not wired yet — queued as the daily-history fallback",
  },
  openchart: {
    sourceId: "openchart",
    dailyHistorical: true,
    intradayHistorical: true,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    validationAuthority: false,
    authenticated: false,
    realtime: false,
    claim: {
      probeEvidence:
        "2026-08-16 from this machine, openchart 0.2.0: the charting API answered " +
        '{"status":true,"data":[]} for every payload probed including NIFTY 50 daily by its ' +
        "known scripcode 26000; search() returns the same default index list for every query",
      verifiedAt: "2026-08-16",
    },
    disabledReason:
      "UNHEALTHY as probed: returns no data, and its search ignores the query — its own " +
      "'use the first result' fallback would serve NIFTY 50 for a TCS request (the identity " +
      "guard would now refuse that, but the source is useless until it answers at all)",
  },
  /**
   * NSE's own equity-quote surface — the one that exposes the four-level classification
   * (Basic Industry → Industry → Sector → Macro) for names outside every index.
   *
   * BLOCKED from this deployment, measured rather than assumed: 60 canonical symbols requested
   * against `/api/quote-equity` returned HTTP 403 sixty times out of sixty; `www.nseindia.com`
   * itself answers 403 and the get-quote page 404, even after a cookie handshake and with a
   * page Referer. The archives host (`nsearchives.nseindia.com`) is a DIFFERENT host with
   * different protection and continues to serve the constituent CSVs normally.
   *
   * So the classification data genuinely exists and is visible in a real browser — it is the
   * server-side fetch that is refused. An autonomous ingestion lane cannot be built on it from
   * here; that would need either a browser context or NSE Indices' licensed product.
   */
  "nse-equity-quote": {
    sourceId: "nse-equity-quote",
    dailyHistorical: false,
    intradayHistorical: false,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    validationAuthority: false,
    authenticated: false,
    realtime: false,
    claim: {
      probeEvidence:
        "2026-08-16 from this machine: 60/60 HTTP 403 on /api/quote-equity across a diverse " +
        "sample (50 non-index + 10 index names), 403 on the site root, 404 on the get-quote " +
        "page; p50 latency 118ms so the refusal is immediate, not a timeout",
      verifiedAt: "2026-08-16",
    },
    disabledReason:
      "edge-blocked for server-side requests (403). The four-level classification it exposes is " +
      "real and browser-visible, but unreachable from this deployment without a browser context " +
      "or a licensed feed",
  },
  nsepython: {
    sourceId: "nsepython",
    dailyHistorical: false,
    intradayHistorical: false,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    validationAuthority: false,
    authenticated: false,
    realtime: true,
    claim: {
      sourceCitation:
        "aeron7/nsepython issue #74 (Jan 2026): historical equity endpoint /api/historical/cm/" +
        "equity returns 404; issue #78 (Jul 2026): an index endpoint returns non-JSON",
      verifiedAt: "2026-08-16",
    },
    disabledReason: "capability-limited: quotes/option-chain/events only — NEVER historical equity",
  },
  "aeron7-archive": {
    sourceId: "aeron7-archive",
    dailyHistorical: false,
    intradayHistorical: true,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    // Tier 3: a research dataset may train and challenge; it may never stand as validation or
    // holdout truth.
    validationAuthority: false,
    authenticated: false,
    realtime: false,
    claim: {
      sourceCitation: "aeron7/nifty-banknifty-intraday-data: offline 1-minute archive by year/month/day",
      verifiedAt: "2026-08-16",
    },
    disabledReason: "research-only dataset; import requires explicit classification",
  },
  "rajgmishra-dataset": {
    sourceId: "rajgmishra-dataset",
    dailyHistorical: false,
    intradayHistorical: true,
    intradayLookbackDays: null,
    intradayHistoryFloor: null,
    canonicalIdentity: false,
    validationAuthority: false,
    authenticated: false,
    realtime: false,
    claim: {
      sourceCitation:
        "rajgmishra/nifty50-15min-ohlc: 15m OHLC with engineered features (EMA/Supertrend); " +
        "its README states the data originated from Zerodha Kite and is intended for research",
      verifiedAt: "2026-08-16",
    },
    disabledReason: "research-only dataset; import requires explicit classification",
  },
});

export type CapabilityAnswer = "YES" | "NO" | "UNKNOWN";

export interface HistoryRequirement {
  resolution: "D" | "INTRADAY";
  /** How far back the requirement reaches, in days from today. */
  lookbackDays: number;
  /** Must the result be usable as validation/holdout truth? */
  validationGrade?: boolean;
  /**
   * What the data would be USED FOR. Checked against the source's usage policy before its
   * technical capability is even considered: a source may deliver exactly the bars asked for and
   * still not be permitted to supply them for this purpose, and that refusal outranks capability.
   */
  purpose?: DataPurpose;
}

/**
 * Can this source satisfy this requirement — answered from declarations, not from a failed
 * request. UNKNOWN when the claim is stale (see CAPABILITY_FRESHNESS_DAYS): the honest answer
 * to "is that still true?" is a re-probe, not an assumption in either direction.
 */
export function canSatisfy(
  sourceId: DataProviderId,
  requirement: HistoryRequirement,
  now = new Date(),
): { answer: CapabilityAnswer; reason: string } {
  // USAGE RIGHTS FIRST. "Can it?" is the second question; "may we?" is the first, and a source
  // that answers no to the second is not made eligible by answering yes to the first.
  const purpose: DataPurpose = requirement.purpose ?? (requirement.validationGrade ? "VALIDATION" : "BACKTEST");
  const usage = usagePermitted(sourceId, purpose, { now });
  if (usage.verdict === "NOT_PERMITTED") return { answer: "NO", reason: usage.reason };
  if (usage.verdict === "UNKNOWN") return { answer: "UNKNOWN", reason: usage.reason };

  const capability = SOURCE_CAPABILITIES[sourceId];
  if (!capability) {
    return { answer: "UNKNOWN", reason: `${sourceId} has no declared capability — probe before relying on it.` };
  }

  const ageDays = (now.getTime() - Date.parse(capability.claim.verifiedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > CAPABILITY_FRESHNESS_DAYS) {
    return {
      answer: "UNKNOWN",
      reason:
        `${sourceId}'s capability claim was verified ${capability.claim.verifiedAt} — beyond the ` +
        `${CAPABILITY_FRESHNESS_DAYS}-day freshness horizon. Re-probe; a stale claim is not truth.`,
    };
  }

  if (capability.disabledReason) {
    return { answer: "NO", reason: `${sourceId} is unavailable: ${capability.disabledReason}` };
  }
  if (requirement.validationGrade && !capability.validationAuthority) {
    return { answer: "NO", reason: `${sourceId} may not stand as validation or holdout truth.` };
  }

  if (requirement.resolution === "D") {
    return capability.dailyHistorical
      ? { answer: "YES", reason: `${sourceId} serves daily history.` }
      : { answer: "NO", reason: `${sourceId} does not serve daily history.` };
  }

  if (!capability.intradayHistorical) {
    return { answer: "NO", reason: `${sourceId} does not serve historical intraday bars.` };
  }
  if (capability.intradayHistoryFloor !== null) {
    const floorAgeDays = (now.getTime() - Date.parse(capability.intradayHistoryFloor)) / 86_400_000;
    return requirement.lookbackDays <= floorAgeDays
      ? { answer: "YES", reason: `${sourceId} serves intraday history from ${capability.intradayHistoryFloor}.` }
      : {
          answer: "NO",
          reason: `${sourceId}'s intraday history begins ${capability.intradayHistoryFloor}; the requirement reaches further back.`,
        };
  }
  if (capability.intradayLookbackDays !== null) {
    return requirement.lookbackDays <= capability.intradayLookbackDays
      ? {
          answer: "YES",
          reason: `${sourceId} serves intraday within its ${capability.intradayLookbackDays}-day trailing window.`,
        }
      : {
          answer: "NO",
          reason:
            `${sourceId} serves only the most recent ${capability.intradayLookbackDays} days of intraday ` +
            `data; ${requirement.lookbackDays} days were required — a deeper source is needed.`,
        };
  }
  return { answer: "UNKNOWN", reason: `${sourceId}'s intraday reach is undeclared.` };
}

/** The sources that can satisfy a requirement today, best-declared-tier first. */
export function sourcesFor(requirement: HistoryRequirement, now = new Date()): DataProviderId[] {
  return (Object.keys(SOURCE_CAPABILITIES) as DataProviderId[]).filter(
    (sourceId) => canSatisfy(sourceId, requirement, now).answer === "YES",
  );
}
