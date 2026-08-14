import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  applyNseSecurityMasterSync,
  findNseInstrument,
  listNseInstrumentsAsOf,
  parseNseSecurityCsv,
  recordNseSecurityMasterFailure,
  setNseProviderMapping,
  searchCurrentNseInstruments,
  securityMasterStatus,
} from "./security-master";

useTemporaryDatabase();

const HEADER =
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";

function csv(
  rows: Array<{
    symbol: string;
    name: string;
    series?: string;
    isin: string;
    listed?: string;
  }>,
): string {
  return [
    HEADER,
    ...rows.map(
      (row) =>
        `${row.symbol},"${row.name}",${row.series ?? "EQ"},${row.listed ?? "29-NOV-1995"},10,1,${row.isin},10`,
    ),
  ].join("\r\n");
}

const RELIANCE = {
  symbol: "RELIANCE",
  name: "Reliance Industries Limited",
  isin: "INE002A01018",
};

const TCS = {
  symbol: "TCS",
  name: "Tata Consultancy Services Limited",
  isin: "INE467B01029",
};

const BECTOR_FOOD = {
  symbol: "BECTORFOOD",
  name: "Mrs. Bectors Food Specialities Limited",
  isin: "INE495P01020",
};

const SECOND_SECURITY = {
  symbol: "SECOND",
  name: "Second Security Limited",
  isin: "INE999Y01011",
};

function syncAt(observedAt: string, rows: Parameters<typeof csv>[0]) {
  return applyNseSecurityMasterSync({
    observedAt: new Date(observedAt),
    actor: "test",
    minimumRows: 1,
    maxDropFraction: 0.6,
    sources: [
      {
        kind: "MAIN",
        url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        content: csv(rows),
      },
    ],
  });
}

describe("official NSE CSV parsing", () => {
  it("normalizes the official headers, BOM, quoted names, and ISIN identity", () => {
    const rows = parseNseSecurityCsv(`\uFEFF${csv([RELIANCE])}`, "MAIN");

    expect(rows).toEqual([
      expect.objectContaining({
        securityId: "INE002A01018",
        isin: "INE002A01018",
        symbol: "RELIANCE",
        name: "Reliance Industries Limited",
        series: "EQ",
        dateOfListing: "1995-11-29",
        source: "MAIN",
      }),
    ]);
  });

  it("rejects a row with no durable ISIN instead of inventing a symbol identity", () => {
    expect(() => parseNseSecurityCsv(csv([{ ...RELIANCE, isin: "" }]), "MAIN")).toThrow(/ISIN/i);
  });

  it("accepts the official SME underscore headers without inventing an absent market lot", () => {
    const rows = parseNseSecurityCsv(
      [
        "SYMBOL,NAME_OF_COMPANY,SERIES,DATE_OF_LISTING,PAID_UP_VALUE,ISIN_NUMBER,FACE_VALUE,",
        "PROPSHOP,Propshop Events and Exhibitions Limited,ST,03-Aug-26,10,INE1FFX01018,10,",
      ].join("\n"),
      "SME",
    );

    expect(rows[0]).toMatchObject({
      symbol: "PROPSHOP",
      series: "ST",
      isin: "INE1FFX01018",
      dateOfListing: "2026-08-03",
      marketLot: null,
      source: "SME",
    });
  });

  it("parses the official ETF list as ETF instruments", () => {
    const rows = parseNseSecurityCsv(
      [
        "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue",
        "NIFTYBEES,Nifty50,NIPINDETFNIFTYBEES,08-Jan-02,1,INF204KB14I2,1",
      ].join("\n"),
      "ETF",
    );

    expect(rows[0]).toMatchObject({
      symbol: "NIFTYBEES",
      name: "NIPINDETFNIFTYBEES",
      series: "EQ",
      isin: "INF204KB14I2",
      dateOfListing: "2002-01-08",
      marketLot: 1,
      paidUpValue: null,
      assetType: "ETF",
      source: "ETF",
    });
  });

  it.each([
    ["REIT", "BIRET", "Brookfield India Real Estate Trust", "RR", "INE0FDU25010"],
    ["INVIT", "OSEINTRUST", "Oriental InfraTrust", "IV", "INE07Z523018"],
  ] as const)("parses the official %s list with its real asset type", (source, symbol, name, series, isin) => {
    const rows = parseNseSecurityCsv(
      [
        HEADER,
        `${symbol},${name},${series},16-Feb-21,100,200,${isin},100`,
        '"Note: the Market lot is updated as on the date of listing.",,,,,,,',
      ].join("\n"),
      source as never,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol, name, series, isin, assetType: source, source });
  });
});

