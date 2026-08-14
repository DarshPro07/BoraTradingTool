import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { applyNseSecurityMasterSync } from "./security-master";
import { parseInstrument, resolveInstrument } from "./instruments";
import { INSTRUMENT_CATALOG, NSE_ACCEPTANCE_UNIVERSE, findCurrentInstrument, listCurrentInstruments, searchInstruments } from "./catalog";

/**
 * P0 FINAL PROOF — obsolete-invariant documentation for the assertions below.
 *
 * OLD INVARIANT
 *   "The static catalog contains no hardcoded XNSE universe; the security master is the only
 *   production universe."
 *   WHY IT EXISTED
 *   When the catalog was US-only, every NSE identity had to flow through the exchange-fetched
 *   security master so the system could never serve a stale or invented NSE symbol, and so
 *   ISIN/series provenance always came from one source of truth.
 *
 * NEW REQUIREMENT
 *   The P0 acceptance mandates a pinned 30-security XNSE universe that exists deterministically
 *   offline (no network dependency for acceptance runs) — while the master remains the
 *   enrichment layer that attaches ISIN/series provenance to catalog securities when reachable.
 *   The static catalog now pins exactly those 30 acceptance securities (plus NIFTYBEES, the
 *   regime benchmark used by the learning cycle and ticker tape, which must never become
 *   unresolvable when the master is down).
 *   WHY IT SUPERSEDES THE OLD INVARIANT
 *   An acceptance universe that depends on a live exchange download is not a test: it passes or
 *   fails on what NSE happened to publish that day (this was already demonstrated by test runs
 *   reaching the real exchange). The master's job changed from "sole universe" to "provenance
 *   enrichment" — canonical identity still prefers master metadata when present
 *   (findNseInstrument first), so the old single-source-of-truth goal is preserved at the
 *   resolution layer, not the declaration layer.
 *
 * TEST CHANGE
 *   "no hardcoded XNSE" is replaced by assertions that (a) every XNSE catalog declaration is a
 *   pinned acceptance security or the authorized NIFTYBEES benchmark, (b) all 30 acceptance
 *   securities are catalogued, (c) listings are not truncated to the old search bound of 25,
 *   and (d) marker "XBOM" rows (an era that never shipped a BSE universe) no longer pretend to
 *   exist. These assertions encode the desired behavior: bounded SEARCHES, untruncated
 *   LISTINGS, and no drift between the acceptance matrix and the catalog.
 */

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
  it("pins exactly the 30-security NSE acceptance universe, no more, no less", () => {
    const xnseCatalog = INSTRUMENT_CATALOG.filter((item) => item.exchange === "XNSE");
    const symbols = xnseCatalog.map((item) => item.symbol);
    // The acceptance universe is source-controlled: 30 unique securities.
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(NSE_ACCEPTANCE_UNIVERSE).toHaveLength(30);
    // Every acceptance security must be in the catalog...
    for (const symbol of NSE_ACCEPTANCE_UNIVERSE) {
      expect(symbols).toContain(symbol);
    }
    // ...and the catalog may declare XNSE ONLY from the acceptance universe plus the authorized
    // NIFTYBEES regime benchmark (learning cycle / ticker tape). Anything else is drift.
    const authorized = new Set([...NSE_ACCEPTANCE_UNIVERSE, "NIFTYBEES"]);
    for (const symbol of symbols) {
      expect(authorized.has(symbol), `unexpected XNSE catalog security ${symbol}`).toBe(true);
    }
  });

  it("searches names and filters exchanges", () => {
    // "Reliance" resolves through the master (ISIN-backed) and deduplicates against the static
    // catalog row: exactly one XNSE result. There is no BSE (XBOM) universe in the system.
    expect(searchInstruments("Reliance").map((item) => item.exchange)).toEqual(["XNSE"]);
    expect(searchInstruments("bank", "XNSE").every((item) => item.exchange === "XNSE")).toBe(true);
    expect(searchInstruments("INE467B01029", "XNSE")[0]).toMatchObject({ symbol: "TCS", securityId: "INE467B01029" });
  });

  it("returns bounded searches and untruncated pinned listings", () => {
    // A bare query is a SEARCH: bounded so the search UI stays cheap.
    expect(searchInstruments("x").length).toBeLessThanOrEqual(25);
    expect(searchInstruments("a").length).toBeLessThanOrEqual(25);
    // An empty query is a LISTING: it must expose the full pinned snapshot, not a 25-row slice.
    // (The old truncation is what made the acceptance matrix see only 25 instruments.)
    const listing = searchInstruments("");
    expect(listing.length).toBeGreaterThanOrEqual(30);
    const xnseListing = searchInstruments("", "XNSE");
    expect(xnseListing.length).toBeGreaterThanOrEqual(30);
    expect(xnseListing.every((item) => item.exchange === "XNSE")).toBe(true);
    // XBOM: an era that never shipped a BSE universe — the old >= 10 assertion was a fiction.
    expect(searchInstruments("", "XBOM")).toEqual([]);
  });

  it("provides repository-backed enumeration and lookup to backend consumers", () => {
    const xnse = listCurrentInstruments({ exchange: "XNSE" }).map((item) => item.symbol);
    for (const symbol of NSE_ACCEPTANCE_UNIVERSE) {
      expect(xnse).toContain(symbol);
    }
    expect(findCurrentInstrument("IN:XNSE:RELIANCE")).toMatchObject({
      securityId: "INE002A01018",
      symbol: "RELIANCE",
    });
  });
});
