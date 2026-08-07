import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { EvidencePackageSchema, hasValidEvidenceHash, type EvidencePackage } from "@/lib/ai/evidence";
import { getStoredEvidencePackage } from "@/lib/ai/evidence-store";
import {
  AnalystRecordSchema,
  epistemicProfile,
  validateAnalystRecord,
  type AnalystRecord,
} from "./schema";

export const CLAUDE_CODE_PROVIDER = "claude_code" as const;

export class AnalystError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AnalystError";
  }
}

export interface StoredAnalysis {
  id: number;
  instrumentId: string;
  stance: string;
  conviction: number;
  summary: string;
  record: AnalystRecord;
  epistemicProfile: Record<string, number>;
  snapshotHash: string;
  recordedAt: Date;
  evidencePackage: EvidencePackage;
}

/**
 * Persists an analysis produced by Claude Code. The app never calls a Claude subscription
 * itself — Claude Code reasons over the evidence and writes the conclusion back through
 * this path, so the analysis lives in the product with full provenance.
 */
export function recordAnalysis(input: unknown, model = "claude-code"): StoredAnalysis {
  const parsed = AnalystRecordSchema.safeParse(input);
  if (!parsed.success) {
    throw new AnalystError("INVALID_ANALYSIS", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }

  const record = parsed.data;
  const evidencePackage = getStoredEvidencePackage(record.snapshotHash);
  if (!evidencePackage) {
    throw new AnalystError("UNKNOWN_EVIDENCE_SNAPSHOT", "The analysis must reference a server-issued evidence snapshot.");
  }
  const validation = validateAnalystRecord(record, evidencePackage);
  if (!validation.ok) {
    throw new AnalystError(validation.code ?? "INVALID_ANALYSIS", validation.message ?? "Analysis rejected.");
  }

  const now = new Date();
  const snapshotHash = record.snapshotHash;
  const result = getDb()
    .insert(schema.aiRuns)
    .values({
      instrumentId: record.instrumentId,
      provider: CLAUDE_CODE_PROVIDER,
      model,
      purpose: "analyst_record",
      question: record.question ?? null,
      snapshotHash,
      evidenceJson: JSON.stringify(evidencePackage),
      resultJson: JSON.stringify(record),
      status: "succeeded",
      startedAt: now,
      completedAt: now,
    })
    .run();

  return {
    id: Number(result.lastInsertRowid),
    instrumentId: record.instrumentId,
    stance: record.stance,
    conviction: record.conviction,
    summary: record.summary,
    record,
    epistemicProfile: epistemicProfile(record),
    snapshotHash,
    recordedAt: now,
    evidencePackage,
  };
}

function hydrate(row: typeof schema.aiRuns.$inferSelect): StoredAnalysis | null {
  if (!row.resultJson || !row.evidenceJson) return null;
  try {
    const parsed = AnalystRecordSchema.safeParse(JSON.parse(row.resultJson));
    const evidence = EvidencePackageSchema.safeParse(JSON.parse(row.evidenceJson));
    if (!parsed.success || !evidence.success) return null;
    const evidencePackage = evidence.data as EvidencePackage;
    if (!hasValidEvidenceHash(evidencePackage) || !validateAnalystRecord(parsed.data, evidencePackage).ok) return null;
    return {
      id: row.id,
      instrumentId: row.instrumentId,
      stance: parsed.data.stance,
      conviction: parsed.data.conviction,
      summary: parsed.data.summary,
      record: parsed.data,
      epistemicProfile: epistemicProfile(parsed.data),
      snapshotHash: row.snapshotHash,
      recordedAt: row.startedAt,
      evidencePackage,
    };
  } catch {
    return null;
  }
}

export function listAnalyses(limit = 25): StoredAnalysis[] {
  return getDb()
    .select()
    .from(schema.aiRuns)
    .where(eq(schema.aiRuns.purpose, "analyst_record"))
    .orderBy(desc(schema.aiRuns.id))
    .limit(limit)
    .all()
    .map(hydrate)
    .filter((analysis): analysis is StoredAnalysis => analysis !== null);
}

export function listAnalysesForInstrument(instrumentId: string, limit = 10): StoredAnalysis[] {
  return getDb()
    .select()
    .from(schema.aiRuns)
    .where(and(eq(schema.aiRuns.instrumentId, instrumentId), eq(schema.aiRuns.purpose, "analyst_record")))
    .orderBy(desc(schema.aiRuns.id))
    .limit(limit)
    .all()
    .map(hydrate)
    .filter((analysis): analysis is StoredAnalysis => analysis !== null);
}

export function getAnalysis(id: number): StoredAnalysis | null {
  const row = getDb().select().from(schema.aiRuns).where(eq(schema.aiRuns.id, id)).get();
  return row ? hydrate(row) : null;
}
