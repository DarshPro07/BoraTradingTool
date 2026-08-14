import type { DataProviderId } from "./data-source-registry";
import { getDataSource, isSourceApprovedFor } from "./data-source-registry";

/**
 * DataSourcePriorityPolicy — for each data category, define preferred sources.
 *
 * Never silently substitute one category's fallback for another.
 *
 * Instrument identity: NSE official → cached last-known-good NSE
 * Live market: Upstox V3 when authenticated/configured
 * Historical bars: configured licensed source → approved fallback
 * Corporate actions: official exchange → verified secondary fallback
 */

export type DataCategory =
  | "INSTRUMENT_IDENTITY"
  | "LIVE_MARKET"
  | "HISTORICAL_BARS"
  | "CORPORATE_ACTIONS"
  | "RESEARCH_EVIDENCE"
  | "ML_TRAINING";

export interface SourcePriority {
  category: DataCategory;
  preferred: DataProviderId[];
  fallbacks: DataProviderId[];
  refuseIfUnavailable: boolean;
}

/**
 * The canonical priority policy for data categories.
 */
export const DATA_SOURCE_PRIORITY: Readonly<Record<DataCategory, SourcePriority>> = Object.freeze({
  INSTRUMENT_IDENTITY: {
    category: "INSTRUMENT_IDENTITY",
    preferred: ["nse-official"],
    fallbacks: [],
    refuseIfUnavailable: true, // Never fall back to Yahoo for identity
  },
  LIVE_MARKET: {
    category: "LIVE_MARKET",
    preferred: ["upstox-v3"],
    fallbacks: ["yahoo", "alpha-vantage"],
    refuseIfUnavailable: false,
  },
  HISTORICAL_BARS: {
    category: "HISTORICAL_BARS",
    preferred: ["jugaad-data", "nsepython"],
    fallbacks: ["yahoo", "openchart"],
    refuseIfUnavailable: false,
  },
  CORPORATE_ACTIONS: {
    category: "CORPORATE_ACTIONS",
    preferred: ["nse-official", "jugaad-data"],
    fallbacks: ["nsepython"],
    refuseIfUnavailable: true, // Corporate actions must be from reliable sources
  },
  RESEARCH_EVIDENCE: {
    category: "RESEARCH_EVIDENCE",
    preferred: ["nse-official", "jugaad-data"],
    fallbacks: ["yahoo", "alpha-vantage", "aeron7-archive"],
    refuseIfUnavailable: false,
  },
  ML_TRAINING: {
    category: "ML_TRAINING",
    preferred: ["aeron7-archive", "rajgmishra-dataset"],
    fallbacks: ["kaggle-csv", "external-csv"],
    refuseIfUnavailable: false,
  },
});

/**
 * Get the preferred source for a data category.
 */
export function getPreferredSource(category: DataCategory): DataProviderId | null {
  const policy = DATA_SOURCE_PRIORITY[category];
  for (const sourceId of policy.preferred) {
    const source = getDataSource(sourceId);
    if (source && source.status === "ACTIVE" && isSourceApprovedFor(sourceId, category)) {
      return sourceId;
    }
  }
  return null;
}

/**
 * Get the fallback sources for a data category.
 */
export function getFallbackSources(category: DataCategory): DataProviderId[] {
  const policy = DATA_SOURCE_PRIORITY[category];
  const fallbacks: DataProviderId[] = [];
  for (const sourceId of policy.fallbacks) {
    const source = getDataSource(sourceId);
    if (source && source.status === "ACTIVE" && isSourceApprovedFor(sourceId, category)) {
      fallbacks.push(sourceId);
    }
  }
  return fallbacks;
}

/**
 * Select the best source for a data category.
 * Returns the preferred source, or the first available fallback.
 * Returns null if no source is available and refuseIfUnavailable is true.
 */
export function selectSourceForCategory(category: DataCategory): {
  sourceId: DataProviderId;
  isFallback: boolean;
  reason: string;
} | null {
  const preferred = getPreferredSource(category);
  if (preferred) {
    return { sourceId: preferred, isFallback: false, reason: `Preferred source for ${category}` };
  }

  const fallbacks = getFallbackSources(category);
  if (fallbacks.length > 0) {
    return {
      sourceId: fallbacks[0],
      isFallback: true,
      reason: `Preferred source unavailable for ${category}, using fallback`,
    };
  }

  const policy = DATA_SOURCE_PRIORITY[category];
  if (policy.refuseIfUnavailable) {
    return null;
  }

  return null;
}
