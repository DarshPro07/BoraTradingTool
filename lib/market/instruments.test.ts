import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { applyNseSecurityMasterSync } from "./security-master";
import { parseInstrument, resolveInstrument } from "./instruments";
import { INSTRUMENT_CATALOG, findCurrentInstrument, listCurrentInstruments, searchInstruments } from "./catalog";

const NSE_FIXTURE = [
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
  "RELIANCE,Reliance Industries Limited,EQ,29-NOV-1995,10,1,INE002A01018,10",
  "TCS,Tata Consultancy Services Limited,EQ,25-AUG-2004,1,1,INE467B01029,1",
  "HDFCBANK,HDFC Bank Limited,EQ,08-NOV-1995,1,1,INE040A01034,1",
].join("\n");

useTemporaryDatabase(() => {
  const result = applyNseSecurityMasterSync({
    observedAt: new Date("2026-08-09T00:00:00Z"),
    actor: "instrument-test-fixture",
    minimumRows: 1,
    sources: [
      {
        kind: "MAIN",
        url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        content: NSE_FIXTURE,
      },
      {
        kind: "ETF",
        url: "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv",
        content: [
          "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue",
          "NIFTYBEES,Nifty50,NIPINDETFNIFTYBEES,08-Jan-02,1,INF204KB14I2,1",
        ].join("\n"),
      },
    ],
  });
  if (!result.ok) throw new Error(result.message);
});

describe("parseInstrument", () => {
  it("normalizes US, NSE, and BSE identities", () => {
    expect(parseInstrument("us:xnas:aapl")).toMatchObject({
      id: "US:XNAS:AAPL",
      providerSymbol: "AAPL",
      currency: "USD",
    });
    expect(parseInstrument("RELIANCE.NS")).toMatchObject({
      id: "IN:XNSE:RELIANCE",
      providerSymbol: "RELIANCE.NS",
      currency: "INR",
    });
    expect(parseInstrument("IN:XBOM:500325")).toMatchObject({
      providerSymbol: "500325.BO",
      timezone: "Asia/Kolkata",
    });
  });

  it("retains explicit unknown canonical instruments without guessing an exchange", () => {
    expect(parseInstrument("US:XNYS:XYZ")).toMatchObject({ id: "US:XNYS:XYZ", name: "XYZ" });
    expect(() => parseInstrument("XYZ")).toThrow(/canonical instrument ID/i);
  });

  it("retains security-master metadata for an explicit canonical NSE identity", () => {
    expect(resolveInstrument("IN:XNSE:NIFTYBEES")).toMatchObject({
      id: "IN:XNSE:NIFTYBEES",
      name: "NIPINDETFNIFTYBEES",
      securityId: "INF204KB14I2",
      isin: "INF204KB14I2",
      series: "EQ",
      assetType: "ETF",
    });
  });

  it.each([
    "../../../package",
    "RELIANCE.NS\nX",
    "US:XNSE:AAPL",
    "IN:XNAS:RELIANCE",
    "AAPL.L",
    "",
  ])("rejects invalid input %j", (value) => {
    expect(() => parseInstrument(value)).toThrowError(expect.objectContaining({ code: "INVALID_INSTRUMENT" }));
  });
});

describe("searchInstruments", () => {
  it("contains no hardcoded XNSE universe", () => {
    expect(INSTRUMENT_CATALOG.filter((item) => item.exchange === "XNSE")).toEqual([]);
  });

  it("searches names and filters exchanges", () => {
    expect(searchInstruments("Reliance").map((item) => item.exchange)).toEqual(["XNSE", "XBOM"]);
    expect(searchInstruments("bank", "XNSE").every((item) => item.exchange === "XNSE")).toBe(true);
    expect(searchInstruments("INE467B01029", "XNSE")[0]).toMatchObject({ symbol: "TCS", securityId: "INE467B01029" });
  });

  it("returns a bounded balanced catalog", () => {
    expect(searchInstruments("")).toHaveLength(25);
    expect(searchInstruments("", "XBOM").length).toBeGreaterThanOrEqual(10);
    expect(searchInstruments("", "XNSE")).toHaveLength(4);
  });

  it("provides repository-backed enumeration and lookup to backend consumers", () => {
    expect(listCurrentInstruments({ exchange: "XNSE" }).map((item) => item.symbol)).toEqual([
      "HDFCBANK",
      "NIFTYBEES",
      "RELIANCE",
      "TCS",
    ]);
    expect(findCurrentInstrument("IN:XNSE:RELIANCE")).toMatchObject({
      securityId: "INE002A01018",
      symbol: "RELIANCE",
    });
  });
});
