import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { applyNseSecurityMasterSync } from "@/lib/market/security-master";
import { GET } from "./route";

useTemporaryDatabase();

const NSE_FIXTURE = [
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
  "RELIANCE,Reliance Industries Limited,EQ,29-NOV-1995,10,1,INE002A01018,10",
  "TCS,Tata Consultancy Services Limited,EQ,25-AUG-2004,1,1,INE467B01029,1",
].join("\n");
const ETF_FIXTURE = [
  "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue",
  "NIFTYBEES,Nifty50,NIPINDETFNIFTYBEES,08-Jan-02,1,INF204KB14I2,1",
].join("\n");

function officialFixture(start: number, count: number, includeSbin = false): string {
  const rows = Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    const symbol = includeSbin && offset === 0 ? "SBIN" : `TEST${index}`;
    const name = includeSbin && offset === 0 ? "State Bank of India" : `Test Security ${index}`;
    const isin = includeSbin && offset === 0
      ? "INE062A01020"
      : `INE${index.toString().padStart(8, "0")}0`;
    return `${symbol},${name},EQ,01-JAN-2020,10,1,${isin},10`;
  });
  return [NSE_FIXTURE.split("\n")[0], ...rows].join("\n");
}

const REIT_FIXTURE = [
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
  "EMBASSY,Embassy Office Parks REIT,RR,01-APR-2019,300,400,INE041025011,300",
].join("\n");
const INVIT_FIXTURE = [
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
  "IRBINVIT,IRB InvIT Fund,IV,18-MAY-2017,102,1000,INE183W01011,102",
].join("\n");

/**
 * Serve each official source EXPLICITLY, and throw on anything unrecognised.
 *
 * The previous stub fell through to the main equity list for any URL it did not match. When REIT
 * and InvIT sources were added to the bootstrap, this silently served the equity fixture three
 * times over — so SBIN's ISIN arrived repeatedly, the sync failed DUPLICATE_SECURITY, and every
 * test here reported NSE_SECURITY_MASTER_UNAVAILABLE. A test double that guesses turns "we added
 * a source" into a mystery outage; one that throws names the change immediately.
 */
function stubOfficialSources() {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const body = url.includes("SME_EQUITY_L.csv")
      ? officialFixture(2_200, 300)
      : url.includes("eq_etfseclist.csv")
        ? ETF_FIXTURE
        : url.includes("REITS_L.csv")
          ? REIT_FIXTURE
          : url.includes("INVITS_L.csv")
            ? INVIT_FIXTURE
            : url.includes("EQUITY_L.csv")
              ? officialFixture(0, 2_200, true)
              : null;
    if (body === null) throw new Error(`Unstubbed NSE source URL: ${url}`);
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function seedMaster() {
  const result = applyNseSecurityMasterSync({
    // Observed now, so the route treats this master as current and does not reach for the
    // network. A stale seed made this test bootstrap against the LIVE NSE — it passed or failed
    // on what the exchange happened to publish that day, which is not a test.
    observedAt: new Date(),
    actor: "route-test-fixture",
    minimumRows: 1,
    sources: [
      {
        kind: "MAIN",
        url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        content: NSE_FIXTURE,
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
        content: ETF_FIXTURE,
      },
      // REIT and InvIT are REQUIRED source kinds: a master missing them is incomplete, and the
      // route correctly refuses to call it current. Omitting them here made this test's seed look
      // stale and sent it to the live exchange for a "complete" one.
      {
        kind: "REIT",
        url: "https://nsearchives.nseindia.com/content/equities/REITS_L.csv",
        content: REIT_FIXTURE,
      },
      {
        kind: "INVIT",
        url: "https://nsearchives.nseindia.com/content/equities/INVITS_L.csv",
        content: INVIT_FIXTURE,
      },
    ],
  });
  if (!result.ok) throw new Error(result.message);
}

describe("GET /api/market/instruments", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bootstraps the official NSE master before the first XNSE search", async () => {
    const fetchMock = stubOfficialSources();

    const response = await GET(
      new Request("http://localhost/api/market/instruments?exchange=XNSE&q=SBIN&limit=25"),
    );
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      instruments: [
        expect.objectContaining({
          id: "IN:XNSE:SBIN",
          isin: "INE062A01020",
          series: "EQ",
        }),
      ],
      securityMaster: expect.objectContaining({ state: "CURRENT", totalRows: 2_503 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("bootstraps NSE for an unscoped symbol search from the global navigation", async () => {
    const fetchMock = stubOfficialSources();
    const response = await GET(
      new Request("http://localhost/api/market/instruments?q=SBIN&limit=25"),
    );
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      instruments: [expect.objectContaining({ id: "IN:XNSE:SBIN", isin: "INE062A01020" })],
      securityMaster: expect.objectContaining({ state: "CURRENT", totalRows: 2_503 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("returns bounded ISIN-backed results and master provenance", async () => {
    // Any network reach is a defect in this test's isolation, so make it loud rather than let a
    // live fetch quietly decide the assertion.
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      throw new Error(`This test must not touch the network; it requested ${String(input)}`);
    }));
    seedMaster();
    const response = await GET(
      new Request("http://localhost/api/market/instruments?exchange=XNSE&q=Reliance&limit=1&offset=0"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instruments: [
        expect.objectContaining({
          id: "IN:XNSE:RELIANCE",
          securityId: "INE002A01018",
          isin: "INE002A01018",
        }),
      ],
      pagination: { total: 1, limit: 1, offset: 0 },
      securityMaster: expect.objectContaining({ currentSyncId: expect.any(String), totalRows: 6 }),
    });
  });
});
