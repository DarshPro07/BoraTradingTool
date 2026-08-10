import { describe, expect, it } from "vitest";
import { buildPreMarketReport } from "./report";
import type { Instrument, NormalizedQuote } from "@/lib/market/types";
import { useNseSecurityMasterFixture } from "@/lib/market/security-master.test-fixture";

useNseSecurityMasterFixture();

/**
 * The contract under test is not "does it fetch quotes" — it is what happens when a quote does
 * not arrive. A pre-market report that quietly drops a failed instrument reads exactly like one
 * where that instrument did not move, and those are opposite facts.
 */

/** 2026-08-06 is a Thursday. 16:00 IST is after the Indian close, 06:30 ET is US pre-market. */
const AFTER_IN_CLOSE = new Date(Date.UTC(2026, 7, 6, 10, 30));

function quote(instrument: Instrument, price: number, changePct: number | null): NormalizedQuote {
  return {
    instrument,
    price,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    change: 0,
    changePct,
    volume: 1_000,
    currency: instrument.currency,
    provenance: {
      provider: "TEST_FIXTURE",
      sourceEventAt: null,
      ingestedAt: AFTER_IN_CLOSE.toISOString(),
      quality: "LIVE",
      delayedBySeconds: 0,
      sourceId: `test:${instrument.id}`,
    },
  };
}

/** Alternating gaps of growing size, so ordering by magnitude is observable rather than assumed. */
function gapsBySequence(): (instrument: Instrument, index: number) => Promise<NormalizedQuote> {
  return async (instrument, index) => quote(instrument, 100, (index % 2 === 0 ? 1 : -1) * index * 0.5);
}

/** Wraps a per-index fetcher so the report's own `Instrument => Promise` shape is preserved. */
function fetcher(byIndex: (instrument: Instrument, index: number) => Promise<NormalizedQuote>) {
  let index = -1;
  return (instrument: Instrument) => {
    index += 1;
    return byIndex(instrument, index);
  };
}

describe("gap ranking", () => {
  it("ranks by the size of the move, not its direction", async () => {
    const report = await buildPreMarketReport("IN", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    const magnitudes = report.gaps.map((row) => Math.abs(row.gapPct));
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
    // A large decline must outrank a small advance — a screen sorted by signed value buries
    // exactly the instrument a pre-market reader is looking for.
    expect(Math.abs(report.gaps[0].gapPct)).toBeGreaterThan(Math.abs(report.gaps.at(-1)!.gapPct));
  });

  it("counts breadth from the quotes that actually arrived", async () => {
    const report = await buildPreMarketReport("IN", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    const { advancing, declining, unchanged } = report.breadth;
    expect(advancing + declining + unchanged).toBe(report.gaps.length);
    expect(advancing).toBeGreaterThan(0);
    expect(declining).toBeGreaterThan(0);
  });
});

describe("missing is not zero", () => {
  it("a provider failure costs that instrument's row, not the report", async () => {
    const report = await buildPreMarketReport(
      "IN",
      AFTER_IN_CLOSE,
      fetcher(async (instrument, index) => {
        if (index < 3) throw new Error("provider timed out");
        return quote(instrument, 100, 1);
      }),
    );
    expect(report.missingQuotes).toHaveLength(3);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it("drops a zero price instead of ranking it as a free stock", async () => {
    const report = await buildPreMarketReport(
      "IN",
      AFTER_IN_CLOSE,
      fetcher(async (instrument, index) => quote(instrument, index === 0 ? 0 : 100, -9)),
    );
    expect(report.missingQuotes).toHaveLength(1);
    expect(report.gaps.every((row) => row.price > 0)).toBe(true);
  });

  it("survives every quote failing, and says so rather than reporting a flat market", async () => {
    const report = await buildPreMarketReport(
      "IN",
      AFTER_IN_CLOSE,
      fetcher(async () => {
        throw new Error("provider down");
      }),
    );
    expect(report.gaps).toHaveLength(0);
    expect(report.missingQuotes.length).toBeGreaterThan(0);
    // The dangerous failure: zero gaps reading as zero movement.
    expect(report.breadth.advancing + report.breadth.declining).toBe(0);
    expect(report.breadth.medianGapPct).toBe(0);
  });
});

describe("what the deployment cannot see", () => {
  it("lists the refusals that belong to this market, and not the other one's", async () => {
    const india = await buildPreMarketReport("IN", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    const us = await buildPreMarketReport("US", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    const inputs = (report: { unavailable: readonly { input: string }[] }) =>
      report.unavailable.map((entry) => entry.input).join(" | ");

    expect(inputs(india)).toMatch(/F&O ban list/);
    expect(inputs(india)).not.toMatch(/LULD/);
    expect(inputs(us)).toMatch(/LULD/);
    expect(inputs(us)).not.toMatch(/F&O ban list/);
    // Scheduled earnings are unavailable in both markets, so both must carry it.
    expect(inputs(india)).toMatch(/earnings/);
    expect(inputs(us)).toMatch(/earnings/);
  });

  it("gives a reason for every refusal, never a bare absence", async () => {
    const report = await buildPreMarketReport("IN", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    expect(report.unavailable.length).toBeGreaterThan(0);
    for (const entry of report.unavailable) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("counts the refusals in the caveat so the number cannot drift from the list", async () => {
    const report = await buildPreMarketReport("IN", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    expect(report.caveat).toContain(`${report.unavailable.length} pre-market input(s)`);
  });
});

describe("the caveat matches the session", () => {
  it("calls the moves intraday while the session is open", async () => {
    // 10:00 IST on the same Thursday: India is in continuous trading.
    const open = new Date(Date.UTC(2026, 7, 6, 4, 30));
    const report = await buildPreMarketReport("IN", open, fetcher(gapsBySequence()));
    expect(report.phase.phase).toBe("REGULAR");
    expect(report.caveat).toMatch(/intraday, not overnight gaps/);
  });

  it("calls it an overnight-move summary once the session is shut", async () => {
    const report = await buildPreMarketReport("IN", AFTER_IN_CLOSE, fetcher(gapsBySequence()));
    expect(report.phase.phase).toBe("CLOSED");
    expect(report.caveat).toMatch(/not a complete pre-market picture/);
  });
});
