import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { loadStoredCandles, persistCandles } from "@/lib/market/candle-store";

/**
 * **What MarketPulse claims can never happen:** a daily bar is stored for a day the exchange was
 * closed.
 *
 * Measured 2026-08-17. `RELIANCE`, `TCS` and `HDFCBANK` — the three largest weights on the NSE —
 * each held **122 Sunday-dated daily bars and only 3 Friday-dated ones**. Their entire series was
 * stamped one calendar day early: every Monday session written to Sunday, every Friday session to
 * Thursday. Confirmed against an independent source at 429/436 (98.4%) exact close matches under a
 * +1 day shift.
 *
 * The cost is not a cosmetic date error. A backtest joins instruments on a common date index, so
 * RELIANCE's "day D" bar — really day D+1 — was aligned against every other instrument's true day
 * D. That is **one full day of lookahead on the three largest-cap names in the universe**, and it
 * was silent: each bar was individually well-formed, coherent under the OHLC guard, and inside a
 * plausible price range.
 *
 * Nothing could have caught it. The `out_of_session` audit checks a bar's **minute of day** and
 * never its **weekday**, so a Sunday daily bar was out-of-session by no rule the system had.
 *
 * Driven through `persistCandles` because that is the one funnel every ingestion path shares —
 * Yahoo, Upstox, the import scripts and the accumulator alike. A guard in the provider that found
 * the bug would leave every sibling caller unprotected.
 */

useTemporaryDatabase();

/** Unix seconds at the 09:15 IST session open for a calendar day — the store's daily convention. */
function sessionOpen(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000 + (9 * 3600 + 15 * 60) - (5 * 3600 + 30 * 60);
}

function daily(ticker: string, isoDate: string, close: number) {
  return {
    ticker,
    resolution: "D",
    time: sessionOpen(isoDate),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

describe("INVARIANT: the store holds no daily bar for a day the exchange was shut", () => {
  it("refuses an undeclared Sunday-dated daily bar", () => {
    // 2024-11-03 was an ordinary Sunday. The production store held exactly this bar for RELIANCE,
    // carrying Monday 2024-11-04's close of 1302.15.
    const result = persistCandles([daily("IN:XNSE:RELIANCE", "2024-11-03", 1302.15)]);

    expect(result.inserted, "a Sunday session does not exist").toBe(0);
    expect(result.rejected).toBe(1);
    expect(loadStoredCandles("IN:XNSE:RELIANCE", "D")).toHaveLength(0);
  });

  it("keeps the exchange's real weekend sessions and refuses the rest", () => {
    // The first version of this guard banned Sunday outright, on the reasoning that NSE has no
    // Sunday session. That was wrong: Muhurat trading follows Diwali whichever day it lands on,
    // and 2023-11-12 was a Sunday. A guard against one fault must not introduce another.
    const result = persistCandles([
      daily("IN:XNSE:INFY", "2025-02-01", 1900), // Sat — Union Budget live session
      daily("IN:XNSE:INFY", "2023-11-12", 1450), // Sun — Muhurat trading, Diwali
      daily("IN:XNSE:INFY", "2025-02-08", 1910), // an ordinary Saturday
      daily("IN:XNSE:INFY", "2025-02-09", 1920), // an ordinary Sunday
    ]);

    expect(result.inserted, "both declared sessions are real history").toBe(2);
    expect(result.rejected).toBe(2);
    expect(loadStoredCandles("IN:XNSE:INFY", "D").map((c) => c.close)).toEqual([1450, 1900]);
  });

  it("leaves ordinary weekday sessions untouched", () => {
    // The guard must not be a blunt instrument: a normal week has to survive it intact.
    const week = ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07"];
    const result = persistCandles(week.map((d, i) => daily("IN:XNSE:TCS", d, 3000 + i)));

    expect(result.inserted).toBe(5);
    expect(result.rejected).toBe(0);
  });

  it("catches a whole series stamped one day early", () => {
    // The shape of the real defect, rather than a single bad bar: a year of sessions shifted back
    // one day puts a bar on every Sunday, and no run of consecutive weekends can be a declared
    // special session. Even with the exceptions in place, the systematic fault cannot survive.
    const shifted: ReturnType<typeof daily>[] = [];
    const cursor = new Date(Date.UTC(2025, 5, 1));
    for (let i = 0; i < 200; i += 1) {
      const iso = cursor.toISOString().slice(0, 10);
      if (cursor.getUTCDay() !== 5 && cursor.getUTCDay() !== 6) {
        shifted.push(daily("IN:XNSE:SHIFTED", iso, 500)); // Mon-Thu sessions, plus every Sunday
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const sundays = shifted.filter((c) => new Date(c.time * 1000).getUTCDay() === 0).length;
    expect(sundays, "the fixture must actually contain the fault").toBeGreaterThan(20);

    const result = persistCandles(shifted);
    expect(result.rejected).toBe(sundays);
    expect(result.inserted).toBe(shifted.length - sundays);
  });

  it("does not apply the weekday rule to intraday resolutions", () => {
    // Only the daily series carries a calendar-day claim. An intraday bar is stamped at a real
    // instant, and a weekend-dated one is a different defect with a different remedy.
    const result = persistCandles([
      { ...daily("IN:XNSE:SBIN", "2024-11-03", 600), resolution: "5" },
    ]);
    expect(result.inserted).toBe(1);
  });
});
