import { describe, expect, it } from "vitest";
import { isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  currentSectorByInstrument,
  ingestNseSectors,
  parseCsv,
  sectorClassificationReady,
} from "./sector-classification";

const NOW = new Date("2026-08-16T04:00:00Z");
const LATER = new Date("2026-11-16T04:00:00Z");

function seedMaster(entries: { isin: string; symbol: string }[]): void {
  const db = getDb();
  db.insert(schema.securityMasterSyncs)
    .values({ id: "sync-sec", observedAt: NOW, startedAt: NOW, status: "SUCCEEDED", sourceManifest: "{}", actor: "test" })
    .onConflictDoNothing()
    .run();
  for (const entry of entries) {
    db.insert(schema.nseSecurities).values({ isin: entry.isin, firstObservedAt: NOW, lastObservedAt: NOW }).onConflictDoNothing().run();
    db.insert(schema.nseListingVersions)
      .values({
        isin: entry.isin,
        symbol: entry.symbol,
        name: entry.symbol,
        series: "EQ",
        assetType: "EQUITY",
        listingStatus: "LISTED",
        effectiveFrom: NOW,
        sourceSyncId: "sync-sec",
      })
      .run();
  }
}

const csv = (rows: string[]) => ["Company Name,Industry,Symbol,Series,ISIN Code", ...rows].join("\n");

