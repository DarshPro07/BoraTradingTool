import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { NSE_QC_001 } from "@/lib/strategy/campaigns/nse-qc-001";
import { familyDeclarationHash } from "@/lib/strategy/campaign-registry";
import { familyReadiness, intradayBackfillQueue, meetsRequirement } from "./family-readiness";
import { universeCoverage } from "./universe-coverage";

const NOW = new Date("2026-08-16T00:00:00Z");

function seedListing(symbol: string, series = "EQ"): void {
  const db = getDb();
  db.insert(schema.securityMasterSyncs)
    .values({ id: "sync-fr", observedAt: NOW, startedAt: NOW, status: "SUCCEEDED", sourceManifest: "{}", actor: "test" })
    .onConflictDoNothing()
    .run();
  db.insert(schema.nseSecurities).values({ isin: `INE_${symbol}`, firstObservedAt: NOW, lastObservedAt: NOW }).onConflictDoNothing().run();
  db.insert(schema.nseListingVersions)
    .values({ isin: `INE_${symbol}`, symbol, name: symbol, series, assetType: "EQUITY", listingStatus: "LISTED", effectiveFrom: NOW, sourceSyncId: "sync-fr" })
    .run();
}

function seedBars(symbol: string, resolution: "D" | "5", count: number, stepSeconds: number): void {
  const db = getDb();
  const rows = Array.from({ length: count }, (_, index) => ({
    ticker: `IN:XNSE:${symbol}`,
    resolution,
    time: 1_700_000_000 + index * stepSeconds,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));
  for (let start = 0; start < rows.length; start += 500) {
    db.insert(schema.priceCandles).values(rows.slice(start, start + 500)).run();
  }
}

/** 09:15 IST on a date, epoch seconds — where a real NSE session starts. */
function sessionOpen(date: string): number {
  return Math.floor(new Date(`${date}T09:15:00+05:30`).getTime() / 1000);
}

/**
 * `sessions` COMPLETE trading days of 5-minute bars. `openingBars` controls how much of the
 * opening window is populated, which is what separates SESSION COMPLETE from QUALITY PASS for
 * the families that trade the open.
 */
function seedSessions(symbol: string, sessions: number, options: { openingBars?: number; barsPerSession?: number } = {}): void {
  const db = getDb();
  const barsPerSession = options.barsPerSession ?? 75;
  const openingBars = options.openingBars ?? 6;
  const rows: { ticker: string; resolution: string; time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (let day = 0; day < sessions; day += 1) {
    // Weekday-safe: a fixed Monday plus whole weeks keeps every seeded day a trading day.
    const date = new Date(Date.UTC(2026, 5, 1) + day * 86_400_000).toISOString().slice(0, 10);
    const open = sessionOpen(date);
    for (let bar = 0; bar < barsPerSession; bar += 1) {
      // Opening bars are the first `openingBars` slots; the rest are pushed past the window.
      const slot = bar < openingBars ? bar : bar + (6 - openingBars);
      rows.push({ ticker: `IN:XNSE:${symbol}`, resolution: "5", time: open + slot * 300, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    }
  }
  for (let start = 0; start < rows.length; start += 500) {
    db.insert(schema.priceCandles).values(rows.slice(start, start + 500)).run();
  }
}

describe("family-specific data readiness", () => {
  useTemporaryDatabase();

  it("counts each family against ITS OWN requirement, not one universal threshold", () => {
    // An instrument with deep daily history but no intraday: swing-ready, intraday-blocked.
    seedListing("DEEPDAILY");
    seedBars("DEEPDAILY", "D", 400, 86_400);
    // An instrument with shallow daily history but plenty of 5m sessions: intraday-ready only.
    seedListing("INTRADAY");
    seedBars("INTRADAY", "D", 80, 86_400);
    seedSessions("INTRADAY", 45); // 45 COMPLETE sessions, opening window populated
    // An instrument with nothing.
    seedListing("BARE");

    const rows = familyReadiness(NSE_QC_001.families, universeCoverage());
    const byId = new Map(rows.map((row) => [row.familyId, row]));

    const orb = byId.get("fam_qc001_orb")!;
    expect(orb.requirement.resolution).toBe("INTRADAY_5M");
    expect(orb.ready, "only the instrument with 40+ 5m sessions is ORB-ready").toBe(1);
    expect(orb.readyInstruments).toEqual(["IN:XNSE:INTRADAY"]);
    // DEEPDAILY has the daily history but not the sessions — the actionable gap, named.
    expect(orb.blockedOnIntraday).toBe(1);
    expect(orb.blockedOnDaily).toBe(1);

    const momentum = byId.get("fam_qc001_xsec_momentum")!;
    expect(momentum.requirement.resolution).toBe("DAILY");
    expect(momentum.ready, "only the 400-bar instrument clears the 340-bar swing floor").toBe(1);
    expect(momentum.readyInstruments).toEqual(["IN:XNSE:DEEPDAILY"]);
    expect(momentum.blockedOnIntraday, "a daily family is never blocked on intraday").toBe(0);

    // The families genuinely differ — which is the entire point of the metric. (Their COUNTS
    // coincide here at 1 each; the pools themselves are disjoint, and that is the claim.)
    expect(orb.readyInstruments).not.toEqual(momentum.readyInstruments);
    expect(orb.readyInstruments.some((id) => momentum.readyInstruments.includes(id))).toBe(false);
  });

  it("every declared family states a requirement WITH its basis — no magic numbers", () => {
    for (const family of NSE_QC_001.families) {
      expect(family.dataRequirement.minDailyBars).toBeGreaterThan(0);
      expect(family.dataRequirement.basis.length, `${family.familyId} has no stated basis`).toBeGreaterThan(60);
      if (family.dataRequirement.resolution === "INTRADAY_5M") {
        expect(family.dataRequirement.minIntradaySessions).toBeGreaterThan(0);
      } else {
        expect(family.dataRequirement.minIntradaySessions).toBeNull();
      }
    }
  });

  it("adding a data requirement does NOT change any family's declaration hash — the pins hold", () => {
    // The registered production hashes, recorded when NSE-QC-001 was registered (commit a945eb6).
    const registered: Record<string, string> = {
      fam_qc001_orb: "ba404a611af9a8db",
      fam_qc001_rvol_breakout: "132faf439721319c",
      fam_qc001_intraday_mr: "383cfb656604aa98",
      fam_qc001_xsec_momentum: "1cc28e1f042282fe",
      fam_qc001_swing_mr: "6edf49f20e93de40",
    };
    for (const family of NSE_QC_001.families) {
      expect(
        familyDeclarationHash("camp_nse_qc_001", family),
        `${family.familyId}'s hash changed — a pinned family must not be redefined by a data-requirement edit`,
      ).toBe(registered[family.familyId]);
    }
  });

  it("queues the daily-ready-but-missing-5m instruments, closest to the bar first", () => {
    // Daily-ready, needs 5 more sessions → the cheapest conversion, queued first.
    seedListing("ALMOST");
    seedBars("ALMOST", "D", 100, 86_400);
    seedSessions("ALMOST", 35);
    // Daily-ready, no intraday at all → queued, but behind.
    seedListing("ZERO5M");
    seedBars("ZERO5M", "D", 100, 86_400);
    // Already family-ready → not queued; nothing to gain.
    seedListing("DONE");
    seedBars("DONE", "D", 100, 86_400);
    seedSessions("DONE", 45);
    // Not daily-ready → not queued; its blocker is the daily lane, not this one.
    seedListing("NODAILY");
    seedSessions("NODAILY", 10);
    // Separate universe → never queued into the campaign's work.
    seedListing("SMEONE", "SM");
    seedBars("SMEONE", "D", 100, 86_400);

    const queue = intradayBackfillQueue(NSE_QC_001.families, universeCoverage(), 12);
    expect(queue.map((entry) => entry.instrumentId)).toEqual(["IN:XNSE:ALMOST", "IN:XNSE:ZERO5M"]);
    expect(queue[0]).toMatchObject({ fiveMinuteSessions: 35, needed: 5 });
    expect(queue[1]).toMatchObject({ fiveMinuteSessions: 0, needed: 40 });

    // The rate discipline is a LIMIT, honoured exactly.
    expect(intradayBackfillQueue(NSE_QC_001.families, universeCoverage(), 1)).toHaveLength(1);
  });

  it("prefers an UNDER-REPRESENTED stratum over proximity — the HIGH-bucket bias fix", () => {
    // CLOSE is nearly ready but sits in the already-crowded HIGH bucket; FAR has no sessions at
    // all but is the only candidate from an empty bucket. Proximity alone would pick CLOSE and
    // deepen exactly the bias the first gate evaluation found.
    seedListing("CLOSEHIGH");
    seedBars("CLOSEHIGH", "D", 100, 86_400);
    seedSessions("CLOSEHIGH", 30);
    seedListing("FARLOW");
    seedBars("FARLOW", "D", 100, 86_400);

    const report = universeCoverage();
    const proximityOnly = intradayBackfillQueue(NSE_QC_001.families, report, 2);
    expect(proximityOnly[0].instrumentId, "without strata, proximity wins").toBe("IN:XNSE:CLOSEHIGH");

    const withStrata = intradayBackfillQueue(NSE_QC_001.families, report, 2, {
      liquidityByInstrument: new Map([
        ["IN:XNSE:CLOSEHIGH", "HIGH"],
        ["IN:XNSE:FARLOW", "LOW"],
      ]),
      // HIGH already has six ready instruments; LOW has none — the live situation exactly.
      readyLiquidityCounts: new Map([["HIGH", 6]]),
    });
    expect(withStrata[0].instrumentId, "the empty bucket is served first").toBe("IN:XNSE:FARLOW");
    expect(withStrata[0].stratum).toContain("LOW");
    expect(withStrata[1].instrumentId).toBe("IN:XNSE:CLOSEHIGH");
    // Determinism: the same inputs give the same order, every time.
    expect(intradayBackfillQueue(NSE_QC_001.families, report, 2, {
      liquidityByInstrument: new Map([
        ["IN:XNSE:CLOSEHIGH", "HIGH"],
        ["IN:XNSE:FARLOW", "LOW"],
      ]),
      readyLiquidityCounts: new Map([["HIGH", 6]]),
    })).toEqual(withStrata);
  });

  it("meetsRequirement is the single rule both the count and any planner consult", () => {
    const security = {
      isin: "X",
      symbol: "X",
      instrumentId: "IN:XNSE:X",
      tier: "MAIN_BOARD" as const,
      dailyBars: 100,
      fiveMinuteSessions: 39,
      completeFiveMinuteSessions: 39,
      openingWindowSessions: 39,
      researchReady: true,
      historyReady: true,
      freshnessReady: true,
      lastDailyBar: 1_780_000_000,
      backtestReady: false,
      validationReady: false,
      intradayReady: true,
      missingReason: null,
    };
    const orb = NSE_QC_001.families[0].dataRequirement;
    expect(meetsRequirement(security, orb), "39 sessions is one short of the declared 40").toBe(false);
    expect(
      meetsRequirement({ ...security, completeFiveMinuteSessions: 40, openingWindowSessions: 40 }, orb),
    ).toBe(true);
    // THE quality distinction: 40 COMPLETE sessions whose opening windows are missing do not
    // make an opening-range family ready, however many bars the rest of each day holds.
    expect(
      meetsRequirement({ ...security, completeFiveMinuteSessions: 40, openingWindowSessions: 12 }, orb),
      "an opening-range family needs the opening window, not just complete days",
    ).toBe(false);
    // The midday family is satisfied by the same data, because it does not trade the open.
    const middayFamily = NSE_QC_001.families.find((family) => family.familyId === "fam_qc001_intraday_mr")!;
    expect(
      meetsRequirement({ ...security, completeFiveMinuteSessions: 40, openingWindowSessions: 12 }, middayFamily!.dataRequirement),
    ).toBe(true);
  });
});
