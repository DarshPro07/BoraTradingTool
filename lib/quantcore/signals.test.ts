import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { scanForSignals, type ScannableSpec } from "./signals";

/**
 * The board's candidate scan. The properties that matter are all about refusal:
 *
 *  - a warming-up feature is not "no signal"
 *  - a firing entry condition is not permission
 *  - an unrecognised strategy status is blocked, never widened
 *
 * A scanner that gets these wrong still produces a plausible board, which is exactly why they
 * are pinned here rather than left to inspection.
 */

function dsl(overrides: Record<string, unknown> = {}): StrategyDsl {
  return StrategyDslSchema.parse({
    name: "always_on",
    universe: { market: "US", maxPositions: 10 },
    // `close > 0` is true on every bar with data, so any absence of candidates in these tests is
    // a refusal rather than an unlucky market.
    entry: { feature: "close", op: "gt", value: 0 },
    exit: { afterDays: 5, stopLossPct: 3 },
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 3, slippageBps: 7 },
    ...overrides,
  });
}

function spec(status: string, overrides: Record<string, unknown> = {}): ScannableSpec {
  return { id: `spec_${status}`, name: `strategy_${status}`, status, dsl: dsl(overrides) };
}

function bars(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 7) * 5;
    return {
      time: 1_700_000_000 + index * 86_400,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    };
  });
}

const dataset = { "US:XNAS:AAPL": bars(300) };

describe("verdicts come from governance, not from the signal", () => {
  it("calls a gauntlet-passed strategy a paper candidate", () => {
    const scan = scanForSignals([spec("paper_challenger")], dataset);
    expect(scan.candidates).toHaveLength(1);
    expect(scan.candidates[0].verdict).toBe("PAPER_CANDIDATE");
    expect(scan.candidates[0].blockers).toEqual([]);
  });

  it("calls an untested strategy research-only and names what is missing", () => {
    const scan = scanForSignals([spec("draft")], dataset);
    expect(scan.candidates[0].verdict).toBe("RESEARCH_ONLY");
    expect(scan.candidates[0].blockers).toContain("gauntlet_not_passed");
  });

  it("blocks a rejected strategy even when its entry fires", () => {
    // A buried strategy still triggers on price. The signal is real; the permission is not.
    const scan = scanForSignals([spec("rejected")], dataset);
    expect(scan.candidates[0].verdict).toBe("BLOCKED");
    expect(scan.candidates[0].blockers).toContain("strategy_rejected");
  });

  it("blocks an unrecognised status rather than widening it", () => {
    // Fails closed, matching how the filesystem reader treats unknown verdicts from outside.
    const scan = scanForSignals([spec("some_future_status")], dataset);
    expect(scan.candidates[0].verdict).toBe("BLOCKED");
    expect(scan.candidates[0].blockers[0]).toMatch(/unrecognised_status/);
  });
});

describe("refusals are never reported as absence of signal", () => {
  it("refuses a strategy whose features price data cannot supply", () => {
    const scan = scanForSignals(
      [spec("draft", { entry: { feature: "market_cap", op: "gt", value: 0 } })],
      dataset,
    );
    expect(scan.candidates).toHaveLength(0);
    expect(scan.refusals.join(" ")).toMatch(/need market_cap, which price data cannot supply/);
    // Never evaluated, because the check happens before any panel is built — a strategy needing
    // market cap cannot be scanned however much price history arrives.
    expect(scan.evaluated).toBe(0);
  });

  it("reports one capability gap once, however many strategies share it", () => {
    // Three strategies needing market cap is one missing input, not three problems. Printed per
    // strategy it repeated every cycle forever, which is how a refusal list stops being read.
    const needsMarketCap = { entry: { feature: "market_cap", op: "gt", value: 0 } };
    const scan = scanForSignals(
      [
        { ...spec("draft", needsMarketCap), name: "gap_largecap_premarket" },
        { ...spec("draft", needsMarketCap), name: "gap_smallcap_premarket" },
        { ...spec("draft", needsMarketCap), name: "largecap_momentum" },
      ],
      dataset,
    );
    expect(scan.refusals).toHaveLength(1);
    expect(scan.refusals[0]).toMatch(/^3 strategies need market_cap/);
    // Named, not merely counted — a count alone cannot be acted on.
    expect(scan.refusals[0]).toContain("largecap_momentum");
  });

  it("refuses an instrument still inside the warm-up window", () => {
    const scan = scanForSignals(
      [spec("draft", { entry: { feature: "sma200", op: "gt", value: 0 } })],
      { "US:XNAS:AAPL": bars(50) },
    );
    expect(scan.candidates).toHaveLength(0);
    expect(scan.refusals.join(" ")).toMatch(/warm-up/);
  });

  it("refuses a single bar, because a crossover needs two", () => {
    const scan = scanForSignals([spec("draft")], { "US:XNAS:AAPL": bars(1) });
    expect(scan.refusals.join(" ")).toMatch(/fewer than two bars/);
  });

  it("reports an empty dataset as nothing evaluated, not as nothing found", () => {
    const scan = scanForSignals([spec("paper_challenger")], {});
    expect(scan.candidates).toEqual([]);
    expect(scan.evaluated).toBe(0);
  });
});

describe("what a candidate may claim", () => {
  it("never invents a score", () => {
    // An entry condition is a boolean. It carries no strength, and a fabricated score would be
    // ranked on by whoever reads the board.
    const scan = scanForSignals([spec("paper_challenger")], dataset);
    expect(scan.candidates[0].score).toBeNull();
  });

  it("only ever proposes long, because the engine models nothing else", () => {
    const scan = scanForSignals([spec("paper_challenger")], dataset);
    expect(scan.candidates[0].side).toBe("PAPER_LONG_CANDIDATE");
  });

  it("maps instrument ids to provider symbols", () => {
    const scan = scanForSignals([spec("draft")], dataset, () => "AAPL");
    expect(scan.candidates[0].symbol).toBe("AAPL");
  });

  it("ranks strongest first and stays stable across passes", () => {
    const specs = [spec("rejected"), spec("paper_challenger"), spec("draft")];
    const once = scanForSignals(specs, dataset);
    const twice = scanForSignals([...specs].reverse(), dataset);
    expect(once.candidates.map((candidate) => candidate.verdict)).toEqual([
      "PAPER_CANDIDATE",
      "RESEARCH_ONLY",
      "BLOCKED",
    ]);
    // Same ordering whatever order the strategies arrived in, so two boards can be diffed without
    // churn that means nothing.
    expect(twice.candidates).toEqual(once.candidates);
  });
});
