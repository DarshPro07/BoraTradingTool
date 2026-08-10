import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { applyNseSecurityMasterSync, recordNseSecurityMasterFailure } from "@/lib/market/security-master";
import { systemReadiness } from "./readiness";

useTemporaryDatabase();

describe("systemReadiness NSE universe", () => {
  it("reports a fresh database as missing instead of counting BSE catalog aliases", () => {
    const item = systemReadiness().items.find((candidate) => candidate.area === "NSE universe");

    expect(item).toEqual({
      area: "NSE universe",
      status: "MISSING",
      detail: "No verified NSE security master is available.",
      fixedBy: "Automatic official NSE bootstrap runs on the first NSE search; retry the search or run npm run sync:nse.",
    });
  });

  it("reports a small but verified current master as ready", () => {
    const result = applyNseSecurityMasterSync({
      observedAt: new Date(),
      actor: "readiness-test",
      minimumRows: 1,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: [
            "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
            "SBIN,State Bank of India,EQ,01-JAN-2020,10,1,INE062A01020,10",
            "TCS,Tata Consultancy Services Limited,EQ,25-AUG-2004,1,1,INE467B01029,1",
          ].join("\n"),
        },
        {
          kind: "SME",
          url: "https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv",
          content: [
            "SYMBOL,NAME_OF_COMPANY,SERIES,DATE_OF_LISTING,PAID_UP_VALUE,ISIN_NUMBER,FACE_VALUE,",
            "SMETEST,SME Test Limited,SM,01-Aug-26,10,INE000A01001,10,",
          ].join("\n"),
        },
        {
          kind: "ETF",
          url: "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv",
          content: [
            "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue",
            "NIFTYBEES,Nifty50,NIPINDETFNIFTYBEES,08-Jan-02,1,INF204KB14I2,1",
          ].join("\n"),
        },
        // REIT and InvIT are REQUIRED source classes. A master without them is genuinely
        // incomplete, so "ready" must be demonstrated on a COMPLETE master — the next test is the
        // one that proves an incomplete master reports PARTIAL.
        {
          kind: "REIT",
          url: "https://nsearchives.nseindia.com/content/equities/REITS_L.csv",
          content: [
            "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
            "EMBASSY,Embassy Office Parks REIT,RR,01-APR-2019,300,400,INE041025011,300",
          ].join("\n"),
        },
        {
          kind: "INVIT",
          url: "https://nsearchives.nseindia.com/content/equities/INVITS_L.csv",
          content: [
            "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
            "IRBINVIT,IRB InvIT Fund,IV,18-MAY-2017,102,1000,INE183W01011,102",
          ].join("\n"),
        },
      ],
    });
    expect(result.ok).toBe(true);

    const item = systemReadiness().items.find((candidate) => candidate.area === "NSE universe");

    expect(item).toEqual({
      area: "NSE universe",
      status: "READY",
      detail: "6 currently-listed NSE securities from the official security master.",
    });
  });

  it("reports the missing official source classes for an incomplete master", () => {
    const result = applyNseSecurityMasterSync({
      observedAt: new Date(),
      actor: "readiness-test",
      minimumRows: 1,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: [
            "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
            "SBIN,State Bank of India,EQ,01-JAN-2020,10,1,INE062A01020,10",
          ].join("\n"),
        },
      ],
    });
    expect(result.ok).toBe(true);

    const item = systemReadiness().items.find((candidate) => candidate.area === "NSE universe");

    expect(item).toMatchObject({
      status: "PARTIAL",
      detail:
        "1 currently-listed NSE security; required official sources are missing: SME, ETF, REIT, INVIT.",
    });
  });

  it("reports a stale verified master as partial without hiding its listings", () => {
    const result = applyNseSecurityMasterSync({
      observedAt: new Date(Date.now() - 48 * 60 * 60 * 1_000),
      actor: "readiness-test",
      minimumRows: 1,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: [
            "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
            "SBIN,State Bank of India,EQ,01-JAN-2020,10,1,INE062A01020,10",
          ].join("\n"),
        },
      ],
    });
    expect(result.ok).toBe(true);

    const item = systemReadiness().items.find((candidate) => candidate.area === "NSE universe");

    expect(item).toMatchObject({
      status: "PARTIAL",
      detail: "1 currently-listed NSE security from a stale verified master.",
      fixedBy: "Refresh the official NSE security master; the last verified universe remains available.",
    });
  });

  it("reports a failed refresh as partial while retaining the last-good master", () => {
    const observedAt = new Date(Date.now() - 60 * 60 * 1_000);
    const result = applyNseSecurityMasterSync({
      observedAt,
      actor: "readiness-test",
      minimumRows: 1,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: [
            "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
            "SBIN,State Bank of India,EQ,01-JAN-2020,10,1,INE062A01020,10",
          ].join("\n"),
        },
      ],
    });
    expect(result.ok).toBe(true);
    recordNseSecurityMasterFailure({
      observedAt: new Date(),
      actor: "readiness-test",
      sourceUrls: ["https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"],
      message: "upstream unavailable",
    });

    const item = systemReadiness().items.find((candidate) => candidate.area === "NSE universe");

    expect(item).toMatchObject({
      status: "PARTIAL",
      detail: "1 currently-listed NSE security; the last refresh failed, so the verified master remains in use.",
    });
  });
});
