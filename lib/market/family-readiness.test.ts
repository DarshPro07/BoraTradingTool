import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { NSE_QC_001 } from "@/lib/strategy/campaigns/nse-qc-001";
import { familyDeclarationHash } from "@/lib/strategy/campaign-registry";
import { familyReadiness, meetsRequirement } from "./family-readiness";
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

describe("family-specific data readiness", () => {
  useTemporaryDatabase();

  it("counts each family against ITS OWN requirement, not one universal threshold", () => {
    // An instrument with deep daily history but no intraday: swing-ready, intraday-blocked.
    seedListing("DEEPDAILY");
    seedBars("DEEPDAILY", "D", 400, 86_400);
    // An instrument with shallow daily history but plenty of 5m sessions: intraday-ready only.
    seedListing("INTRADAY");
    seedBars("INTRADAY", "D", 80, 86_400);
    seedBars("INTRADAY", "5", 45, 86_400); // 45 distinct session days
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

  it("meetsRequirement is the single rule both the count and any planner consult", () => {
    const security = {
      isin: "X",
      symbol: "X",
      instrumentId: "IN:XNSE:X",
      tier: "MAIN_BOARD" as const,
      dailyBars: 100,
      fiveMinuteSessions: 39,
      researchReady: true,
      backtestReady: false,
      validationReady: false,
      intradayReady: true,
      missingReason: null,
    };
    const orb = NSE_QC_001.families[0].dataRequirement;
    expect(meetsRequirement(security, orb), "39 sessions is one short of the declared 40").toBe(false);
    expect(meetsRequirement({ ...security, fiveMinuteSessions: 40 }, orb)).toBe(true);
  });
});
