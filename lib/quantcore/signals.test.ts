import { beforeEach, describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { getCapability, registerCapability, type CapabilityDescriptor } from "@/lib/brain/capability-registry";
import { subscribe } from "@/lib/brain/event-bus";
import { firedSignals, scanForSignals, type ScannableSpec } from "./signals";
import { useTemporaryDatabase } from "@/lib/db/testing";

// Signal scanning emits to the durable event ledger; this suite needs somewhere isolated to
// write it. (It already subscribes to the bus in-memory — that half never needed a database.)
useTemporaryDatabase();

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

  it("reports warm-up as a COUNTABLE data condition — barsHeld vs barsNeeded", () => {
    // sma200 on a 50-bar instrument: 50 held, 200 needed. The structured refusal makes the gap
    // resolvable (ingest ~150 more bars) rather than an opaque sentence.
    const sweep = firedSignals(
      [spec("draft", { entry: { feature: "sma200", op: "gt", value: 0 } })],
      { "US:XNAS:AAPL": bars(50) },
    );
    expect(sweep.warmups).toHaveLength(1);
    expect(sweep.warmups[0]).toMatchObject({
      instrumentId: "US:XNAS:AAPL",
      barsHeld: 50,
      barsNeeded: 200,
      timeGated: false, // a genuine DATA shortage — more history resolves it
    });
    // The human string carries the same numbers.
    expect(sweep.refusals.join(" ")).toContain("50/200 bars");
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

describe("the scanner is wired into the capability graph and the event bus", () => {
  beforeEach(() => {
    // Every test starts from the honest startup state: scanner.run registered but UNKNOWN.
    registerCapability({
      capabilityId: "scanner.run",
      name: "Market Scanner",
      domain: "scanner",
      description: "Signal scanner over universe",
      implementation: "lib/quantcore/signals.ts",
      health: "UNKNOWN",
      healthReason: "Requires quant core data",
      deterministic: true,
      requiresLLM: false,
      requiresMarketData: true,
      lastSuccessfulRun: null,
      lastFailure: null,
      metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
    } satisfies CapabilityDescriptor);
  });

  /** Health-change events only, narrowed out of the bus's full event union. */
  function collectHealthEvents(): { events: Array<{ capabilityId: string; health: string }>; stop: () => void } {
    const events: Array<{ capabilityId: string; health: string }> = [];
    const stop = subscribe("CAPABILITY_HEALTH_CHANGED", (event) => {
      if (event.kind !== "CAPABILITY_HEALTH_CHANGED") return;
      events.push({ capabilityId: event.capabilityId, health: event.health });
    });
    return { events, stop };
  }

  it("a real sweep flips scanner.run READY, records metrics, and emits CAPABILITY_HEALTH_CHANGED once", () => {
    const { events, stop } = collectHealthEvents();

    const scan = scanForSignals([spec("paper_challenger")], dataset);
    expect(scan.evaluated).toBeGreaterThan(0);

    const capability = getCapability("scanner.run")!;
    expect(capability.health).toBe("READY");
    expect(capability.healthReason).toMatch(/evaluated \d+ strategy × instrument pair/);
    expect(capability.metrics).toEqual({ totalRuns: 1, successfulRuns: 1, failedRuns: 0 });
    expect(capability.lastSuccessfulRun).not.toBeNull();
    expect(events).toEqual([{ capabilityId: "scanner.run", health: "READY" }]);
    stop();
  });

  it("an empty dataset changes nothing — no evidence is not a verdict", () => {
    const { events, stop } = collectHealthEvents();

    const scan = scanForSignals([spec("paper_challenger")], {});
    expect(scan.evaluated).toBe(0);

    // UNKNOWN is preserved deliberately: an unasked question is not a negative answer, and a
    // scanner that never had data must not be reported as broken.
    const capability = getCapability("scanner.run")!;
    expect(capability.health).toBe("UNKNOWN");
    expect(capability.metrics.totalRuns).toBe(0);
    expect(events).toEqual([]);
    stop();
  });

  it("data with nothing evaluable is DEGRADED, not silently healthy", () => {
    const { events, stop } = collectHealthEvents();

    // One bar: a crossover needs two, so the pair is refused and nothing is evaluated.
    const sweep = firedSignals([spec("paper_challenger")], { "US:XNAS:AAPL": bars(1) });
    expect(sweep.evaluated).toBe(0);
    expect(sweep.refusals.join(" ")).toMatch(/fewer than two bars/);

    const capability = getCapability("scanner.run")!;
    expect(capability.health).toBe("DEGRADED");
    expect(capability.healthReason).toMatch(/No strategy × instrument pair evaluable/);
    expect(capability.metrics.failedRuns).toBe(1);
    expect(events).toEqual([{ capabilityId: "scanner.run", health: "DEGRADED" }]);
    stop();
  });

  it("the board's own scan path records the same sweep (it never reported anything before)", () => {
    // lib/execution/board.ts calls firedSignals directly, bypassing scanForSignals — the path
    // that left the capability graph blind to every board scan the product ever ran.
    const sweep = firedSignals([spec("paper_challenger")], dataset);
    expect(sweep.evaluated).toBeGreaterThan(0);

    const capability = getCapability("scanner.run")!;
    expect(capability.health).toBe("READY");
    expect(capability.metrics.successfulRuns).toBe(1);
  });

  it("a repeated healthy sweep records the run but does not spam the event ledger", () => {
    scanForSignals([spec("paper_challenger")], dataset); // UNKNOWN → READY (emits)
    const { events, stop } = collectHealthEvents(); // subscribe AFTER the flip

    scanForSignals([spec("paper_challenger")], dataset);

    const capability = getCapability("scanner.run")!;
    expect(capability.health).toBe("READY");
    expect(capability.metrics.totalRuns).toBe(2); // the run is counted
    expect(events).toEqual([]); // the unchanged health is not an event
    stop();
  });
});
