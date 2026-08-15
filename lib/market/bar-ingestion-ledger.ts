import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { BarAudit } from "./bar-audit";
import type { IdentityVerdict } from "./identity-guard";

/**
 * The append-only record of every bar fetch: the request beside the response.
 *
 * Until an owner promotes and registers the pending migration
 * (`docs/plans/nse-data-coverage/pending-migration/`, two steps, README beside it), this table
 * does not exist at runtime. That is handled rather than worked
 * around — recording becomes a no-op returning `false`, the ingest itself is unaffected, and the
 * audit still travels in the ingest outcome. The interim state is safe, not broken (the same
 * choice `researchIdentityReady` makes for its tables).
 */

export function barIngestionLedgerReady(): boolean {
  try {
    getDb().select().from(schema.barIngestions).limit(1).all();
    return true;
  } catch {
    return false;
  }
}

export interface BarIngestionRecord {
  instrumentId: string;
  resolution: string;
  source: string;
  identityVerdict: IdentityVerdict;
  audit: BarAudit;
  inserted: number;
  skipped: number;
  rejected: number;
}

/** Returns false when the ledger table is not registered yet — never throws into an ingest. */
export function recordBarIngestion(record: BarIngestionRecord, now = new Date()): boolean {
  try {
    getDb()
      .insert(schema.barIngestions)
      .values({
        instrumentId: record.instrumentId,
        resolution: record.resolution,
        source: record.source,
        requestedStart: record.audit.requestedStart,
        requestedEnd: record.audit.requestedEnd,
        returnedFirstBar: record.audit.returnedFirstBar,
        returnedLastBar: record.audit.returnedLastBar,
        returnedBarCount: record.audit.returnedBarCount,
        inserted: record.inserted,
        skipped: record.skipped,
        rejected: record.rejected,
        identityVerdict: record.identityVerdict,
        completeness: record.audit.completeness,
        expectedSessions: record.audit.expectedSessions,
        observedSessions: record.audit.observedSessions,
        duplicateTimestamps: record.audit.duplicateTimestamps,
        outOfSessionBars: record.audit.outOfSessionBars,
        shortSessions: record.audit.shortSessions,
        detail: record.audit.detail,
        ingestedAt: now,
      })
      .run();
    return true;
  } catch {
    return false;
  }
}

export interface IngestionHealth {
  recorded: number;
  byCompleteness: Record<string, number>;
  /** Fetches whose identity could not be verified — visible, not silent. */
  unstatedIdentity: number;
  /** The most recent record per instrument+resolution, newest first. */
  recent: {
    instrumentId: string;
    resolution: string;
    source: string;
    completeness: string;
    returnedBarCount: number;
    observedSessions: number;
    expectedSessions: number | null;
    ingestedAt: string;
  }[];
}

/** What the ledger says about recent fetch health. Empty (not zero-claiming) when unregistered. */
export function ingestionHealth(limit = 20): IngestionHealth | null {
  if (!barIngestionLedgerReady()) return null;
  const rows = getDb()
    .select()
    .from(schema.barIngestions)
    .orderBy(desc(schema.barIngestions.ingestedAt))
    .limit(500)
    .all();

  const byCompleteness: Record<string, number> = {};
  let unstatedIdentity = 0;
  for (const row of rows) {
    byCompleteness[row.completeness] = (byCompleteness[row.completeness] ?? 0) + 1;
    if (row.identityVerdict === "UNSTATED") unstatedIdentity += 1;
  }

  return {
    recorded: rows.length,
    byCompleteness,
    unstatedIdentity,
    recent: rows.slice(0, limit).map((row) => ({
      instrumentId: row.instrumentId,
      resolution: row.resolution,
      source: row.source,
      completeness: row.completeness,
      returnedBarCount: row.returnedBarCount,
      observedSessions: row.observedSessions,
      expectedSessions: row.expectedSessions,
      ingestedAt: row.ingestedAt.toISOString(),
    })),
  };
}

/** The latest audit for one instrument+resolution — what the planner consults before re-fetching. */
export function latestIngestion(instrumentId: string, resolution: string) {
  if (!barIngestionLedgerReady()) return null;
  return (
    getDb()
      .select()
      .from(schema.barIngestions)
      .where(eq(schema.barIngestions.instrumentId, instrumentId))
      .orderBy(desc(schema.barIngestions.ingestedAt))
      .all()
      .find((row) => row.resolution === resolution) ?? null
  );
}
