import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { subscribeAll, type MarketPulseEvent } from "@/lib/brain/event-bus";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { persistCandles } from "@/lib/market/candle-store";
import { StrategyDslSchema } from "@/lib/strategy/dsl";
import type { ImportedCandle } from "@/lib/market/dataset-import";
import { enqueue, enqueueDependent, getJob } from "./queue";
import { runWorker } from "./worker";

/**
 * The continuous chain — candidate → backtest → dependent job wakes, with no owner clicking Next.
 *
 * The owner's target: "dependency → job → result → event → dependent wake", proven at the seam
 * that matters (a backtest job's success automatically making a dependent job claimable). Built
 * on the SAFE half of the chain: `backtest` is a READ capability that spends nothing irreversible.
 * The `validation` link (which spends a permanent trial) is proven to refuse-without-spending
 * unless double-gated, so this chain can never manufacture a green result by burning trial budget.
 */

let previousTestMode: string | undefined;
const INSTRUMENT = "IN:XNSE:RELIANCE";

beforeAll(() => {
  previousTestMode = process.env.MARKETPULSE_TEST_MODE;
  process.env.MARKETPULSE_TEST_MODE = "1";
});

afterAll(() => {
  if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
  else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
});

/** A deterministic 5-minute NSE series long enough for the portfolio engine's MIN_BARS. */
function seedCandles(count = 120): void {
  const base = Math.floor(Date.parse("2026-01-01T03:45:00Z") / 1000);
  const candles: ImportedCandle[] = [];
  for (let index = 0; index < count; index += 1) {
    const price = 100 + Math.sin(index / 6) * 5 + index * 0.05;
    candles.push({
      ticker: INSTRUMENT,
      resolution: "5",
      time: base + index * 300,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price + 0.5,
      volume: 10_000,
    });
  }
  persistCandles(candles);
}

/** An intraday spec the owner's ₹1,000 can actually trade. */
function seedSpec(name = "chain_probe"): string {
  const dsl = StrategyDslSchema.parse({
    name,
    universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
    entry: { feature: "close", op: "gt", value: 0 },
    exit: { stopLossPct: 0.5, takeProfitPct: 1 },
    sizing: { maxPositionPct: 25 },
    costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
  });
  return recordStrategySpec({ name, dsl, createdBy: "test" });
}

describe("the continuous chain", () => {
  useTemporaryDatabase();

  it("a backtest job runs, persists an experiment, and emits BACKTEST_COMPLETED with the REAL specId", async () => {
    seedCandles();
    const specId = seedSpec();

    const seen: MarketPulseEvent[] = [];
    const unsubscribe = subscribeAll((event) => seen.push(event));
    try {
      enqueue({ kind: "backtest", payload: { specId } });
      const drained = await runWorker("chain-test", 5);
      expect(drained.succeeded).toBeGreaterThanOrEqual(1);
    } finally {
      unsubscribe();
    }

    const completed = seen.filter(
      (event): event is Extract<MarketPulseEvent, { kind: "BACKTEST_COMPLETED" }> => event.kind === "BACKTEST_COMPLETED",
    );
    expect(completed.length).toBeGreaterThanOrEqual(1);
    // The whole reason the job re-emits: the engine's own event says specId "unknown", which
    // could never wake a spec-scoped dependent.
    expect(completed[0].specId, "the dependent link needs the real spec identity").toBe(specId);

    const experiments = getDb().select().from(schema.experiments).where(eq(schema.experiments.strategySpecId, specId)).all();
    expect(experiments.length, "the backtest persisted a reproducible experiment").toBeGreaterThanOrEqual(1);
  });

  it("a dependent job WAKES the instant its backtest succeeds — no owner, no poll", async () => {
    seedCandles();
    const specId = seedSpec("chain_dependent");

    const backtest = enqueue({ kind: "backtest", payload: { specId } });
    // memory_validate stands in for the safe dependent — the point under test is the WAKE seam
    // (waiting_dependency → queued on the parent's success), not what the dependent does.
    const dependent = enqueueDependent({ kind: "memory_validate", payload: {} }, [backtest.id]);
    expect(dependent.blocked).toBe(false);

    // Before the backtest runs, the dependent is intentionally paused, not claimable.
    expect(getJob(dependent.id)?.status).toBe("waiting_dependency");

    // One drain sweep: the backtest succeeds, `unblockDependents` flips the dependent to queued,
    // and the same sweep (maxJobs > 1) claims and runs it. No second trigger, no owner.
    const drained = await runWorker("chain-test", 5);
    expect(drained.succeeded).toBeGreaterThanOrEqual(2);

    expect(getJob(backtest.id)?.status).toBe("succeeded");
    expect(getJob(dependent.id)?.status, "the dependent woke and ran on the parent's success alone").toBe("succeeded");
  });
});

describe("the validation link cannot spend a trial by accident", () => {
  useTemporaryDatabase();

  it("refuses an unconfirmed validation job — a permanent trial is never a default", async () => {
    const specId = seedSpec();
    const { id } = enqueue({ kind: "validation", payload: { specId }, maxAttempts: 1 });
    const drained = await runWorker("chain-test", 5);
    expect(drained.succeeded).toBe(0);

    const job = getJob(id);
    expect(job?.status).toBe("dead");
    expect(job?.lastError).toContain("VALIDATION_UNCONFIRMED");

    // The guardrail's whole purpose: nothing was spent finding this out.
    expect(getDb().select().from(schema.trials).all().length, "no trial may be spent by a refused job").toBe(0);
  });
});
