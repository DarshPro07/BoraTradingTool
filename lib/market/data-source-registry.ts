/**
 * DataSourceRegistry — formal classification of all data sources by trust tier.
 *
 * Architecture:
 *
 *   Tier 0: Identity/Reference truth (NSE official)
 *   Tier 1: Market feeds (Upstox V3, licensed providers)
 *   Tier 2: Controlled alternative sources (jugaad-data, nsepython, etc.)
 *   Tier 3: Research datasets (aeron7, Kaggle, external CSVs)
 *   Tier 4: Code/research ideas (GitHub bots, awesome-quant)
 *
 * External datasets must pass through QuARANTINE before entering the canonical store.
 */

export type DataProviderId =
  | "nse-official"
  | "nse-equity-quote"
  | "upstox-v3"
  | "jugaad-data"
  | "nsepython"
  | "openchart"
  | "nseazy"
  | "yahoo"
  | "alpha-vantage"
  | "aeron7-archive"
  | "kaggle-csv"
  | "rajgmishra-dataset"
  | "external-csv";

export type SourceTier = 0 | 1 | 2 | 3 | 4;

export type SourceType =
  | "IDENTITY_REFERENCE"
  | "MARKET_FEED"
  | "CONTROLLED_ALTERNATIVE"
  | "RESEARCH_DATASET"
  | "CODE_IDEA";

export type OfficialStatus = "OFFICIAL" | "CACHE_OF_OFFICIAL" | "UNOFFICIAL" | "DERIVED";

export type AdjustmentPolicy = "RAW" | "ADJUSTED" | "UNKNOWN";

export type CommercialUse = "PERMITTED" | "RESEARCH_ONLY" | "UNKNOWN" | "PROHIBITED";

export interface DataSourceEntry {
  sourceId: DataProviderId;
  sourceType: SourceType;
  tier: SourceTier;
  provider: string;
  market: "IN" | "US" | "GLOBAL";
  instrumentClass: string;
  resolution: string;
  coverageStart: Date | null;
  coverageEnd: Date | null;
  provenance: string;
  officialStatus: OfficialStatus;
  license: string | null;
  commercialUse: CommercialUse;
  redistribution: CommercialUse;
  adjustmentPolicy: AdjustmentPolicy;
  timezone: string;
  sessionPolicy: string;
  corporateActionPolicy: string;
  expectedLatency: "REALTIME" | "DELAYED" | "BATCH" | "UNKNOWN";
  freshness: "REALTIME" | "DELAYED_15M" | "END_OF_DAY" | "STATIC" | "UNKNOWN";
  qualityScore: number; // 0-100
  crossValidatedAgainst: DataProviderId[];
  status: "ACTIVE" | "INACTIVE" | "DEPRECATED" | "QUARANTINE";
}

/**
 * The canonical data source registry.
 * Each source is classified by trust tier and usage constraints.
 */
