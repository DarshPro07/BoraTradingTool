import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { loadStoredCandles } from "./candle-store";
import {
  accumulateIntraday,
  accumulationDue,
  intradayDepth,
  markAccumulated,
  SETTLE_SECONDS,
} from "./intraday-accumulator";
import type { Instrument } from "./types";

/**
 * The fix for the intraday data problem, and the reason it works.
 *
 * `lib/learning/dataset.ts` states the constraint exactly: Yahoo serves ~60 days of intraday
 * history, an intraday strategy cannot be validated on 60 days, "and no amount of waiting fixes
 * it, because the window slides".
 *
 * True of any single fetch. False the moment something keeps what falls off the back. These tests
 * are about the two properties that make keeping safe: only settled bars are stored, and storing
 * twice does not duplicate.
 */

useTemporaryDatabase();

const NOW = 1_780_000_000;
const FIVE_MIN = 300;

const INSTRUMENT: Instrument = {
  id: "IN:XNSE:RELIANCE",
  market: "IN",
  exchange: "XNSE",
  symbol: "RELIANCE",
  providerSymbol: "RELIANCE.NS",
  name: "Reliance Industries",
} as Instrument;

/** Bars ending `agoSeconds` before NOW, walking backwards. */
function bars(count: number, agoSeconds: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    time: NOW - agoSeconds - index * FIVE_MIN,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000,
  }));
}

describe("keeping only what has settled", () => {
  it("stores bars from a session that has fully elapsed", async () => {
    const report = await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () =>
      bars(10, SETTLE_SECONDS + FIVE_MIN * 2),
    );
    expect(report.inserted).toBe(10);
  });

  it("refuses today's bars, however complete they look", async () => {
    // The forming bar is the obvious hazard; the whole current session is the real one. A bar
    // captured mid-session and revised upstream afterwards becomes a permanent disagreement
    // inside the store that nothing will ever reconcile.
    const report = await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () => bars(10, 0));
    expect(report.inserted).toBe(0);
    expect(report.results[0].unsettled).toBe(10);
  });

  it("measures settlement from the bar's close, not its open", async () => {
    // A bar that opened just outside the margin still closes inside it.
    const justInside = SETTLE_SECONDS - FIVE_MIN + 1;
    const report = await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () => [
      { time: NOW - justInside, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    ]);
    expect(report.results[0].unsettled).toBe(1);
  });

  it("drops a malformed bar rather than storing it as history", async () => {
    // Once in the store a bar is indistinguishable from history, and nothing downstream would
    // ever question it.
    const report = await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () => [
      { time: NOW - SETTLE_SECONDS - FIVE_MIN, open: 100, high: 90, low: 99, close: 100, volume: 1 },
    ]);
    expect(report.inserted).toBe(0);
  });
});

describe("accumulating across runs", () => {
  it("does not duplicate a bar it already holds", async () => {
    const settled = async () => bars(10, SETTLE_SECONDS + FIVE_MIN * 2);
    await accumulateIntraday([INSTRUMENT], ["5"], NOW, settled);
    const second = await accumulateIntraday([INSTRUMENT], ["5"], NOW, settled);

    expect(second.inserted).toBe(0);
    expect(second.results[0].skipped).toBe(10);
  });

  it("keeps bars that a later fetch's window no longer reaches", async () => {
    // The whole point. The first run captures old bars; by the second run the provider's window
    // has slid past them and returns only recent ones. The store keeps both.
    await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () => bars(5, SETTLE_SECONDS + 40 * 86_400));
    await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () => bars(5, SETTLE_SECONDS + FIVE_MIN));

    const held = loadStoredCandles(INSTRUMENT.id, "5", 0, NOW);
    expect(held.length).toBe(10);
  });

  it("reports depth beyond what any single fetch could return", async () => {
    await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () => [
      ...bars(2, SETTLE_SECONDS + 90 * 86_400),
      ...bars(2, SETTLE_SECONDS + FIVE_MIN),
    ]);

    const depth = intradayDepth().find((entry) => entry.instrumentId === INSTRUMENT.id);
    expect(depth?.spanDays).toBeGreaterThan(59);
    expect(depth?.beyondProvider).toBe(true);
  });
});

describe("running once a session, not once a cycle", () => {
  it("is due on a system that has never accumulated", () => {
    expect(accumulationDue(NOW)).toBe(true);
  });

  // `markAccumulated` stamps the marker through `recordAudit`, which uses the wall clock — so the
  // due-check is measured from real time, not from this file's fixture timestamp.
  const realNow = () => Math.floor(Date.now() / 1000);

  it("is not due again minutes later", async () => {
    // The cycle runs every fifteen minutes. 12 instruments × 3 resolutions is 36 requests, and 96
    // passes a day to learn nothing settled is the load that rate-limited the feed before.
    const report = await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () =>
      bars(2, SETTLE_SECONDS + 3_600),
    );
    markAccumulated(report);

    expect(accumulationDue(realNow() + 15 * 60)).toBe(false);
  });

  it("is due again the next session", async () => {
    const report = await accumulateIntraday([INSTRUMENT], ["5"], NOW, async () =>
      bars(2, SETTLE_SECONDS + 3_600),
    );
    markAccumulated(report);

    expect(accumulationDue(realNow() + 21 * 60 * 60)).toBe(true);
  });
});

describe("when a fetch fails", () => {
  it("records the failure and keeps going", async () => {
    // The window slides whether or not this run succeeded, so a failure is a day of history lost —
    // worth reporting, never worth aborting the pass for.
    const report = await accumulateIntraday([INSTRUMENT], ["5", "15"], NOW, async (_i, resolution) => {
      if (resolution === "5") throw new Error("provider rate limited");
      // An hour clear of the margin: these bars are fetched at 15-minute resolution, and
      // settlement is measured from a bar's *close*, so a 5-minute offset would leave the newest
      // one straddling the boundary.
      return bars(4, SETTLE_SECONDS + 3_600);
    });

    expect(report.failed).toBe(1);
    expect(report.inserted).toBe(4);
    expect(report.results.find((r) => r.resolution === "5")?.error).toMatch(/rate limited/);
  });
});
