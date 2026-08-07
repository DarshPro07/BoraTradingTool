import { describe, expect, it } from "vitest";
import { DEFAULTS, MAX_HORIZON_BARS, buildForecastManifest, wasLookbackClamped } from "./manifest";
import { KRONOS_CHECKPOINTS } from "./kronos";

const AAPL = { id: "US:AAPL", providerSymbol: "AAPL" };
const MSFT = { id: "US:MSFT", providerSymbol: "MSFT" };
const AT = new Date("2026-08-06T13:00:00.000Z");

describe("context window is enforced at request time", () => {
  it("clamps a lookback larger than the checkpoint can attend to", () => {
    // Kronos-small has a 512-token context. Asking for 2000 and getting 2000 back in the
    // manifest would describe a forecast the model is incapable of making.
    const manifest = buildForecastManifest([AAPL], { checkpoint: "Kronos-small", lookbackBars: 2000, now: AT });
    expect(manifest.requests[0].lookbackBars).toBe(KRONOS_CHECKPOINTS["Kronos-small"].contextLength);
  });

  it("leaves a lookback within the window alone", () => {
    const manifest = buildForecastManifest([AAPL], { checkpoint: "Kronos-mini", lookbackBars: 1024, now: AT });
    expect(manifest.requests[0].lookbackBars).toBe(1024);
  });

  it("says whether the clamp happened, so the caller is not misled by a quiet success", () => {
    expect(wasLookbackClamped({ checkpoint: "Kronos-small", lookbackBars: 2000 })).toBe(true);
    expect(wasLookbackClamped({ checkpoint: "Kronos-mini", lookbackBars: 2000 })).toBe(false);
  });

  it("defaults to the checkpoint whose window suits daily bars", () => {
    const manifest = buildForecastManifest([AAPL], { now: AT });
    expect(manifest.requests[0].checkpoint).toBe("Kronos-mini");
    expect(DEFAULTS.lookbackBars).toBeLessThanOrEqual(KRONOS_CHECKPOINTS["Kronos-mini"].contextLength);
  });
});

describe("horizon", () => {
  it("rejects a horizon past the point where bars are generated from generated bars", () => {
    const manifest = buildForecastManifest([AAPL], { horizonBars: MAX_HORIZON_BARS + 1, now: AT });
    expect(manifest.requests).toHaveLength(0);
    expect(manifest.rejected[0].reason).toMatch(/compounds/);
  });

  it("rejects a zero horizon rather than emitting a job that forecasts nothing", () => {
    expect(buildForecastManifest([AAPL], { horizonBars: 0, now: AT }).requests).toHaveLength(0);
  });

  it("accepts the boundary", () => {
    expect(buildForecastManifest([AAPL], { horizonBars: MAX_HORIZON_BARS, now: AT }).requests).toHaveLength(1);
  });
});

describe("rejections are listed, never dropped", () => {
  it("rejects an instrument with no provider symbol", () => {
    const manifest = buildForecastManifest([AAPL, { id: "US:GHOST", providerSymbol: "  " }], { now: AT });
    expect(manifest.requests).toHaveLength(1);
    expect(manifest.rejected).toHaveLength(1);
    expect(manifest.rejected[0].instrumentId).toBe("US:GHOST");
  });

  it("rejects a duplicate instead of asking the runner for it twice", () => {
    const manifest = buildForecastManifest([AAPL, MSFT, AAPL], { now: AT });
    expect(manifest.requests.map((request) => request.instrumentId)).toEqual(["US:AAPL", "US:MSFT"]);
    expect(manifest.rejected[0].reason).toMatch(/Duplicate/);
  });

  it("every instrument is accounted for as either requested or rejected", () => {
    const input = [AAPL, MSFT, { id: "US:GHOST", providerSymbol: "" }, AAPL];
    const manifest = buildForecastManifest(input, { now: AT });
    expect(manifest.requests.length + manifest.rejected.length).toBe(input.length);
  });
});

describe("the manifest names where output goes", () => {
  it("points at the directory the reader looks in", () => {
    const manifest = buildForecastManifest([AAPL], { now: AT });
    expect(manifest.outputDir).toBe("data/forecasts/kronos");
    expect(manifest.version).toBe(1);
    expect(manifest.createdAt).toBe(AT.toISOString());
  });

  it("produces an empty manifest for an empty universe rather than failing", () => {
    const manifest = buildForecastManifest([], { now: AT });
    expect(manifest.requests).toHaveLength(0);
    expect(manifest.rejected).toHaveLength(0);
  });
});