export const DATA_SOURCE_REGISTRY: Readonly<Record<DataProviderId, DataSourceEntry>> = Object.freeze({
  "nse-official": {
    sourceId: "nse-official",
    sourceType: "IDENTITY_REFERENCE",
    tier: 0,
    provider: "NSE India",
    market: "IN",
    instrumentClass: "ALL",
    resolution: "REFERENCE",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Official NSE security/reference files",
    officialStatus: "OFFICIAL",
    license: "NSE terms of use",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    adjustmentPolicy: "RAW",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "OFFICIAL",
    expectedLatency: "BATCH",
    freshness: "END_OF_DAY",
    qualityScore: 100,
    crossValidatedAgainst: [],
    status: "ACTIVE",
  },
  /**
   * NSE's own equity-quote surface. Registered so it can be named and REFUSED explicitly rather
   * than being an unknown; probed 2026-08-16 and blocked for server-side requests (60/60 HTTP
   * 403). See SOURCE_CAPABILITIES for the evidence.
   */
  "nse-equity-quote": {
    sourceId: "nse-equity-quote",
    sourceType: "IDENTITY_REFERENCE",
    tier: 0,
    provider: "NSE India",
    market: "IN",
    instrumentClass: "EQUITY",
    resolution: "REFERENCE",
    coverageStart: null,
    coverageEnd: null,
    provenance: "NSE official equity quote surface (four-level industry classification)",
    officialStatus: "OFFICIAL",
    license: "NSE terms of use",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    adjustmentPolicy: "RAW",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "OFFICIAL",
    expectedLatency: "UNKNOWN",
    freshness: "UNKNOWN",
    qualityScore: 100,
    crossValidatedAgainst: [],
    status: "QUARANTINE",
  },
  "upstox-v3": {
    sourceId: "upstox-v3",
    sourceType: "MARKET_FEED",
    tier: 1,
    provider: "Upstox",
    market: "IN",
    instrumentClass: "EQUITY_FO",
    resolution: "REALTIME",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Upstox Market Data Feed V3 (WebSocket/Protobuf) and V3 historical-candle REST",
    officialStatus: "UNOFFICIAL",
    license: "Upstox developer terms",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    // Corrected 2026-08-17 from "RAW", which was wrong and would have licensed a double
    // adjustment. Measured against the raw NSE bhavcopy across RELIANCE's 2024-10-28 1:1 bonus,
    // Upstox's pre-bonus closes sit at exactly 2.0000x — it back-adjusts. That matters: a single
    // full-history fetch therefore carries ONE basis by construction, which is the property the
    // accumulated Yahoo series lacks (docs/plans/rehearsal-funnel/04-corporate-action-discontinuity.md).
    adjustmentPolicy: "ADJUSTED",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "EXCHANGE_REPORTED",
    expectedLatency: "REALTIME",
    freshness: "REALTIME",
    qualityScore: 95,
    crossValidatedAgainst: ["nse-official"],
    status: "ACTIVE",
  },
  "jugaad-data": {
    sourceId: "jugaad-data",
    sourceType: "CONTROLLED_ALTERNATIVE",
    tier: 2,
    provider: "jugaad-py",
    market: "IN",
    instrumentClass: "EQUITY_FO_INDICES",
    resolution: "D",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Unofficial NSE/RBI data retrieval with caching",
    officialStatus: "UNOFFICIAL",
    license: "MIT",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "DELAYED",
    freshness: "END_OF_DAY",
    qualityScore: 75,
    crossValidatedAgainst: ["nse-official"],
    status: "ACTIVE",
  },
  nsepython: {
    sourceId: "nsepython",
    sourceType: "CONTROLLED_ALTERNATIVE",
    tier: 2,
    provider: "aeron7",
    market: "IN",
    instrumentClass: "EQUITY_INDICES",
    resolution: "D",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Unofficial Python wrapper over public NSE REST endpoints",
    officialStatus: "UNOFFICIAL",
    license: "MIT",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "DELAYED",
    freshness: "END_OF_DAY",
    qualityScore: 70,
    crossValidatedAgainst: ["nse-official"],
    status: "ACTIVE",
  },
  openchart: {
    sourceId: "openchart",
    sourceType: "CONTROLLED_ALTERNATIVE",
    tier: 2,
    provider: "marketcalls",
    market: "IN",
    instrumentClass: "EQ_FO_INDICES",
    resolution: "1m_to_M",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Unofficial NSE public chart API for research/education",
    officialStatus: "UNOFFICIAL",
    license: "MIT",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "DELAYED",
    freshness: "END_OF_DAY",
    qualityScore: 65,
    crossValidatedAgainst: ["jugaad-data"],
    status: "ACTIVE",
  },
  nseazy: {
    sourceId: "nseazy",
    sourceType: "CONTROLLED_ALTERNATIVE",
    tier: 2,
    provider: "DrChandrakant",
    market: "IN",
    instrumentClass: "EQUITY_INDICES",
    resolution: "D",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Unofficial NSE/NIFTY public data via pandas-friendly API",
    officialStatus: "UNOFFICIAL",
    license: "MIT",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "DELAYED",
    freshness: "END_OF_DAY",
    qualityScore: 60,
    crossValidatedAgainst: ["jugaad-data"],
    status: "ACTIVE",
  },
  yahoo: {
    sourceId: "yahoo",
    sourceType: "CONTROLLED_ALTERNATIVE",
    tier: 2,
    provider: "Yahoo Finance",
    market: "GLOBAL",
    instrumentClass: "EQUITY",
    resolution: "1m_to_M",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Yahoo Finance public API — research/educational use only",
    officialStatus: "UNOFFICIAL",
    license: "Yahoo terms of use",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    adjustmentPolicy: "ADJUSTED",
    timezone: "VARIES",
    sessionPolicy: "EXCHANGE_REPORTED",
    corporateActionPolicy: "YAHOO_ADJUSTED",
    expectedLatency: "DELAYED",
    freshness: "DELAYED_15M",
    qualityScore: 55,
    crossValidatedAgainst: ["nse-official"],
    status: "ACTIVE",
  },
  "alpha-vantage": {
    sourceId: "alpha-vantage",
    sourceType: "CONTROLLED_ALTERNATIVE",
    tier: 2,
    provider: "Alpha Vantage",
    market: "GLOBAL",
    instrumentClass: "EQUITY",
    resolution: "1m_to_M",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Alpha Vantage API — delayed US data is premium, historical/delayed is free tier",
    officialStatus: "UNOFFICIAL",
    license: "Alpha Vantage terms",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "ADJUSTED",
    timezone: "VARIES",
    sessionPolicy: "EXCHANGE_REPORTED",
    corporateActionPolicy: "PROVIDER_ADJUSTED",
    expectedLatency: "DELAYED",
    freshness: "DELAYED_15M",
    qualityScore: 50,
    crossValidatedAgainst: ["yahoo"],
    status: "ACTIVE",
  },
  "aeron7-archive": {
    sourceId: "aeron7-archive",
    sourceType: "RESEARCH_DATASET",
    tier: 3,
    provider: "aeron7",
    market: "IN",
    instrumentClass: "NIFTY_BANKNIFTY",
    resolution: "1m",
    coverageStart: new Date("2012-01-01"),
    coverageEnd: new Date("2023-12-31"),
    provenance: "One-minute NIFTY/BANKNIFTY data organized by year/month/day",
    officialStatus: "UNOFFICIAL",
    license: "Unknown",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "BATCH",
    freshness: "STATIC",
    qualityScore: 60,
    crossValidatedAgainst: [],
    status: "ACTIVE",
  },
  "kaggle-csv": {
    sourceId: "kaggle-csv",
    sourceType: "RESEARCH_DATASET",
    tier: 3,
    provider: "Kaggle",
    market: "IN",
    instrumentClass: "NIFTY_INDICES",
    resolution: "1m",
    coverageStart: new Date("2015-01-01"),
    coverageEnd: new Date("2024-08-31"),
    provenance: "Kaggle dataset from internet/Google Drive sources — weak provenance",
    officialStatus: "UNOFFICIAL",
    license: "CC0 (claimed, but uploader disclaims ownership)",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "RESEARCH_ONLY",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "BATCH",
    freshness: "STATIC",
    qualityScore: 40,
    crossValidatedAgainst: [],
    status: "ACTIVE",
  },
  "rajgmishra-dataset": {
    sourceId: "rajgmishra-dataset",
    sourceType: "RESEARCH_DATASET",
    tier: 3,
    provider: "rajgmishra",
    market: "IN",
    instrumentClass: "NIFTY50",
    resolution: "15m",
    coverageStart: null,
    coverageEnd: null,
    provenance: "Extracted via paid Zerodha Kite Connect — academic/research only",
    officialStatus: "UNOFFICIAL",
    license: "Academic/research use only",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    adjustmentPolicy: "UNKNOWN",
    timezone: "Asia/Kolkata",
    sessionPolicy: "NSE_CALENDAR",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "BATCH",
    freshness: "STATIC",
    qualityScore: 50,
    crossValidatedAgainst: [],
    status: "ACTIVE",
  },
  "external-csv": {
    sourceId: "external-csv",
    sourceType: "RESEARCH_DATASET",
    tier: 3,
    provider: "Various",
    market: "GLOBAL",
    instrumentClass: "OTHER",
    resolution: "UNKNOWN",
    coverageStart: null,
    coverageEnd: null,
    provenance: "External CSV — unknown provenance until validated",
    officialStatus: "UNOFFICIAL",
    license: "Unknown",
    commercialUse: "RESEARCH_ONLY",
    redistribution: "PROHIBITED",
    adjustmentPolicy: "UNKNOWN",
    timezone: "UNKNOWN",
    sessionPolicy: "UNKNOWN",
    corporateActionPolicy: "UNKNOWN",
    expectedLatency: "BATCH",
    freshness: "STATIC",
    qualityScore: 20,
    crossValidatedAgainst: [],
    status: "QUARANTINE" as const,
  },
});

/**
 * Get the data source entry for a provider ID.
 */
export function getDataSource(sourceId: DataProviderId): DataSourceEntry | null {
  return DATA_SOURCE_REGISTRY[sourceId] ?? null;
}

/**
 * Check if a source is approved for a given use case.
 */
export function isSourceApprovedFor(sourceId: DataProviderId, useCase: string): boolean {
  const source = DATA_SOURCE_REGISTRY[sourceId];
  if (!source || source.status === "INACTIVE" || source.status === "DEPRECATED") return false;

  switch (useCase) {
    case "INSTRUMENT_IDENTITY":
      return source.tier === 0;
    case "LIVE_MARKET":
      return source.tier <= 1;
    case "HISTORICAL_BARS":
      return source.tier <= 2;
    case "CORPORATE_ACTIONS":
      return source.tier <= 1;
    case "RESEARCH_EVIDENCE":
      return source.tier <= 3;
    case "ML_TRAINING":
      return source.tier <= 3;
    default:
      return false;
  }
}
