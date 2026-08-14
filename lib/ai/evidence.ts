import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResearchSnapshot } from "@/lib/market/service";
import type { DataQuality, Instrument } from "@/lib/market/types";

export interface EvidenceItem {
  id: string;
  label: string;
  value: unknown;
  quality: DataQuality | "CALCULATED";
  sourceId: string;
}

export interface EvidencePackage {
  instrument: Instrument;
  generatedAt: string;
  snapshotHash: string;
  items: EvidenceItem[];
}

export const EvidenceItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(300),
  value: z.unknown(),
  // FIXTURE mirrors DataQuality: evidence assembled from deterministic test data must be able to
  // say so. Omitting it did not keep fixtures out — it made the schema reject them outright, so
  // an evidence package built in test mode failed validation instead of being labelled.
  quality: z.enum(["LIVE", "DELAYED", "STALE", "CONFLICTED", "UNAVAILABLE", "AUTH_REQUIRED", "CALCULATED", "FIXTURE"]),
  sourceId: z.string().trim().min(1).max(300),
}).strict();

export const EvidencePackageSchema = z.object({
  instrument: z.object({
    id: z.string().trim().min(1).max(64),
    market: z.enum(["US", "IN"]),
    exchange: z.enum(["XNAS", "XNYS", "XNSE", "XBOM"]),
    symbol: z.string().trim().min(1).max(40),
    providerSymbol: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(200),
    currency: z.enum(["USD", "INR"]),
    timezone: z.enum(["America/New_York", "Asia/Kolkata"]),
    assetType: z.enum(["EQUITY", "ETF", "REIT", "INVIT"]),
  }).strict(),
  generatedAt: z.string().datetime(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(EvidenceItemSchema).max(40),
}).strict();

export function evidenceSnapshotHash(
  instrumentId: string,
  items: readonly EvidenceItem[],
  generatedAt: string,
): string {
  return createHash("sha256").update(JSON.stringify({ instrument: instrumentId, generatedAt, items })).digest("hex");
}

export function hasValidEvidenceHash(evidence: EvidencePackage): boolean {
  return evidence.snapshotHash === evidenceSnapshotHash(evidence.instrument.id, evidence.items, evidence.generatedAt);
}

const MAX_SERIALIZED_CHARACTERS = 24_000;

export function buildEvidencePackage(snapshot: ResearchSnapshot): EvidencePackage {
  const items: EvidenceItem[] = [
    {
      id: "quote",
      label: "Latest normalized quote",
      value: {
        price: snapshot.quote.price,
        currency: snapshot.quote.currency,
        changePct: snapshot.quote.changePct,
        volume: snapshot.quote.volume,
        sourceEventAt: snapshot.quote.provenance.sourceEventAt,
      },
      quality: snapshot.quote.provenance.quality,
      sourceId: snapshot.quote.provenance.sourceId,
    },
    {
      id: "technical:summary",
      label: "Calculated technical indicators",
      value: snapshot.technicals,
      quality: "CALCULATED",
      sourceId: snapshot.candles.provenance.sourceId,
    },
    {
      id: "signal:bull",
      label: "Rule-based bull evidence",
      value: snapshot.signals.bull.slice(0, 10),
      quality: "CALCULATED",
      sourceId: snapshot.snapshotId,
    },
    {
      id: "signal:bear",
      label: "Rule-based bear evidence",
      value: snapshot.signals.bear.slice(0, 10),
      quality: "CALCULATED",
      sourceId: snapshot.snapshotId,
    },
    {
      id: "fundamental:summary",
      label: "Available fundamentals",
      value: snapshot.fundamentals,
      quality: Object.values(snapshot.fundamentals).some((value) => value !== null) ? "DELAYED" : "AUTH_REQUIRED",
      sourceId: `fundamentals:${snapshot.instrument.providerSymbol}`,
    },
    {
      id: "analyst:summary",
      label: "Available analyst evidence",
      value: {
        ratings: snapshot.analystRatings.slice(0, 4),
        target: snapshot.priceTarget,
      },
      quality: snapshot.analystRatings.length ? "DELAYED" : "AUTH_REQUIRED",
      sourceId: `analyst:${snapshot.instrument.providerSymbol}`,
    },
    ...snapshot.news.slice(0, 12).map((article, index): EvidenceItem => ({
      id: `news:${index + 1}`,
      label: article.headline.slice(0, 200),
      value: {
        summary: article.summary.slice(0, 600),
        source: article.source,
        publishedAt: article.publishedAt.toISOString(),
        sentiment: article.sentiment,
      },
      quality: "DELAYED",
      sourceId: article.id,
    })),
  ];

  const bounded: EvidenceItem[] = [];
  for (const item of items) {
    const candidate = [...bounded, item];
    if (JSON.stringify(candidate).length > MAX_SERIALIZED_CHARACTERS) break;
    bounded.push(item);
  }
  return {
    instrument: snapshot.instrument,
    generatedAt: snapshot.generatedAt,
    snapshotHash: evidenceSnapshotHash(snapshot.instrument.id, bounded, snapshot.generatedAt),
    items: bounded,
  };
}

export function assertValidCitations(analysis: { citations: Array<{ evidenceId: string }> }, evidence: EvidencePackage): void {
  const ids = new Set(evidence.items.map((item) => item.id));
  const invalid = analysis.citations.find((citation) => !ids.has(citation.evidenceId));
  if (invalid) throw new AiOutputError(`Unknown evidence citation: ${invalid.evidenceId}`);
}

export class AiOutputError extends Error {
  readonly code = "INVALID_MODEL_OUTPUT";
}
