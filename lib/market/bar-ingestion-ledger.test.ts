import { describe, expect, it } from "vitest";
import { closeDatabase, getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { auditBars } from "./bar-audit";
import {
  barIngestionLedgerReady,
  ingestionHealth,
  latestIngestion,
  recordBarIngestion,
} from "./bar-ingestion-ledger";

/**
 * Durability is the point of this ledger (owner acceptance contract, 2026-08-16): until the
 * fetch record survives a restart, Brain cannot distinguish "never attempted" from "successfully
 * backfilled", "partial", "identity unverified" and "provider failed" — which weakens both the
 * planner and any future self-learning. `closeDatabase()` is a real restart for this process:
 * the cached handle is dropped and the next `getDb()` reopens the file from disk.
 */

const NOW = new Date("2026-08-16T03:00:00Z");

function sessionOpen(date: string): number {
  return Math.floor(new Date(`${date}T09:15:00+05:30`).getTime() / 1000);
}

function fullSession(date: string, bars = 75): { time: number }[] {
  const open = sessionOpen(date);
  return Array.from({ length: bars }, (_, index) => ({ time: open + index * 300 }));
}

function record(instrumentId: string, bars: { time: number }[], identityVerdict: "MATCHED" | "UNSTATED") {
  return recordBarIngestion(
    {
      instrumentId,
      resolution: "5",
      source: "yahoo",
      identityVerdict,
      audit: auditBars(bars, {
        market: "IN",
        requestedStart: sessionOpen("2026-06-01"),
        requestedEnd: sessionOpen("2026-06-05") + 86_400,
        resolutionMinutes: 5,
      }),
      inserted: bars.length,
      skipped: 0,
      rejected: 0,
    },
    NOW,
  );
}

describe("the bar-ingestion ledger", () => {
  useTemporaryDatabase();

  it("is registered by the migration chain — the table exists on a fresh database", () => {
    expect(barIngestionLedgerReady()).toBe(true);
  });

  it("keeps every fetch verdict across a restart — the whole reason it is durable", () => {
    const week = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].flatMap((date) =>
      fullSession(date),
    );
    expect(record("IN:XNSE:COMPLETE", week, "MATCHED")).toBe(true);
    expect(record("IN:XNSE:PARTIALONE", fullSession("2026-06-05"), "MATCHED")).toBe(true);
    expect(record("IN:XNSE:UNVERIFIED", week, "UNSTATED")).toBe(true);
    expect(record("IN:XNSE:NOTHING", [], "MATCHED")).toBe(true);

    // The restart.
    closeDatabase();

    const health = ingestionHealth(10);
    expect(health).not.toBeNull();
    expect(health!.recorded).toBe(4);
    // Each materially different condition is still distinguishable afterwards. Two complete
    // weeks were recorded — one identity-verified, one not — which is the point: completeness
    // and identity are INDEPENDENT dimensions and neither may absorb the other.
    expect(health!.byCompleteness).toMatchObject({ COMPLETE: 2, PARTIAL: 1, EMPTY: 1 });
    expect(health!.unstatedIdentity, "identity-unverified must not read as verified").toBe(1);
    expect(latestIngestion("IN:XNSE:UNVERIFIED", "5")).toMatchObject({
      completeness: "COMPLETE",
      identityVerdict: "UNSTATED",
    });
    expect(latestIngestion("IN:XNSE:COMPLETE", "5")?.identityVerdict).toBe("MATCHED");

    // A failed/partial fetch stays QUERYABLE, not merely counted.
    const partial = latestIngestion("IN:XNSE:PARTIALONE", "5");
    expect(partial?.completeness).toBe("PARTIAL");
    expect(partial?.observedSessions).toBe(1);
    expect(partial?.expectedSessions).toBe(5);
    expect(partial?.returnedBarCount).toBe(75);
    expect(partial?.source).toBe("yahoo");

    // "Never attempted" stays distinguishable from "attempted and returned nothing".
    expect(latestIngestion("IN:XNSE:NEVERTRIED", "5"), "never attempted").toBeNull();
    const nothing = latestIngestion("IN:XNSE:NOTHING", "5");
    expect(nothing?.completeness, "attempted, provider returned nothing").toBe("EMPTY");
    expect(nothing?.returnedBarCount).toBe(0);
  });

  it("preserves the request beside the response — the comparison silent truncation cannot survive", () => {
    record("IN:XNSE:TRUNC", fullSession("2026-06-05"), "MATCHED");
    closeDatabase();

    const row = latestIngestion("IN:XNSE:TRUNC", "5")!;
    expect(row.requestedStart).toBe(sessionOpen("2026-06-01"));
    expect(row.requestedEnd).toBe(sessionOpen("2026-06-05") + 86_400);
    expect(row.returnedFirstBar).toBe(sessionOpen("2026-06-05"));
    // Asked for a week, got one session: visible forever from the stored row alone.
    expect(row.observedSessions).toBeLessThan(row.expectedSessions!);
  });

  it("is append-only: an ingestion record is what happened", () => {
    record("IN:XNSE:IMMUTABLE", fullSession("2026-06-01"), "MATCHED");
    const db = getDb();
    expect(() =>
      db.update(schema.barIngestions).set({ completeness: "COMPLETE" }).run(),
    ).toThrow(/immutable/);
    expect(() => db.delete(schema.barIngestions).run()).toThrow(/append-only/);
  });
});
