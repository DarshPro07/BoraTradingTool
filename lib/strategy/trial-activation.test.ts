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
    // And it names the work that opens it, rather than only refusing.
    expect(sectorCriteria[0].detail).toMatch(/industry classification is the work that opens it/);
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
    // The literal hash of the criteria as PRE-REGISTERED on 2026-08-16, before any family was
    // tested. If this assertion fails, the activation bar was moved: that is allowed, but it must
    // be a deliberate, visible act with this line changed by hand — never a quiet loosening after
    // seeing which families looked promising.
    expect(activationCriteriaHash(NSE_QC_001_ACTIVATION)).toBe("0f86755bbbebcaec");
    expect(activationCriteriaHash({ ...NSE_QC_001_ACTIVATION, minReadyPerIntradayFamily: 10 })).not.toBe(
      activationCriteriaHash(NSE_QC_001_ACTIVATION),
    );
    // Every threshold carries its reason.
    expect(NSE_QC_001_ACTIVATION.basis.length).toBeGreaterThan(200);
    expect(NSE_QC_001_ACTIVATION.minLiquidityBuckets).toBe(3);
    expect(NSE_QC_001_ACTIVATION.minSectors).toBe(5);
  });
});
