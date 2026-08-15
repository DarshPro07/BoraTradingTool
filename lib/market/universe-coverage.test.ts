import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { enqueue } from "@/lib/research/queue";
import {
  BACKTEST_BARS_FLOOR,
  INTRADAY_SESSIONS_FLOOR,
  planUniverseIngestion,
  tierFor,
  universeCoverage,
  VALIDATION_BARS_FLOOR,
} from "./universe-coverage";

const NOW = new Date("2026-08-16T00:00:00Z");

function seedListing(symbol: string, series = "EQ", assetType = "EQUITY", listingStatus = "LISTED"): void {
  const db = getDb();
  // The listing's FK parents: the security row and the sync that observed it.
  db.insert(schema.securityMasterSyncs)
    .values({ id: "sync-test", observedAt: NOW, startedAt: NOW, status: "SUCCEEDED", sourceManifest: "{}", actor: "test" })
    .onConflictDoNothing()
    .run();
  db.insert(schema.nseSecurities)
    .values({ isin: `INE_${symbol}`, firstObservedAt: NOW, lastObservedAt: NOW })
    .onConflictDoNothing()
    .run();
  db.insert(schema.nseListingVersions)
    .values({
      isin: `INE_${symbol}`,
      symbol,
      name: symbol,
      series,
      assetType,
      listingStatus,
      effectiveFrom: NOW,
      sourceSyncId: "sync-test",
    })
    .run();
}

function seedDailyBars(symbol: string, count: number): void {
  const db = getDb();
  const rows = Array.from({ length: count }, (_, index) => ({
    ticker: `IN:XNSE:${symbol}`,
    resolution: "D",
    time: 1_700_000_000 + index * 86_400,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10_000,
  }));
  for (let start = 0; start < rows.length; start += 500) {
    db.insert(schema.priceCandles).values(rows.slice(start, start + 500)).run();
  }
}

