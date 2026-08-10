import { describe, expect, it, vi } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import type { Candle } from "@/lib/providers/types";
import { PriceDomainError } from "./price-domain";
import { ContractMasterError, type InstrumentSnapshot } from "./contract-master";
import { HOLDOUT, LoaderError, loadBars } from "./loader";

/**
 * The one door every strategy goes through.
 *
 * `price-domain.ts` and `contract-master.ts` were both built and tested, and a grep showed that
 * *nothing imported either of them* while eight production modules still read
 * `INSTRUMENT_CATALOG` directly. A guard nothing calls is documentation. This loader is the seam
 * that makes them bind, and it adds the one control neither of them covers: the holdout boundary.
 *
 * Four refusals, in priority order — domain, as-of, universe, holdout.
 */

// The default audit sink writes to `audit_events`. A no-op stub would leave the production path
// — the one that records holdout crossings — never exercised by any test.
useTemporaryDatabase();

const DAY = 86_400;
const JAN_1_2024 = Math.floor(Date.parse("2024-01-01T00:00:00Z") / 1000);

function bars(count: number, from = JAN_1_2024): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: from + i * DAY,
    open: 100 + i,
    high: 102 + i,
    low: 98 + i,
    close: 100 + i,
    volume: 1_000,
  }));
}

const NIFTY = "NSE_FO|NIFTY24MARFUT";

const SNAPSHOTS: InstrumentSnapshot[] = [
  {
    observedAt: "2023-12-01",
    instrumentKey: NIFTY,
    tradingSymbol: "NIFTY24MARFUT",
    underlying: "NIFTY",
    exchange: "NSE",
    segment: "FO",
    instrumentType: "FUTURES",
    lotSize: 50,
    tickSize: 0.05,
    listingStatus: "LISTED",
    expiry: "2030-03-28",
  },
];

/** 400 daily bars from 2024-01-01, so the series crosses any plausible holdout boundary. */
const SOURCE = () => bars(400);

function request(overrides: Record<string, unknown> = {}) {
  return {
    instruments: [NIFTY],
    start: new Date("2024-01-01T00:00:00Z"),
    end: new Date("2025-12-31T00:00:00Z"),
    purpose: "POINT_SIGNAL" as const,
    priceDomain: "RAW_TRADED" as const,
    snapshots: SNAPSHOTS,
    source: SOURCE,
    ...overrides,
  };
}

describe("the domain gate", () => {
  it("refuses execution simulation on an adjusted series", () => {
    expect(() =>
      loadBars(request({ purpose: "EXECUTION_SIM", priceDomain: "CONTINUOUS_ADDITIVE" })),
    ).toThrow(PriceDomainError);
  });

  it("permits point geometry on an additive series", () => {
    const result = loadBars(request({ priceDomain: "CONTINUOUS_ADDITIVE" }));
    expect(result.frames[0].domain).toBe("CONTINUOUS_ADDITIVE");
  });

  it("attaches the domain to every frame it returns", () => {
    // The domain travels with the data. A bare Candle[] loses it, and the next function to touch
    // it has no way to know what it is holding.
    const result = loadBars(request());
    expect(result.frames.every((frame) => frame.domain === "RAW_TRADED")).toBe(true);
  });
});

describe("the as-of gate", () => {
  it("drops every bar after as-of", () => {
    const asOf = new Date("2024-02-01T00:00:00Z");
    const result = loadBars(request({ asOf }));
    const latest = Math.max(...result.frames[0].bars.map((bar) => bar.time));
    expect(latest * 1000).toBeLessThanOrEqual(asOf.getTime());
  });

  it("defaults as-of to the end of the requested range", () => {
    const result = loadBars(request({ end: new Date("2024-03-01T00:00:00Z") }));
    const latest = Math.max(...result.frames[0].bars.map((bar) => bar.time));
    expect(latest * 1000).toBeLessThanOrEqual(Date.parse("2024-03-01T00:00:00Z"));
  });

  it("clamps a source that hands back future bars instead of trusting it", () => {
    // Defence in depth. The supplier is not the authority on what was knowable — if a parquet
    // file or a provider returns more than it was asked for, the leak stops here.
    const leaky = () => bars(400, JAN_1_2024);
    const result = loadBars(request({ asOf: new Date("2024-01-10T00:00:00Z"), source: leaky }));
    expect(result.frames[0].bars).toHaveLength(10);
  });
});

describe("the holdout firewall", () => {
  it("excludes the holdout by default", () => {
    const result = loadBars(request());
    const latest = Math.max(...result.frames[0].bars.map((bar) => bar.time));
    expect(latest * 1000).toBeLessThan(Date.parse(HOLDOUT.start));
    expect(result.holdout.included).toBe(false);
  });

  it("refuses an override with no stated reason", () => {
    // "Just show me the holdout average" is a holdout access. Requiring a reason is what makes
    // the ledger entry mean something later.
    expect(() => loadBars(request({ includeHoldout: true }))).toThrow(LoaderError);
    expect(() => loadBars(request({ includeHoldout: true }))).toThrow(/reason/i);
  });

  it("permits an override that states a reason", () => {
    const result = loadBars(
      request({ includeHoldout: true, holdoutReason: "FINAL_MAJOR_VERSION_EVALUATION" }),
    );
    expect(result.holdout.included).toBe(true);
    const latest = Math.max(...result.frames[0].bars.map((bar) => bar.time));
    expect(latest * 1000).toBeGreaterThan(Date.parse(HOLDOUT.start));
  });

  it("logs every override through the audit sink", () => {
    const audit = vi.fn();
    loadBars(
      request({ includeHoldout: true, holdoutReason: "FINAL_MAJOR_VERSION_EVALUATION", audit }),
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toMatchObject({
      reason: "FINAL_MAJOR_VERSION_EVALUATION",
      purpose: "POINT_SIGNAL",
    });
  });

  it("does not log when the holdout was never crossed", () => {
    const audit = vi.fn();
    loadBars(request({ audit }));
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("the universe gate", () => {
  it("refuses an instrument that was not in the point-in-time universe", () => {
    // Silently returning no bars would read as "this instrument did not trade", which is a
    // different claim from "it did not exist yet".
    expect(() =>
      loadBars(request({ instruments: ["NSE_EQ|GHOST"], asOf: new Date("2024-06-01T00:00:00Z") })),
    ).toThrow(ContractMasterError);
  });

  it("refuses a date earlier than the instrument archive reaches", () => {
    expect(() =>
      loadBars(request({ start: new Date("2020-01-01T00:00:00Z"), asOf: new Date("2020-06-01T00:00:00Z") })),
    ).toThrow(ContractMasterError);
  });

  it("carries point-in-time lot and tick size onto the frame", () => {
    const result = loadBars(request({ asOf: new Date("2024-06-01T00:00:00Z") }));
    expect(result.frames[0].lotSize).toBe(50);
    expect(result.frames[0].tickSize).toBe(0.05);
  });
});

describe("what the loader reports about itself", () => {
  it("states the as-of and holdout boundary it actually applied", () => {
    const result = loadBars(request({ asOf: new Date("2024-06-01T00:00:00Z") }));
    expect(result.asOf.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(result.holdout.boundary).toBe(HOLDOUT.start);
  });

  it("reports an instrument with no bars as a refusal, not an empty frame", () => {
    const result = loadBars(request({ source: () => [] }));
    expect(result.frames).toHaveLength(0);
    expect(result.refusals.join(" ")).toMatch(/no bars/i);
  });
});