describe("effective-dated ISIN identity", () => {
  it("keeps one security across a symbol change and resolves the historical alias", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [RELIANCE]).ok).toBe(true);
    expect(
      syncAt("2026-08-02T00:00:00Z", [
        { ...RELIANCE, symbol: "RELIANCE2", name: "Reliance Industries Ltd" },
      ]).ok,
    ).toBe(true);

    expect(searchCurrentNseInstruments("RELIANCE2").items[0]).toMatchObject({
      securityId: RELIANCE.isin,
      isin: RELIANCE.isin,
      id: "IN:XNSE:RELIANCE2",
      symbol: "RELIANCE2",
    });
    expect(findNseInstrument("IN:XNSE:RELIANCE")).toMatchObject({
      securityId: RELIANCE.isin,
      symbol: "RELIANCE2",
    });
    expect(listNseInstrumentsAsOf(new Date("2026-08-01T12:00:00Z"))[0]).toMatchObject({
      securityId: RELIANCE.isin,
      symbol: "RELIANCE",
    });
  });

  it("retains a later-inactive security in the earlier universe without lookahead", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [RELIANCE, TCS]).ok).toBe(true);
    expect(syncAt("2026-08-02T00:00:00Z", [RELIANCE]).ok).toBe(true);

    expect(listNseInstrumentsAsOf(new Date("2026-08-01T12:00:00Z")).map((row) => row.symbol)).toEqual([
      "RELIANCE",
      "TCS",
    ]);
    expect(searchCurrentNseInstruments("").items.map((row) => row.symbol)).toEqual(["RELIANCE"]);
  });

  it("refuses a date before archive coverage instead of claiming the market was empty", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [RELIANCE]).ok).toBe(true);

    expect(() => listNseInstrumentsAsOf(new Date("2025-01-01T00:00:00Z"))).toThrow(
      expect.objectContaining({ code: "NOT_YET_OBSERVED" }),
    );
  });

  it("allows a historical symbol to be reused and resolves it to the latest verified security", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [{ ...RELIANCE, symbol: "OLD" }]).ok).toBe(true);
    expect(syncAt("2026-08-02T00:00:00Z", [{ ...RELIANCE, symbol: "NEW" }]).ok).toBe(true);
    expect(
      syncAt("2026-08-03T00:00:00Z", [
        { ...RELIANCE, symbol: "NEW" },
        { ...SECOND_SECURITY, symbol: "OLD" },
      ]).ok,
    ).toBe(true);
    expect(
      syncAt("2026-08-04T00:00:00Z", [
        { ...RELIANCE, symbol: "NEW" },
        { ...SECOND_SECURITY, symbol: "LATEST" },
      ]).ok,
    ).toBe(true);

    expect(findNseInstrument("OLD")).toMatchObject({
      isin: SECOND_SECURITY.isin,
      symbol: "LATEST",
    });
  });
});

