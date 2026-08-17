import { describe, expect, it, vi } from "vitest";
import {
  EARLIEST_AVAILABLE,
  getUpstoxDailyHistory,
  instrumentKey,
  paginate,
  UpstoxRefusal,
  type UpstoxFetcher,
} from "./upstox";

/** A response in the shape Upstox actually returns: newest first, `[stamp, o, h, l, c, v, oi]`. */
function respond(candles: [string, number, number, number, number, number, number][]) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ status: "success", data: { candles } }),
  };
}

const day = (date: string, close: number) =>
  [`${date}T00:00:00+05:30`, close, close, close, close, 1_000, 0] as [
    string, number, number, number, number, number, number,
  ];

describe("instrumentKey", () => {
  it("builds the NSE equity key from an ISIN", () => {
    expect(instrumentKey("INE002A01018")).toBe("NSE_EQ|INE002A01018");
  });

  it("refuses anything that is not a well-formed Indian ISIN", () => {
    // A malformed key returns a 400 from the provider, which is a slower and less specific way to
    // learn the same thing.
    expect(() => instrumentKey("RELIANCE")).toThrow(UpstoxRefusal);
    expect(() => instrumentKey("US0378331005")).toThrow(/well-formed Indian ISIN/);
  });
});

describe("paginate", () => {
  it("splits a 26-year range into windows the provider will accept", () => {
    // A daily request much beyond a decade is refused with UDAPI1148 Invalid date range.
    const windows = paginate(EARLIEST_AVAILABLE, "2026-08-14");
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]!.from).toBe("2000-01-01");
    expect(windows.at(-1)!.to).toBe("2026-08-14");
    for (const w of windows) {
      const years = (Date.parse(w.to) - Date.parse(w.from)) / (365.25 * 86_400_000);
      expect(years).toBeLessThanOrEqual(10);
    }
  });

  it("covers the range with no gap and no overlap between windows", () => {
    const windows = paginate("2000-01-01", "2026-08-14");
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = Date.parse(windows[i - 1]!.to);
      const thisStart = Date.parse(windows[i]!.from);
      expect(thisStart - prevEnd).toBe(86_400_000); // exactly one day later
    }
  });

  it("returns a single window for a short range", () => {
    expect(paginate("2026-01-01", "2026-08-14")).toHaveLength(1);
  });
});

describe("getUpstoxDailyHistory", () => {
  const opts = { from: "2026-03-02", to: "2026-03-06" };

  it("converts Upstox midnight-IST stamps to the store's 09:15 IST session open", async () => {
    // The two conventions differ by 9h15m. Conflating them is how a series ends up on the wrong
    // clock, which this repository has already paid for once.
    const fetcher: UpstoxFetcher = async () => respond([day("2026-03-02", 100)]);
    const result = await getUpstoxDailyHistory("INE002A01018", { ...opts, fetcher });

    expect(result.candles).toHaveLength(1);
    // 2026-03-02 09:15 IST == 03:45 UTC
    expect(new Date(result.candles[0]!.time * 1000).toISOString()).toBe("2026-03-02T03:45:00.000Z");
  });

  it("returns candles oldest first regardless of provider ordering", async () => {
    const fetcher: UpstoxFetcher = async () =>
      respond([day("2026-03-06", 106), day("2026-03-04", 104), day("2026-03-02", 102)]);
    const result = await getUpstoxDailyHistory("INE002A01018", { ...opts, fetcher });
    expect(result.candles.map((c) => c.close)).toEqual([102, 104, 106]);
  });

  it("refuses a weekend-dated bar and says so rather than dropping it", async () => {
    // 2026-03-01 was a Sunday. A silently discarded bar is a gap nobody can later account for.
    const fetcher: UpstoxFetcher = async () =>
      respond([day("2026-03-02", 100), day("2026-03-01", 99)]);
    const result = await getUpstoxDailyHistory("INE002A01018", { ...opts, from: "2026-03-01", fetcher });

    expect(result.candles).toHaveLength(1);
    expect(result.rejected).toEqual([{ date: "2026-03-01", reason: "WEEKEND_DATE" }]);
  });

  it("refuses a bar whose open sits outside its own high and low", async () => {
    const fetcher: UpstoxFetcher = async () =>
      respond([["2026-03-02T00:00:00+05:30", 120, 110, 100, 105, 1_000, 0]]);
    const result = await getUpstoxDailyHistory("INE002A01018", { ...opts, fetcher });

    expect(result.candles).toHaveLength(0);
    expect(result.rejected).toEqual([{ date: "2026-03-02", reason: "INCOHERENT_OHLC" }]);
  });

  it("throws on an HTTP failure instead of returning a quietly short series", async () => {
    // A short series and a short listing history are indistinguishable downstream.
    const fetcher: UpstoxFetcher = async () => ({ ok: false, status: 503, text: async () => "" });
    await expect(getUpstoxDailyHistory("INE002A01018", { ...opts, fetcher })).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it("refuses to fetch at all when the purpose is not a permitted use", async () => {
    // The rights layer is consulted before the network is touched, not after.
    const fetcher = vi.fn();
    await expect(
      getUpstoxDailyHistory("INE002A01018", { ...opts, purpose: "REDISTRIBUTION" as never, fetcher }),
    ).rejects.toThrow(UpstoxRefusal);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("de-duplicates a bar appearing in two windows", async () => {
    const fetcher: UpstoxFetcher = async () => respond([day("2026-03-02", 100)]);
    const result = await getUpstoxDailyHistory("INE002A01018", {
      from: "2000-01-01",
      to: "2026-03-06",
      fetcher,
    });
    expect(result.windows).toBeGreaterThan(1);
    expect(result.candles).toHaveLength(1);
  });
});
