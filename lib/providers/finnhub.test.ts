import { afterEach, describe, expect, it, vi } from "vitest";
import { FinnhubProvider } from "./finnhub";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FinnhubProvider credential handling", () => {
  it("sends the API key in a header rather than the request URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, _init) =>
      new Response(JSON.stringify({ c: 100, o: 99, h: 101, l: 98, pc: 99, d: 1, dp: 1, v: 10 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await new FinnhubProvider("test-finnhub-token").getQuote("AAPL");

    const [input, init] = fetchMock.mock.calls[0];
    expect(new URL(String(input)).searchParams.has("token")).toBe(false);
    expect(new Headers(init?.headers).get("X-Finnhub-Token")).toBe("test-finnhub-token");
  });
});
