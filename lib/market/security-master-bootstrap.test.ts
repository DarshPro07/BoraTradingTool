import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { applyNseSecurityMasterSync } from "./security-master";
import { ensureNseSecurityMasterReady } from "./security-master-bootstrap";

useTemporaryDatabase();

const HEADER = "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";
const MAIN = [HEADER, "SBIN,State Bank of India,EQ,01-JAN-2020,10,1,INE062A01020,10"].join("\n");
const SME = [HEADER, "SMETEST,SME Test Limited,SM,01-JAN-2020,10,1,INE000A01001,10"].join("\n");
const ETF = [
  "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue",
  "NIFTYBEES,Nifty50,NIPINDETFNIFTYBEES,08-Jan-02,1,INF204KB14I2,1",
].join("\n");
const REIT = [HEADER, "BIRET,Brookfield India Real Estate Trust,RR,16-Feb-21,275,200,INE0FDU25010,275"].join("\n");
const INVIT = [HEADER, "OSEINTRUST,Oriental InfraTrust,IV,27-Jun-19,100,200000,INE07Z523018,100"].join("\n");

function sourceContent(url: string): string {
  if (url.includes("SME_EQUITY_L.csv")) return SME;
  if (url.includes("eq_etfseclist.csv")) return ETF;
  if (url.includes("REITS_L.csv")) return REIT;
  if (url.includes("INVITS_L.csv")) return INVIT;
  return MAIN;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("NSE security-master bootstrap", () => {
  it("shares one official sync across concurrent first-use requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      await gate;
      return new Response(sourceContent(String(input)), { status: 200 });
    });
    const options = {
      fetcher,
      minimumRows: 5,
      now: () => new Date("2026-08-10T12:00:00Z"),
    };

    const first = ensureNseSecurityMasterReady(options);
    const second = ensureNseSecurityMasterReady(options);
    expect(fetcher).toHaveBeenCalledTimes(5);
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ ok: true, bootstrapped: true });
    expect(secondResult).toMatchObject({ ok: true, bootstrapped: true });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("records an explicit unavailable state when the first official fetch fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));

    const result = await ensureNseSecurityMasterReady({
      fetcher,
      minimumRows: 2,
      now: () => new Date("2026-08-10T12:00:00Z"),
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "SOURCE_FETCH_FAILED",
      securityMaster: {
        state: "UNAVAILABLE",
        currentSyncId: null,
        lastAttemptId: expect.any(String),
        totalRows: 0,
      },
    });
  });

  it("serves an existing verified master without making a network request", async () => {
    const seeded = applyNseSecurityMasterSync({
      observedAt: new Date(),
      actor: "bootstrap-test",
      minimumRows: 1,
      sources: [
        { kind: "MAIN", url: "https://example.test/main.csv", content: MAIN },
        { kind: "SME", url: "https://example.test/sme.csv", content: SME },
        { kind: "ETF", url: "https://example.test/etf.csv", content: ETF },
        { kind: "REIT" as never, url: "https://example.test/reit.csv", content: REIT },
        { kind: "INVIT" as never, url: "https://example.test/invit.csv", content: INVIT },
      ],
    });
    expect(seeded.ok).toBe(true);
    const fetcher = vi.fn<typeof fetch>();

    const result = await ensureNseSecurityMasterReady({ fetcher });

    expect(result).toMatchObject({ ok: true, bootstrapped: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("upgrades an existing master when a required official source class is missing", async () => {
    const observedAt = new Date(Date.now() - 60_000);
    const seeded = applyNseSecurityMasterSync({
      observedAt,
      actor: "bootstrap-test",
      minimumRows: 1,
      sources: [{ kind: "MAIN", url: "https://example.test/main.csv", content: MAIN }],
    });
    expect(seeded.ok).toBe(true);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      return new Response(sourceContent(String(input)), { status: 200 });
    });

    const result = await ensureNseSecurityMasterReady({
      fetcher,
      minimumRows: 5,
      now: () => new Date(observedAt.getTime() + 30_000),
    });

    expect(result).toMatchObject({
      ok: true,
      bootstrapped: true,
      securityMaster: { state: "CURRENT", totalRows: 5, missingSourceKinds: [] },
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("does not replace an explicit test fixture with live NSE data", async () => {
    const seeded = applyNseSecurityMasterSync({
      observedAt: new Date(),
      actor: "playwright-fixture",
      minimumRows: 1,
      sources: [{ kind: "MAIN", url: "fixture://nse/main", content: MAIN }],
    });
    expect(seeded.ok).toBe(true);
    vi.stubEnv("MARKETPULSE_TEST_MODE", "1");
    const fetcher = vi.fn<typeof fetch>();

    const result = await ensureNseSecurityMasterReady({ fetcher });

    expect(result).toMatchObject({ ok: true, bootstrapped: false, securityMaster: { totalRows: 1 } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
