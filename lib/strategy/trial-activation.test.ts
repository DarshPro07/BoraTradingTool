import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { universeCoverage } from "@/lib/market/universe-coverage";
import type { Standing } from "@/lib/strategy/promotion";
import { NSE_QC_001 } from "./campaigns/nse-qc-001";
import {
  activationCriteriaHash,
  evaluateTrialActivation,
  liquidityBucketOf,
  NSE_QC_001_ACTIVATION,
} from "./trial-activation";

/**
 * The gate is PRE-REGISTERED: it is declared while every intraday family sits at single-digit
 * readiness and nothing has been tested. These tests pin the criteria as they were fixed, so a
 * later loosening is a visible, arguable edit rather than a silent one.
 */

const NOW = new Date("2026-08-16T00:00:00Z");
const SECTOR_MIGRATION = path.join(process.cwd(), "drizzle/0024_sector_classifications.sql");

function standing(specId: string, blockedOn: Standing["blockedOn"]): Standing {
  return { specId, name: specId, stage: "rehearsed", advance: { kind: "hold", reason: "t" } as never, blockedOn };
}

function seedListing(symbol: string): void {
  const db = getDb();
  db.insert(schema.securityMasterSyncs)
    .values({ id: "sync-ta", observedAt: NOW, startedAt: NOW, status: "SUCCEEDED", sourceManifest: "{}", actor: "test" })
    .onConflictDoNothing()
    .run();
  db.insert(schema.nseSecurities).values({ isin: `INE_${symbol}`, firstObservedAt: NOW, lastObservedAt: NOW }).onConflictDoNothing().run();
  db.insert(schema.nseListingVersions)
    .values({ isin: `INE_${symbol}`, symbol, name: symbol, series: "EQ", assetType: "EQUITY", listingStatus: "LISTED", effectiveFrom: NOW, sourceSyncId: "sync-ta" })
    .run();
}

