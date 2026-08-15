import { afterEach, describe, expect, it, vi } from "vitest";
import { getYahooCandles } from "@/lib/providers/yahoo";
import { assertProviderIdentity, IdentityMismatchError } from "./identity-guard";

/**
 * The invariant that must hold for EVERY provider: a successful fetch of the wrong instrument is
 * worse than a failed fetch, because once stored it is indistinguishable from history.
 *
 * The concrete hazard is recorded in docs/external/nse-data-connectors.md: openchart 0.2.0's
 * search endpoint answers every query with the same default index list, and the library's
 * fallback is "use the first result" — so a request for TCS silently returns NIFTY 50. This
 * suite pins the refusal on the provider path actually in production (Yahoo), and on the shared
 * guard every future connector must call.
 */

function chartResponse(servedSymbol: string | null): string {
  return JSON.stringify({
    chart: {
      result: [
        {
          ...(servedSymbol === null ? {} : { meta: { symbol: servedSymbol } }),
          timestamp: [1_700_000_000],
          indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [100] }] },
        },
      ],
      error: null,
    },
  });
}

function stubFetch(body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })),
  );
}

describe("the identity guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses bars when the provider answers for a DIFFERENT instrument", async () => {
    // Exactly the openchart hazard, on the production provider path: asked TCS, served NIFTY.
    stubFetch(chartResponse("^NSEI"));
    await expect(getYahooCandles("TCS.NS", "D", 1, 2)).rejects.toThrow(/IDENTITY_MISMATCH/);
    await expect(getYahooCandles("TCS.NS", "D", 1, 2)).rejects.toThrow(/asked for TCS.NS and answered for \^NSEI/);
  });

  it("accepts bars when the served identity matches (case- and whitespace-insensitively)", async () => {
    stubFetch(chartResponse(" tcs.ns "));
    const bars = await getYahooCandles("TCS.NS", "D", 1, 2);
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(1.5);
  });

  it("proceeds but reports UNSTATED when a provider claims no identity — never a fabricated certainty", async () => {
    expect(assertProviderIdentity("some-provider", "IN:XNSE:TCS", null)).toBe("UNSTATED");
    expect(assertProviderIdentity("some-provider", "IN:XNSE:TCS", "   ")).toBe("UNSTATED");
    // The production path still yields bars — the fact that verification was impossible is
    // recorded by the caller (the ingestion ledger), not silently discarded.
    stubFetch(chartResponse(null));
    await expect(getYahooCandles("TCS.NS", "D", 1, 2)).resolves.toHaveLength(1);
  });

  it("carries the coded error every caller can classify", () => {
    try {
      assertProviderIdentity("openchart", "TCS", "NIFTY 50");
      throw new Error("guard did not throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(IdentityMismatchError);
      expect((caught as IdentityMismatchError).code).toBe("IDENTITY_MISMATCH");
      expect((caught as IdentityMismatchError).returned).toBe("NIFTY 50");
    }
  });
});