describe("the universe readiness index", () => {
  useTemporaryDatabase();

  it("classifies the exchange's own series taxonomy into tiers — SME and restricted series never merge into the research universe", () => {
    expect(tierFor({ series: "EQ", assetType: "EQUITY", listingStatus: "LISTED" })).toBe("MAIN_BOARD");
    expect(tierFor({ series: "SM", assetType: "EQUITY", listingStatus: "LISTED" })).toBe("SME");
    expect(tierFor({ series: "ST", assetType: "EQUITY", listingStatus: "LISTED" })).toBe("SME");
    expect(tierFor({ series: "BE", assetType: "EQUITY", listingStatus: "LISTED" })).toBe("SURVEILLANCE_RESTRICTED");
    expect(tierFor({ series: "BZ", assetType: "EQUITY", listingStatus: "LISTED" })).toBe("SURVEILLANCE_RESTRICTED");
    expect(tierFor({ series: "EQ", assetType: "ETF", listingStatus: "LISTED" })).toBe("ETF");
    expect(tierFor({ series: "RR", assetType: "REIT", listingStatus: "LISTED" })).toBe("REIT_INVIT");
    expect(tierFor({ series: "IV", assetType: "INVIT", listingStatus: "LISTED" })).toBe("REIT_INVIT");
    expect(tierFor({ series: "EQ", assetType: "EQUITY", listingStatus: "INACTIVE" })).toBe("INACTIVE");
    expect(tierFor({ series: "XX", assetType: "EQUITY", listingStatus: "LISTED" })).toBe("OTHER");
  });

  it("derives readiness classes from the stated floors and attributes missing reasons", () => {
    seedListing("READY");
    seedDailyBars("READY", VALIDATION_BARS_FLOOR);
    seedListing("PARTIAL");
    seedDailyBars("PARTIAL", 30);
    seedListing("EMPTY");
    seedListing("SMESTOCK", "SM");

    // 5m coverage for READY: COMPLETE sessions (75 bars from 09:15 IST), not one bar per day.
    const db = getDb();
    const sessionRows: { ticker: string; resolution: string; time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
    for (let day = 0; day < INTRADAY_SESSIONS_FLOOR; day += 1) {
      const date = new Date(Date.UTC(2026, 5, 1) + day * 86_400_000).toISOString().slice(0, 10);
      const open = Math.floor(new Date(`${date}T09:15:00+05:30`).getTime() / 1000);
      for (let bar = 0; bar < 75; bar += 1) {
        sessionRows.push({ ticker: "IN:XNSE:READY", resolution: "5", time: open + bar * 300, open: 1, high: 1, low: 1, close: 1, volume: 1 });
      }
    }
    for (let start = 0; start < sessionRows.length; start += 500) {
      db.insert(schema.priceCandles).values(sessionRows.slice(start, start + 500)).run();
    }
    // PARTIAL gets the same number of DAYS but one bar each — data present, no complete session.
    db.insert(schema.priceCandles)
      .values(
        Array.from({ length: INTRADAY_SESSIONS_FLOOR }, (_, index) => ({
          ticker: "IN:XNSE:PARTIAL",
          resolution: "5",
          time: Math.floor(new Date(`2026-06-01T09:15:00+05:30`).getTime() / 1000) + index * 86_400,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
        })),
      )
      .run();

    const report = universeCoverage();
    expect(report.tiers.MAIN_BOARD).toBe(3);
    expect(report.sme.total).toBe(1);

    const bySymbol = new Map(report.securities.map((security) => [security.symbol, security]));
    const ready = bySymbol.get("READY")!;
    expect(ready).toMatchObject({
      researchReady: true,
      backtestReady: true,
      validationReady: true,
      intradayReady: true,
      missingReason: null,
    });
    expect(bySymbol.get("PARTIAL")).toMatchObject({
      researchReady: false,
      missingReason: "INSUFFICIENT_BARS",
      dailyBars: 30,
    });
    // THE quality distinction (owner, 2026-08-16): twenty days holding ONE bar each are twenty
    // days of DATA PRESENT and zero COMPLETE sessions — they must never read as intraday-ready.
    expect(bySymbol.get("PARTIAL")).toMatchObject({
      fiveMinuteSessions: INTRADAY_SESSIONS_FLOOR,
      completeFiveMinuteSessions: 0,
      openingWindowSessions: 0,
      intradayReady: false,
    });
    expect(ready.completeFiveMinuteSessions).toBe(INTRADAY_SESSIONS_FLOOR);
    expect(ready.openingWindowSessions).toBe(INTRADAY_SESSIONS_FLOOR);
    expect(bySymbol.get("EMPTY")).toMatchObject({ missingReason: "NO_HISTORY", dailyBars: 0 });
    expect(report.mainBoard.missingReasons.NO_HISTORY).toBe(1);
    expect(report.mainBoard.missingReasons.INSUFFICIENT_BARS).toBe(1);
    expect(report.mainBoard.researchReady).toBe(1);
    expect(report.mainBoard.researchCoveragePct).toBeCloseTo(33.3, 1);
    expect(report.thresholds).toEqual({
      research: 60,
      backtest: BACKTEST_BARS_FLOOR,
      validation: VALIDATION_BARS_FLOOR,
      intradaySessions: INTRADAY_SESSIONS_FLOOR,
    });
  });

  it("reads ingest pipeline state from the durable queue by dedupe key", () => {
    seedListing("QUEUED");
    seedListing("DEADPERM");
    enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:QUEUED" }, dedupeKey: "ingest-history-IN:XNSE:QUEUED" });
    const dead = enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:DEADPERM" }, dedupeKey: "ingest-history-IN:XNSE:DEADPERM" });
    getDb()
      .update(schema.researchJobs)
      .set({ status: "dead", lastError: "INSTRUMENT_UNKNOWN: not in the master", updatedAt: NOW })
      .where(eq(schema.researchJobs.id, dead.id))
      .run();

    const report = universeCoverage();
    const bySymbol = new Map(report.securities.map((security) => [security.symbol, security]));
    expect(bySymbol.get("QUEUED")?.missingReason).toBe("INGEST_IN_FLIGHT");
    expect(bySymbol.get("DEADPERM")?.missingReason).toBe("INGEST_BLOCKED_PERMANENT");
  });

  it("plans deterministically: referenced/partial first, then symbol order; in-flight, blocked, ready and non-main-board excluded; limit respected", () => {
    seedListing("AAA"); // untouched main board
    seedListing("BBB");
    seedListing("PART");
    seedDailyBars("PART", 10); // partially covered → tier 1
    seedListing("REF"); // referenced by a challenger → tier 1
    seedListing("DONE");
    seedDailyBars("DONE", 100); // research-ready → excluded
    seedListing("FLIGHT");
    enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:FLIGHT" }, dedupeKey: "ingest-history-IN:XNSE:FLIGHT" });
    seedListing("SMEONE", "SM"); // separate universe → excluded

    const db = getDb();
    db.insert(schema.researchCampaigns)
      .values({ id: "rc_p", name: "p", question: "q", createdAt: NOW, createdBy: "t" })
      .run();
    db.insert(schema.strategyFamilies)
      .values({ id: "sf_p", researchCampaignId: "rc_p", name: "f", economicHypothesis: "h", mechanism: "m", declarationHash: "d", createdAt: NOW, createdBy: "t" })
      .run();
    db.insert(schema.strategySpecs)
      .values({ id: "spec_p", name: "s", dsl: "{}", dslHash: "h", createdBy: "t", createdAt: NOW })
      .run();
    db.insert(schema.forwardChallengers)
      .values({ id: "ch_p", strategySpecId: "spec_p", strategyFamilyId: "sf_p", researchCampaignId: "rc_p", activatedAt: NOW, codeFingerprint: "c", engineVersion: "1", feeModelId: "f", market: "NSE", resolution: "5m", universe: "IN:XNSE:REF", dslHash: "h", forwardPolicy: "shadow", forwardPolicyVersion: "1", status: "ACTIVE", createdBy: "t" })
      .run();

    const plan = planUniverseIngestion(10);
    expect(plan.map((planned) => planned.instrumentId)).toEqual([
      "IN:XNSE:PART",
      "IN:XNSE:REF",
      "IN:XNSE:AAA",
      "IN:XNSE:BBB",
    ]);
    expect(plan[0].tier).toBe(1);
    expect(plan[1].tier).toBe(1);
    expect(plan[2].tier).toBe(2);

    const limited = planUniverseIngestion(2);
    expect(limited.map((planned) => planned.instrumentId)).toEqual(["IN:XNSE:PART", "IN:XNSE:REF"]);
  });
});
