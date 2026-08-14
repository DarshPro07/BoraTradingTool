import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { subscribeAll, type MarketPulseEvent } from "@/lib/brain/event-bus";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { enqueue } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { archiveForecast, pendingForecasts } from "./live";
import { lastResolverRun, registerForecastResolver, resolveMaturedForecasts } from "./resolver";

/**
 * The Forecast Resolver — "new bar → find matured predictions → resolve", with no owner action
 * and no learning cycle.
 *
 * Three links, each proven separately so a break names itself:
 *   1. grading works from the CANONICAL STORE alone (no provider, no network);
 *   2. ingestion PUBLISHES the wake signal (DATA_INGESTED with the real instrument);
 *   3. the signal WAKES grading — the full chain, end to end, without `runLearningCycle`.
 */

let previousTestMode: string | undefined;
let root: string;

beforeAll(() => {
  previousTestMode = process.env.MARKETPULSE_TEST_MODE;
  process.env.MARKETPULSE_TEST_MODE = "1";
});

afterAll(() => {
  if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
  else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
});

describe("forecast resolver", () => {
  useTemporaryDatabase();

  let disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers) dispose();
    disposers = [];
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Ingest RELIANCE through the durable queue and return its stored daily bars. */
  async function ingestReliance(): Promise<readonly { time: number; close: number }[]> {
    enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:RELIANCE" } });
    const drained = await runWorker("forecast-resolver-test", 5);
    expect(drained.succeeded, "precondition: fixture ingestion must succeed").toBeGreaterThanOrEqual(1);
    const bars = loadStoredCandles("IN:XNSE:RELIANCE", "D");
    expect(bars.length).toBeGreaterThan(0);
    return bars;
  }

  /** Archive one forecast whose only bar is already resolvable by the store. */
  function archiveMaturedForecast(bars: readonly { time: number; close: number }[]): void {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-forecast-resolver-"));
    const target = bars[bars.length - 1];
    archiveForecast(
      {
        instrumentId: "IN:XNSE:RELIANCE",
        timeframe: "D",
        // Written strictly before the bar it predicts, so the scorer's lookahead guard passes —
        // the structural property that makes forecast evidence unbiased.
        generatedAt: new Date(target.time * 1000 - 60_000).toISOString(),
        bars: [{ time: target.time, close: target.close * 1.01 }],
      },
      root,
    );
    expect(pendingForecasts(root).length).toBe(1);
  }

  it("grades a matured forecast from the canonical store alone — no provider call anywhere", async () => {
    const bars = await ingestReliance();
    archiveMaturedForecast(bars);

    const report = await resolveMaturedForecasts(root);
    expect(report.scored, "the store already holds the resolving bar; grading must not wait for a cycle").toBe(1);
    expect(pendingForecasts(root).length).toBe(0);
  });

  it("ingestion publishes DATA_INGESTED for the real instrument — the wake signal exists", async () => {
    const seen: MarketPulseEvent[] = [];
    const unsubscribe = subscribeAll((event) => seen.push(event));
    disposers.push(unsubscribe);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-forecast-resolver-"));

    await ingestReliance();

    const ingested = seen.filter(
      (event): event is Extract<MarketPulseEvent, { kind: "DATA_INGESTED" }> => event.kind === "DATA_INGESTED",
    );
    expect(ingested.length, "persisting canonical bars must announce itself").toBeGreaterThanOrEqual(1);
    expect(ingested[0].instrumentId).toBe("IN:XNSE:RELIANCE");
    expect(ingested[0].bars).toBeGreaterThan(0);
  });

  it("registering twice reuses the live registration — no stacked subscribers", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-forecast-resolver-"));
    const first = registerForecastResolver(root);
    const second = registerForecastResolver(root);
    // Identity, not equivalence: a second SUBSCRIPTION would need its own disposer, so the same
    // function coming back is direct proof nothing was stacked.
    expect(second).toBe(first);

    first();
    const third = registerForecastResolver(root);
    expect(third, "after disposal, registration must be possible again").not.toBe(first);
    third();
  });

  it("the full chain: bar arrival wakes grading with no cycle and no owner", async () => {
    // A matured RELIANCE forecast is pending, and the resolver is listening.
    const bars = await ingestReliance();
    archiveMaturedForecast(bars);
    disposers.push(registerForecastResolver(root));

    // A DIFFERENT instrument's history lands. Its DATA_INGESTED event is the only trigger here —
    // no runLearningCycle, no manual resolve call.
    enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:TCS" }, maxAttempts: 1 });
    await runWorker("forecast-resolver-test", 5);

    const woke = lastResolverRun();
    expect(woke, "the subscriber must have fired").not.toBeNull();
    await woke;

    expect(pendingForecasts(root).length, "the matured prediction resolved on bar arrival").toBe(0);
  });
});
