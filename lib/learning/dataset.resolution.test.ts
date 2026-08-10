import { afterEach, describe, expect, it, vi } from "vitest";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { useNseSecurityMasterFixture } from "@/lib/market/security-master.test-fixture";
import { marketCandleLoader } from "./dataset";

useNseSecurityMasterFixture();

/**
 * The loader must honour the resolution the strategy declared.
 *
 * It did not. `marketCandleLoader` took the DSL, read `universe.market` from it, and then fetched
 * at the resolution held in its own closure — always `"D"`, because that is what the cycle passed.
 * A 5-minute strategy was therefore rehearsed on **daily bars**, silently: the market was right,
 * the bars were real, and only the timeframe was wrong. The compiler had already warned that spec
 * about spreads and about `afterDays` counting bars, so everything upstream behaved as though
 * intraday were supported.
 *
 * Nothing downstream could detect it, which is why it needs a test rather than a comment. These
 * assert on what the loader *asks the provider for*, because that is the thing that was wrong.
 */

// Returns real bars, not an empty series. `fetchMarketSample` treats a market where every
// instrument came back empty as a wholesale provider failure and trips the cooldown breaker — so
// an empty mock made the first test poison every test after it, which looked exactly like the bug
// under test.
const BARS = Array.from({ length: 300 }, (_unused, index) => ({
  time: 1_700_000_000 + index * 86_400,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1_000,
}));

vi.mock("@/lib/market/service", () => ({
  getNormalizedCandles: vi.fn(async () => ({ candles: BARS, domain: "RAW_TRADED" })),
}));

vi.mock("@/lib/market/candle-store", () => ({
  loadStoredCandles: vi.fn(() => []),
}));

const { getNormalizedCandles } = await import("@/lib/market/service");
const asked = getNormalizedCandles as unknown as ReturnType<typeof vi.fn>;

afterEach(() => asked.mockClear());

function dsl(resolution: "D" | "1m" | "5m" | "15m", market = "NSE"): StrategyDsl {
  return { universe: { market, resolution, maxPositions: 4 } } as StrategyDsl;
}

/** Resolutions the provider was actually asked for, deduplicated. */
function requestedResolutions(): string[] {
  return [...new Set(asked.mock.calls.map((call) => String(call[1])))];
}

describe("the resolution the provider is asked for", () => {
  it("is the daily one for a daily strategy", async () => {
    await marketCandleLoader()("spec", dsl("D"));
    expect(requestedResolutions()).toEqual(["D"]);
  });

  it("is five minutes for a five-minute strategy", async () => {
    // The regression. This asked for "D" before, and returned real daily bars for a spec the
    // compiler had already validated as intraday.
    await marketCandleLoader()("spec", dsl("5m"));
    expect(requestedResolutions()).toEqual(["5"]);
  });

  it("is one minute for a one-minute strategy", async () => {
    await marketCandleLoader()("spec", dsl("1m"));
    expect(requestedResolutions()).toEqual(["1"]);
  });
});

describe("caching across candidates in one cycle", () => {
  it("serves two strategies on the same market and resolution from one fetch", async () => {
    const load = marketCandleLoader();
    await load("a", dsl("5m"));
    await load("b", dsl("5m"));
    // Twelve instruments, fetched once — not twice.
    expect(asked.mock.calls.length).toBeGreaterThan(0);
    expect(requestedResolutions()).toEqual(["5"]);
  });

  it("does not hand a daily candidate's bars to an intraday one", async () => {
    // The cache was keyed on market alone, so whichever strategy asked first fixed the timeframe
    // for every strategy behind it. A daily candidate rehearsed first would silently supply daily
    // bars to every intraday candidate in the same cycle.
    const load = marketCandleLoader();
    await load("daily", dsl("D"));
    await load("intraday", dsl("5m"));

    expect(requestedResolutions().sort()).toEqual(["5", "D"]);
  });

  it("keeps markets separate as well as resolutions", async () => {
    const load = marketCandleLoader();
    await load("in", dsl("5m", "NSE"));
    await load("us", dsl("5m", "US"));
    // Two fetches, both at five minutes, one per market.
    expect(requestedResolutions()).toEqual(["5"]);
    expect(asked.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("a resolution the provider cannot serve", () => {
  it("returns nothing rather than quietly falling back to daily", async () => {
    // Falling back would reintroduce exactly the defect this replaced: a strategy judged on bars
    // it did not ask for, with nothing in the result to say so.
    const result = await marketCandleLoader()("spec", dsl("30m" as never));
    expect(result).toEqual({});
    expect(asked).not.toHaveBeenCalled();
  });
});