describe("NSE sector classification", () => {
  useTemporaryDatabase();

  it("parses the real file shape, including quoted names containing commas", () => {
    const rows = parseCsv(csv(['"Apar Industries, Limited",Capital Goods,APARINDS,EQ,INE372A01015']));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      "Company Name": "Apar Industries, Limited",
      Industry: "Capital Goods",
      Symbol: "APARINDS",
      "ISIN Code": "INE372A01015",
    });
  });

  it("writes only ISIN-matched instruments, with provenance and identity verification", async () => {
    seedMaster([
      { isin: "INE001", symbol: "ALPHA" },
      { isin: "INE002", symbol: "BETARENAMED" },
    ]);
    const report = await ingestNseSectors({
      now: NOW,
      fetcher: async () =>
        csv([
          "Alpha Ltd,Financial Services,ALPHA,EQ,INE001",
          // Same ISIN, stale symbol in the index file: matched, but the mismatch is RECORDED.
          "Beta Ltd,Information Technology,BETAOLD,EQ,INE002",
          // Not in this deployment's master: never written.
          "Gamma Ltd,Healthcare,GAMMA,EQ,INE999",
        ]),
    });

    expect(report.ok).toBe(true);
    expect(report.matched).toBe(2);
    expect(report.unmatched, "an ISIN the master does not know is never written").toBe(1);
    expect(report.symbolMismatches).toBe(1);
    expect(report.inserted).toBe(2);

    const rows = getDb().select().from(schema.sectorClassifications).all();
    expect(rows).toHaveLength(2);
    const alpha = rows.find((row) => row.isin === "INE001")!;
    expect(alpha).toMatchObject({
      instrumentId: "IN:XNSE:ALPHA",
      // What the file said, kept apart from what it was verified to mean.
      rawLabel: "Financial Services",
      rawField: "Industry",
      normalizedSector: "Financial Services",
      sectorCode: "IN0501",
      normalizationBasis: "PROVEN_AGAINST_NSE_STRUCTURE",
      identityVerification: "ISIN_AND_SYMBOL_MATCHED",
      sourceEffectiveDate: "2026-08-16",
      effectiveTo: null,
    });
    expect(alpha.source).toMatch(/^NSE_INDEX_CONSTITUENTS:/);
    expect(alpha.sourceUrl).toMatch(/nseindia\.com/);
    // The symbol stored is the MASTER's, not the index file's stale one.
    const beta = rows.find((row) => row.isin === "INE002")!;
    expect(beta.symbol).toBe("BETARENAMED");
    expect(beta.identityVerification).toBe("ISIN_MATCHED_SYMBOL_DIFFERS");
    // Levels the source does not state stay NULL rather than being guessed.
    expect(alpha.industry).toBeNull();
    expect(alpha.basicIndustry).toBeNull();
    expect(alpha.macroSector).toBeNull();
  });

  it("is idempotent, and supersedes rather than overwrites when a classification changes", async () => {
    seedMaster([{ isin: "INE001", symbol: "ALPHA" }]);
    const fetchFinancial = async () => csv(["Alpha Ltd,Financial Services,ALPHA,EQ,INE001"]);
    await ingestNseSectors({ now: NOW, fetcher: fetchFinancial });

    const second = await ingestNseSectors({ now: LATER, fetcher: fetchFinancial });
    expect(second.unchanged, "an unchanged classification must not churn its window").toBe(1);
    expect(second.inserted).toBe(0);
    expect(getDb().select().from(schema.sectorClassifications).all()).toHaveLength(1);

    // NSE reclassifies after mergers/demergers — the old fact keeps its window.
    const third = await ingestNseSectors({
      now: LATER,
      fetcher: async () => csv(["Alpha Ltd,Capital Goods,ALPHA,EQ,INE001"]),
    });
    expect(third.superseded).toBe(1);
    expect(third.inserted).toBe(1);
    const all = getDb().select().from(schema.sectorClassifications).all();
    expect(all).toHaveLength(2);
    const closed = all.find((row) => row.effectiveTo !== null)!;
    expect(closed.rawLabel, "the earlier classification survives with its window closed").toBe("Financial Services");
    const open = getDb()
      .select()
      .from(schema.sectorClassifications)
      .where(isNull(schema.sectorClassifications.effectiveTo))
      .all();
    expect(open).toHaveLength(1);
    expect(open[0].normalizedSector).toBe("Capital Goods");
    expect(open[0].sectorCode).toBe("IN0702");
  });

  it("is append-only: history cannot be deleted", async () => {
    seedMaster([{ isin: "INE001", symbol: "ALPHA" }]);
    await ingestNseSectors({ now: NOW, fetcher: async () => csv(["Alpha Ltd,Financial Services,ALPHA,EQ,INE001"]) });
    expect(() => getDb().delete(schema.sectorClassifications).run()).toThrow(/append-only/);
  });

  it("reports a source outage rather than writing a partial truth", async () => {
    seedMaster([{ isin: "INE001", symbol: "ALPHA" }]);
    const report = await ingestNseSectors({
      now: NOW,
      fetcher: async () => {
        throw new Error("HTTP 503");
      },
    });
    expect(report.ok).toBe(false);
    expect(report.code).toBe("SOURCE_UNAVAILABLE");
    expect(report.message).toMatch(/Nothing was written/);
    expect(currentSectorByInstrument(), "no classification is null, never an empty map").toBeNull();
  });

  it("stores an UNMAPPED label raw rather than forcing it into the taxonomy", async () => {
    seedMaster([{ isin: "INE001", symbol: "ALPHA" }]);
    const report = await ingestNseSectors({
      now: NOW,
      fetcher: async () => csv(["Alpha Ltd,Quantum Teleportation,ALPHA,EQ,INE001"]),
    });
    expect(report.unmapped).toBe(1);
    const row = getDb().select().from(schema.sectorClassifications).all()[0];
    expect(row.rawLabel).toBe("Quantum Teleportation");
    expect(row.normalizationBasis).toBe("UNMAPPED");
    expect(row.normalizedSector, "an unmappable label is never given a sector").toBeNull();
    expect(row.sectorCode).toBeNull();
    // And it contributes NO sector knowledge — data present, sector unknown.
    expect(currentSectorByInstrument()).toBeNull();
  });

  it("exposes the current map only when something is actually classified", async () => {
    expect(sectorClassificationReady()).toBe(true);
    expect(currentSectorByInstrument()).toBeNull();
    seedMaster([{ isin: "INE001", symbol: "ALPHA" }]);
    await ingestNseSectors({ now: NOW, fetcher: async () => csv(["Alpha Ltd,Financial Services,ALPHA,EQ,INE001"]) });
    expect(currentSectorByInstrument()?.get("IN:XNSE:ALPHA")).toBe("Financial Services");
  });
});