describe("atomic sync and last-good retention", () => {
  it("reports missing official source classes instead of calling a partial master current", () => {
    expect(syncAt("2026-08-10T00:00:00Z", [RELIANCE]).ok).toBe(true);

    expect(securityMasterStatus(new Date("2026-08-10T01:00:00Z"))).toMatchObject({
      state: "INCOMPLETE",
      totalRows: 1,
      sourceKinds: ["MAIN"],
      missingSourceKinds: ["SME", "ETF", "REIT", "INVIT"],
    });
  });

  it("records a malformed attempt while preserving the last verified current universe", () => {
    const good = syncAt("2026-08-01T00:00:00Z", [RELIANCE, TCS]);
    expect(good.ok).toBe(true);

    const failed = applyNseSecurityMasterSync({
      observedAt: new Date("2026-08-02T00:00:00Z"),
      actor: "test",
      minimumRows: 1,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: `${HEADER}\r\nBROKEN`,
        },
      ],
    });

    expect(failed).toMatchObject({ ok: false, errorCode: "MALFORMED_SOURCE" });
    expect(searchCurrentNseInstruments("").items.map((row) => row.symbol)).toEqual(["RELIANCE", "TCS"]);
    expect(securityMasterStatus()).toMatchObject({
      state: "FAILED_LAST_ATTEMPT",
      currentSyncId: good.syncId,
      lastAttemptId: failed.syncId,
      totalRows: 2,
    });
  });

  it("rejects an implausible source drop before it can retire verified listings", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [RELIANCE, TCS]).ok).toBe(true);
    const failed = applyNseSecurityMasterSync({
      observedAt: new Date("2026-08-02T00:00:00Z"),
      actor: "test",
      minimumRows: 1,
      maxDropFraction: 0.2,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: csv([RELIANCE]),
        },
      ],
    });

    expect(failed).toMatchObject({ ok: false, errorCode: "IMPLAUSIBLE_ROW_DROP" });
    expect(searchCurrentNseInstruments("").items.map((row) => row.symbol)).toEqual(["RELIANCE", "TCS"]);
  });

  it("records a fetch failure while retaining the latest verified universe", () => {
    const good = syncAt("2026-08-01T00:00:00Z", [RELIANCE]);
    const failed = recordNseSecurityMasterFailure({
      observedAt: new Date("2026-08-02T00:00:00Z"),
      actor: "test-fetcher",
      sourceUrls: ["https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"],
      message: "HTTP 503",
    });

    expect(failed).toMatchObject({ ok: false, errorCode: "SOURCE_FETCH_FAILED" });
    expect(securityMasterStatus()).toMatchObject({
      state: "FAILED_LAST_ATTEMPT",
      currentSyncId: good.syncId,
      lastAttemptId: failed.syncId,
    });
    expect(searchCurrentNseInstruments("Reliance").items).toHaveLength(1);
  });

  it("rejects an observation older than the latest success", () => {
    const good = syncAt("2026-08-02T00:00:00Z", [RELIANCE]);
    const older = syncAt("2026-08-01T00:00:00Z", [{ ...RELIANCE, symbol: "OLD" }]);

    expect(older).toMatchObject({ ok: false, errorCode: "NON_MONOTONIC_OBSERVATION" });
    expect(searchCurrentNseInstruments("Reliance").items[0]).toMatchObject({
      id: "IN:XNSE:RELIANCE",
      securityId: RELIANCE.isin,
    });
    expect(securityMasterStatus()).toMatchObject({ currentSyncId: good.syncId });
  });
});

