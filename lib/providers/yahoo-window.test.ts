import { afterEach, describe, expect, it, vi } from "vitest";
import { candleTimeoutMs, getYahooCandles, YAHOO_TIMEOUT_MS } from "./yahoo";

/**
 * The window-aware range shortcut (owner correction 2026-08-16).
 *
 * The intraday accumulator has ALWAYS requested 59-day windows ("the widest window the provider
 * will serve… sized to what is known to work" — its own comment), but the range shortcut built
 * `range=1d` for every 5m call regardless of the requested window, silently truncating 59 days
 * to one. That is why intraday coverage grew one session per day instead of arriving 55 sessions
 * at a time. The fix keys the shortcut on the REQUESTED window: live session-sized calls keep
 * the exact range semantics; anything wider goes period-based (proven live 2026-08-16: one
 * TCS.NS request returned 4,125 5m bars across 55 sessions).
 */

const chartPayload = JSON.stringify({
  chart: {
    result: [
      {
        timestamp: [1_700_000_000],
        indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] },
      },
    ],
    error: null,
  },
});

function stubFetchCapturing(urls: string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      return new Response(chartPayload, { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

describe("getYahooCandles window-aware URL selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a session-sized 5m request keeps the live range shortcut exactly as before", async () => {
    const urls: string[] = [];
    stubFetchCapturing(urls);
    const now = 1_755_300_000;
    await getYahooCandles("TCS.NS", "5", now - 6 * 3600, now);
    expect(urls[0]).toContain("range=1d");
    expect(urls[0]).toContain("interval=5m");
    expect(urls[0]).not.toContain("period1");
  });

  it("a 55-day 5m request goes period-based — the historical backfill the accumulator always asked for", async () => {
    const urls: string[] = [];
    stubFetchCapturing(urls);
    const now = 1_755_300_000;
    const from = now - 55 * 86_400;
    await getYahooCandles("TCS.NS", "5", from, now);
    expect(urls[0], "a 59-day request silently truncated to range=1d was the defect").not.toContain("range=1d");
    expect(urls[0]).toContain(`period1=${from}`);
    expect(urls[0]).toContain(`period2=${now}`);
    expect(urls[0]).toContain("interval=5m");
  });

  /**
   * The second half of the same defect. Having fixed the URL so a 59-day 5m request actually asks
   * for 59 days, the request now returns ~3,000 bars — and it was still governed by a timeout
   * whose own comment says it was sized so a *page render* would not hang: "these calls block a
   * server render… four seconds… turning an outage into a fast, honest refusal."
   *
   * Correct for a quote, wrong for the heaviest request in the system. The observed production
   * failure was exactly this shape: `IN:XNSE:ASKAUTOLTD` timed out at 5m while its own 15m and
   * 60m fetches succeeded in the same pass — the largest payload under the smallest budget. The
   * budget must follow what is being asked for, not the caller that happens to be least patient.
   */
  it("a bulk intraday backfill is not held to the render budget", () => {
    const now = 1_755_300_000;
    const bulk = candleTimeoutMs("5", now - 59 * 86_400, now);
    expect(bulk).toBeGreaterThan(YAHOO_TIMEOUT_MS);
  });

  it("a session-sized request keeps the render budget — a slow page is still the worse failure", () => {
    const now = 1_755_300_000;
    expect(candleTimeoutMs("5", now - 6 * 3_600, now)).toBe(YAHOO_TIMEOUT_MS);
    // Daily history is a few hundred bars however long the window; nobody needs to wait longer.
    expect(candleTimeoutMs("D", now - 365 * 86_400, now)).toBe(YAHOO_TIMEOUT_MS);
  });

  it("daily requests are untouched by the shortcut logic", async () => {
    const urls: string[] = [];
    stubFetchCapturing(urls);
    const now = 1_755_300_000;
    await getYahooCandles("TCS.NS", "D", now - 365 * 86_400, now);
    expect(urls[0]).toContain("interval=1d");
    expect(urls[0]).toContain("period1=");
  });
});