describe("the pre-registered trial-activation gate", () => {
  useTemporaryDatabase();

  it("is OFF today, with every unsatisfied criterion named", () => {
    seedListing("ONLYONE");
    const decision = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION, {
      report: universeCoverage(),
      standings: () => [],
      env: {},
    });

    expect(decision.switchOn).toBe(false);
    expect(decision.criteriaSatisfied).toBe(false);
    expect(decision.headline).toMatch(/OFF — the pre-registered criteria are not satisfied/);
    // Every family reports its own shortfall; nothing is aggregated into one opaque percentage.
    expect(decision.families).toHaveLength(5);
    expect(decision.blockers.length).toBeGreaterThan(5);
    expect(decision.blockers.some((blocker) => /READY_FOR_GAUNTLET|pool/.test(blocker))).toBe(true);
    // Blockers the machine CAN close are distinguished from those it cannot.
    expect(decision.blockers.some((blocker) => blocker.includes("[EXTERNAL_DATA_DEPENDENCY]"))).toBe(true);
    expect(decision.externalDependencies).toBeGreaterThan(0);
    const breadth = decision.families[0].criteria.find((c) => c.criterion === "family-ready breadth")!;
    expect(breadth.resolution, "breadth is genuinely the machine's own work").toBe("AUTONOMOUS_WORK");
  });

  it("reports sector representation as UNMEASURABLE and stays shut — never passes what it cannot evaluate", () => {
    seedListing("ANY");
    const decision = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION, {
      report: universeCoverage(),
      standings: () => [],
      env: {},
    });
    const sectorCriteria = decision.families.flatMap((family) =>
      family.criteria.filter((criterion) => criterion.criterion === "sector representation"),
    );
    expect(sectorCriteria).toHaveLength(5);
    expect(sectorCriteria.every((criterion) => criterion.state === "UNMEASURABLE")).toBe(true);
    expect(sectorCriteria[0].detail).toMatch(/no sector classification is ingested/);
    // And it names the SPECIFIC remaining act, rather than only refusing: the ingestion exists
    // and is tested; what is missing is the migration promotion.
    expect(sectorCriteria[0].detail).toMatch(/scripts\/ingest-nse-sectors\.mts/);
    expect(decision.criteriaSatisfied, "an unmeasurable criterion is not a satisfied one").toBe(false);
  });

  it("distinguishes the owner's switch from the criteria — neither implies the other", () => {
    seedListing("ANY");
    const report = universeCoverage();
    const on = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION, {
      report,
      standings: () => [],
      env: { MARKETPULSE_AUTONOMOUS_TRIALS: "1" },
    });
    expect(on.switchOn).toBe(true);
    expect(on.criteriaSatisfied).toBe(false);
    expect(on.headline).toMatch(/ON BY SWITCH while the pre-registered criteria are NOT satisfied/);
  });

  it("refuses to read sector diversity off a mostly-unclassified ready set", () => {
    // The owner's example, driven through the real evaluation: 60 ready, 18 classified, 7 distinct
    // sectors. 7 >= 5, but 7 sectors over 18 of 60 describes the classified minority — so the
    // criterion must read UNMEASURABLE, never SATISFIED. Coverage is a prerequisite BENEATH
    // diversity, not a substitute for it.
    const securities = Array.from({ length: 60 }, (_, index) => ({
      isin: `INE_R${index}`,
      symbol: `R${index}`,
      instrumentId: `IN:XNSE:R${index}`,
      tier: "MAIN_BOARD" as const,
      dailyBars: 400,
      fiveMinuteSessions: 60,
      completeFiveMinuteSessions: 60,
      openingWindowSessions: 60,
      researchReady: true,
      backtestReady: true,
      validationReady: true,
      intradayReady: true,
      missingReason: null,
    }));
    const report = {
      generatedBasis: "synthetic",
      tiers: { MAIN_BOARD: 60, SME: 0, SURVEILLANCE_RESTRICTED: 0, ETF: 0, REIT_INVIT: 0, INACTIVE: 0, OTHER: 0 },
      mainBoard: {
        total: 60,
        researchReady: 60,
        backtestReady: 60,
        validationReady: 60,
        intradayReady: 60,
        researchCoveragePct: 100,
        validationCoveragePct: 100,
        missingReasons: { NO_HISTORY: 0, INSUFFICIENT_BARS: 0, INGEST_IN_FLIGHT: 0, INGEST_COOLING: 0, INGEST_BLOCKED_PERMANENT: 0 },
      },
      sme: { total: 0, researchReady: 0 },
      thresholds: { research: 60, backtest: 250, validation: 340, intradaySessions: 20 },
      securities,
    };

    // 18 of 60 classified, spread across 7 distinct sectors.
    const db = getDb();
    (db as unknown as { $client: { exec: (sql: string) => void } }).$client.exec(
      fs.readFileSync(SECTOR_MIGRATION, "utf8"),
    );
    for (let index = 0; index < 18; index += 1) {
      db.insert(schema.sectorClassifications)
        .values({
          isin: `INE_R${index}`,
          instrumentId: `IN:XNSE:R${index}`,
          symbol: `R${index}`,
          rawLabel: `Sector ${index % 7}`,
          rawField: "Industry",
          sectorCode: `IN00${index % 7}`,
          normalizedSector: `Sector ${index % 7}`,
          normalizationBasis: "PROVEN_AGAINST_NSE_STRUCTURE",
          source: "test",
          sourceEffectiveDate: "2026-08-16",
          fetchedAt: NOW,
          identityVerification: "ISIN_AND_SYMBOL_MATCHED",
          effectiveFrom: NOW,
          effectiveTo: null,
        })
        .run();
    }

    const decision = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION, {
      report,
      standings: () => [],
      env: {},
    });
    const orb = decision.families.find((family) => family.familyId === "fam_qc001_orb")!;
    expect(orb.ready, "breadth itself is satisfied — this test is only about the sector claim").toBe(60);
    expect(orb.classifiedReady).toBe(18);
    expect(orb.sectors, "seven distinct sectors ARE present among the classified").toBe(7);

    const sectorCriterion = orb.criteria.find((criterion) => criterion.criterion === "sector representation")!;
    expect(sectorCriterion.state, "7 >= 5 must NOT pass while 42 of 60 are unclassified").toBe("UNMEASURABLE");
    expect(sectorCriterion.detail).toMatch(/only 18 of 60 ready instrument\(s\) are classified \(30%, 80% required\)/);
    expect(sectorCriterion.detail).toMatch(/describes the classified minority/);
    // WHO can close it: not the machine. "45% < 80%" reads as "keep waiting", which is exactly
    // wrong — the authorized source covers a bounded universe, so ingesting more dilutes it.
    expect(sectorCriterion.resolution).toBe("EXTERNAL_DATA_DEPENDENCY");
    expect(sectorCriterion.detail).toMatch(/DILUTES as breadth grows/);
    expect(orb.satisfied).toBe(false);
  });

  it("buckets liquidity at fixed rupee floors, so the criterion can actually fail", () => {
    expect(liquidityBucketOf(500_000_000)).toBe("HIGH");
    expect(liquidityBucketOf(50_000_000)).toBe("MEDIUM");
    expect(liquidityBucketOf(1_000_000)).toBe("LOW");
    expect(liquidityBucketOf(null), "unmeasurable turnover is not a bucket").toBeNull();
  });

  it("counts the READY_FOR_GAUNTLET pool from standings whose next act spends a trial", () => {
    seedListing("ANY");
    const decision = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION, {
      report: universeCoverage(),
      standings: () => [
        standing("s1", "gauntlet"),
        standing("s2", "gauntlet"),
        standing("s3", "rehearsal"),
        standing("s4", "owner"),
      ],
      env: {},
    });
    expect(decision.readyForGauntlet).toBe(2);
    expect(decision.poolCriterion.state).toBe("NOT_SATISFIED");
    expect(decision.poolCriterion.detail).toMatch(/2 strategy\(ies\).*10 required/);
  });

  it("pins the criteria as pre-registered — a later loosening changes the hash", () => {
    // The literal hash of the criteria as pre-registered on 2026-08-16 and AMENDED the same day
    // (10:56 IST, owner-authorized, before any trial was spent, strictly tightening) to include
    // the sector-classification coverage prerequisite. Thresholds AND the liquidity-bucket
    // definitions that give "3 of 3 buckets" its meaning are inside the hash.
    // Lineage: 0f86755bbbebcaec → 5254d36998262f10 (bucket version+floors) → 19e571a36128b1ef. If this assertion fails, the activation bar was moved: that is allowed, but it
    // must be a deliberate, visible act with this line changed by hand — never a quiet loosening
    // after seeing which families looked promising.
    expect(activationCriteriaHash(NSE_QC_001_ACTIVATION)).toBe("19e571a36128b1ef");
    expect(activationCriteriaHash({ ...NSE_QC_001_ACTIVATION, minReadyPerIntradayFamily: 10 })).not.toBe(
      activationCriteriaHash(NSE_QC_001_ACTIVATION),
    );
    // Every threshold carries its reason.
    expect(NSE_QC_001_ACTIVATION.basis.length).toBeGreaterThan(200);
    expect(NSE_QC_001_ACTIVATION.minLiquidityBuckets).toBe(3);
    expect(NSE_QC_001_ACTIVATION.minSectors).toBe(5);
    expect(NSE_QC_001_ACTIVATION.minSectorClassificationCoverage).toBe(0.8);
  });
});