describe("bounded current search", () => {
  it("searches symbol, company name, and ISIN with deterministic pagination", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [TCS, RELIANCE]).ok).toBe(true);

    expect(searchCurrentNseInstruments("Reliance").items[0]?.isin).toBe(RELIANCE.isin);
    expect(searchCurrentNseInstruments("Tata Consultancy").items[0]?.symbol).toBe("TCS");
    expect(searchCurrentNseInstruments(TCS.isin).items[0]?.symbol).toBe("TCS");
    expect(searchCurrentNseInstruments("", { limit: 1, offset: 1 })).toMatchObject({
      total: 2,
      limit: 1,
      offset: 1,
      items: [expect.objectContaining({ symbol: "TCS" })],
    });
  });

  it("keeps listing availability separate from verified market-data support", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [RELIANCE, TCS]).ok).toBe(true);
    setNseProviderMapping({
      provider: "YAHOO",
      isin: RELIANCE.isin,
      providerSymbol: "RELIANCE.NS",
      availability: "AVAILABLE",
      verifiedAt: new Date("2026-08-01T01:00:00Z"),
      source: "test probe",
    });
    setNseProviderMapping({
      provider: "YAHOO",
      isin: TCS.isin,
      providerSymbol: "TCS.NS",
      availability: "UNAVAILABLE",
      verifiedAt: new Date("2026-08-01T01:00:00Z"),
      source: "test probe",
    });

    expect(searchCurrentNseInstruments("Reliance").items[0]).toMatchObject({
      listingStatus: "LISTED",
      dataAvailability: "AVAILABLE",
    });
    expect(searchCurrentNseInstruments("TCS").items[0]).toMatchObject({
      listingStatus: "LISTED",
      dataAvailability: "UNAVAILABLE",
    });
  });

  it("matches spaced user terms against compact symbols and company-name tokens", () => {
    expect(syncAt("2026-08-01T00:00:00Z", [BECTOR_FOOD]).ok).toBe(true);

    expect(searchCurrentNseInstruments("bector food").items).toEqual([
      expect.objectContaining({
        id: "IN:XNSE:BECTORFOOD",
        isin: BECTOR_FOOD.isin,
      }),
    ]);
    expect(searchCurrentNseInstruments("mrs bector food").items[0]?.symbol).toBe("BECTORFOOD");
  });

  it("never fabricates a symbol match across the .NS exchange-suffix boundary", () => {
    // "LIQUIDSBI.NS" compacts to "LIQUIDSBINS": compacting the provider symbol lets "SBI" + "NS"
    // spell "SBIN" and makes LIQUIDSBI a top hit for a SBIN search. The suffix must participate
    // in direct matching only; compaction may apply to symbol/name/id/ISIN alone.
    const LIQUIDSBI = {
      symbol: "LIQUIDSBI",
      name: "SBIAMC-LIQUIDSBI",
      isin: "INF200KA13Z8",
    };
    expect(syncAt("2026-08-01T00:00:00Z", [
      LIQUIDSBI,
      { symbol: "SBIN", name: "State Bank of India", isin: "INE062A01020" },
    ]).ok).toBe(true);

    const matches = searchCurrentNseInstruments("SBIN").items.map((row) => row.symbol);
    expect(matches).toEqual(["SBIN"]);
    // Compaction still works on the symbol itself ("BECTORFOOD" must find the compact security).
    expect(searchCurrentNseInstruments("SBINMID").items).toEqual([]);
  });

  it("keeps duplicate company names searchable without treating the name as a unique identity", () => {
    const duplicateName = "Example Holdings Limited";
    expect(syncAt("2026-08-01T00:00:00Z", [
      { symbol: "EXAMPLE", name: duplicateName, isin: "INE999X01013" },
      { symbol: "EXAMPLEDVR", name: duplicateName, isin: "INE999X01021" },
    ]).ok).toBe(true);

    expect(searchCurrentNseInstruments("Example Holdings").items).toHaveLength(2);
    expect(findNseInstrument(duplicateName)).toBeNull();
  });
});

describe("a duplicate ISIN is an instrument-level conflict, never a market-wide outage", () => {
  it("keeps the master usable when one security appears twice with conflicting identity", () => {
    // The defect this pins (found 2026-08-11): NSE publishes SEPARATE current files for Equity,
    // SME, ETF, REIT and InvIT, and a security legitimately moves between series (BE <-> EQ)
    // while keeping its ISIN. The sync deduplicated on ISIN alone and THREW on any repeat, so a
    // single duplicated ISIN failed the whole sync and drove search to
    // NSE_SECURITY_MASTER_UNAVAILABLE for the entire market. One ambiguous security must not
    // delete every unambiguous one.
    const result = syncAt("2026-08-10T00:00:00Z", [
      RELIANCE,
      SECOND_SECURITY,
      // Same ISIN as RELIANCE, different symbol and series: a genuine identity conflict.
      { ...RELIANCE, symbol: "RELIANCEBE", series: "BE" },
    ]);

    expect(result.ok, `sync failed: ${result.ok ? "" : result.message}`).toBe(true);
    if (!result.ok) return;

    // The unambiguous security is still resolvable...
    const second = findNseInstrument(SECOND_SECURITY.isin);
    expect(second?.symbol).toBe("SECOND");

    // ...and the ambiguous one is withheld rather than resolved to an arbitrary row.
    expect(findNseInstrument(RELIANCE.isin)).toBeNull();
  });

  it("accepts the same security listed in two official source files without conflict", () => {
    // Identical identity in MAIN and SME is one security in two files, not a contradiction.
    const result = applyNseSecurityMasterSync({
      observedAt: new Date("2026-08-10T00:00:00Z"),
      actor: "test",
      minimumRows: 1,
      maxDropFraction: 0.6,
      sources: [
        { kind: "MAIN", url: "https://example.test/main.csv", content: csv([RELIANCE, SECOND_SECURITY]) },
        { kind: "SME", url: "https://example.test/sme.csv", content: csv([RELIANCE]) },
      ],
    });

    expect(result.ok, `sync failed: ${result.ok ? "" : result.message}`).toBe(true);
    expect(findNseInstrument(RELIANCE.isin)?.symbol).toBe("RELIANCE");
  });
});
