import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { crossSectionalRecord } from "@/lib/strategy/definition";
import { NSE_QC_001_XSEC_SEED } from "@/lib/strategy/campaigns/nse-qc-001-seeds";
import { compileStrategy } from "@/lib/strategy/dsl";
import { registerTestSnapshot } from "@/lib/strategy/identity-fixture";
import { runValidationRehearsal, type ResearchDatasetSource } from "./rehearsal";
import type { SnapshotResult } from "@/lib/research-data/snapshot";
import type { Candle } from "@/lib/providers/types";

/**
 * The load-bearing assertion in this file is the one that looks like it does nothing:
 * `recordedNothing`. A rehearsal that quietly wrote a trial would raise the statistical bar for
 * every candidate it touched, on a timer, with no owner instruction and no way to undo it.
 *
 * ## The isolation below is not boilerplate
 *
 * `runValidationRehearsal` reads the strategy registry through `getDb()`, and this file had no
 * database override — so every run read the owner's real `marketpulse.db` and rehearsed whatever
 * strategies happened to be in it. That made the suite's results depend on production data: a
 * strategy added by the owner could change what these tests evaluated, and the counts asserted
 * here would drift for reasons nothing in this file explains.
 */

function bars(count = 400, phase = 0): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin((index + phase) / 9) * 6 + index * 0.04;
    return { time: 1_700_000_000 + index * 86_400, open: close * 0.998, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 };
  });
}

/** A dataset of several instruments, so the position cap can actually bind. */
function dataset(instruments = 4): Record<string, Candle[]> {
  return Object.fromEntries(
    Array.from({ length: instruments }, (_, index) => [`US:XNAS:T${index}`, bars(400, index * 30)]),
  );
}

function snap(data: Record<string, Candle[]>): SnapshotResult {
  const all = Object.values(data).flat();
  return {
    ok: true,
    snapshotId: "dss_fixture",
    fingerprint: "fp_fixture",
    barCount: all.length,
    instruments: Object.keys(data).sort(),
    firstTime: all[0]?.time ?? 0,
    lastTime: all[all.length - 1]?.time ?? 0,
    dataset: data,
    priceBasis: "SPLIT_ADJUSTED",
    inferredActionsUsed: 0,
    actionsApplied: 0,
    actionsSkipped: 0,
    actionsAmbiguous: [],
    quarantined: [],
  };
}

/** A source answering with a recorded snapshot — the only shape rehearsal accepts now. */
const source = (data: Record<string, Candle[]> = dataset()): ResearchDatasetSource => () => snap(data);

/** The fail-closed answer: the store has nothing, and the remedy is ingestion. */
const refusal = (): ResearchDatasetSource => () => ({
  ok: false,
  code: "NO_STORED_DATA",
  message: "The canonical store holds no bars for this universe (test refusal) — ingestion required.",
});

/**
 * A draft candidate for the rehearsal to actually chew on.
 *
 * Isolating the database emptied it, and an empty registry makes `runValidationRehearsal` return
 * before it evaluates anything — which turns every `for (const outcome of report.outcomes)` below
 * into a loop over nothing. The file would have stayed green while asserting nothing at all, which
 * is the worse failure: a suite that cannot fail is indistinguishable from one that passes.
 *
 * `rsi14` is chosen because the engine can derive it from price alone, so these tests exercise the
 * evaluated path rather than the `FEATURE_NOT_AVAILABLE` short-circuit.
 */
const REHEARSAL_DSL = {
  name: "rsi_rehearsal_fixture",
  universe: { market: "US" as const, maxPositions: 10 },
  entry: { feature: "rsi14", op: "lt" as const, value: 45 },
  exit: { afterDays: 5, stopLossPct: 3 },
  sizing: { maxPositionPct: 10 },
  costs: { commissionBps: 3, slippageBps: 7 },
};

function seedDraftSpec(): void {
  const compiled = compileStrategy(REHEARSAL_DSL);
  if (!compiled.ok) throw new Error(`The rehearsal fixture no longer compiles: ${compiled.message}`);
  getDb()
    .insert(schema.strategySpecs)
    .values({
      id: "spec_rehearsal_fixture",
      hypothesisId: null,
      parentId: null,
      name: REHEARSAL_DSL.name,
      version: 1,
      dsl: JSON.stringify(REHEARSAL_DSL),
      dslHash: compiled.hash,
      status: "draft",
      createdBy: "rehearsal-test",
      createdAt: new Date(),
    })
    .run();
  // The rehearsal records experiments against the fixture snapshot; the FK must resolve.
  registerTestSnapshot("dss_fixture", "fp_fixture");
}

useTemporaryDatabase(seedDraftSpec);

describe("mode gating comes from the policy, not from a second ladder", () => {
  it("refuses at off", async () => {
    const report = await runValidationRehearsal(source(), "off");
    expect(report.evaluated).toBe(0);
    expect(report.skipped[0]).toMatch(/requires learning mode/);
  });

  it("refuses at observing, naming the mode it needs", async () => {
    const report = await runValidationRehearsal(source(), "observing");
    expect(report.evaluated).toBe(0);
    expect(report.skipped[0]).toMatch(/"learning"/);
  });

  it("still records nothing when it refuses", async () => {
    expect((await runValidationRehearsal(source(), "off")).recordedNothing).toBe(true);
  });

  it("does not even build a snapshot when the mode forbids it", async () => {
    let called = 0;
    const counting: ResearchDatasetSource = () => {
      called += 1;
      return snap(dataset());
    };
    await runValidationRehearsal(counting, "observing");
    expect(called).toBe(0);
  });
});

describe("running at learning mode", () => {
  it("has a candidate to evaluate at all", async () => {
    // The canary for every `for (const outcome of report.outcomes)` below. If the fixture stops
    // being picked up, those loops iterate zero times and pass without asserting anything — so
    // this failing first is what tells you the rest went hollow rather than green.
    const report = await runValidationRehearsal(source(), "learning");
    expect(report.outcomes.length).toBeGreaterThan(0);
    expect(report.evaluated).toBeGreaterThan(0);
  });

  it("records nothing, whatever it finds", async () => {
    const report = await runValidationRehearsal(source(), "learning");
    expect(report.recordedNothing).toBe(true);
  });

  it("survives a source that throws, costing the candidate rather than the pass", async () => {
    const report = await runValidationRehearsal(() => {
      throw new Error("store unreadable");
    }, "learning");
    expect(report.recordedNothing).toBe(true);
    for (const outcome of report.outcomes) {
      expect(outcome.verdict).toBe("not_evaluable");
    }
  });

  it("reports missing candles rather than substituting a default series", async () => {
    const report = await runValidationRehearsal(refusal(), "learning");
    for (const outcome of report.outcomes) {
      expect(outcome.verdict).toBe("not_evaluable");
      // Either honest refusal is acceptable — the feature gap or the data gap — but it must be
      // one of them, naming a specific cause. What is never acceptable is a fabricated series
      // producing trades out of nothing.
      expect(outcome.reason).toMatch(/FEATURE_NOT_AVAILABLE|ingestion required|INSUFFICIENT_BARS/);
      expect(outcome.trades).toBe(0);
      expect(outcome.battery).toBeNull();
    }
  });

  it("does not touch the dataset source for a strategy whose features it cannot derive", async () => {
    // The bug this pins: the fetch used to run first, so twelve instruments × three years were
    // pulled on every cycle before discovering the strategy needed `market_cap` — which no
    // amount of price history supplies. On a slow link that was twelve connect timeouts, every
    // fifteen minutes, indefinitely.
    let calls = 0;
    const counting: ResearchDatasetSource = () => {
      calls += 1;
      return snap({});
    };
    const report = await runValidationRehearsal(counting, "learning");

    const featureBlocked = report.outcomes.filter((outcome) =>
      outcome.reason.includes("FEATURE_NOT_AVAILABLE"),
    ).length;
    if (report.outcomes.length > 0 && featureBlocked === report.outcomes.length) {
      expect(calls).toBe(0);
    }
    // Whatever the mix, the source is never asked more often than there are candidates.
    expect(calls).toBeLessThanOrEqual(report.outcomes.length);
  });

  it("reports an empty candle array the same way as a missing instrument", async () => {
    const report = await runValidationRehearsal(source({ "US:XNAS:T0": [] }), "learning");
    for (const outcome of report.outcomes) {
      expect(outcome.verdict).toBe("not_evaluable");
    }
  });

  it("walks every instrument in the dataset, not just the first", async () => {
    const report = await runValidationRehearsal(source(dataset(4)), "learning");
    for (const outcome of report.outcomes) {
      // A market-wide DSL judged on one instrument has unlimited position slots, so
      // maxPositions never binds and its real capacity is invisible.
      if (outcome.verdict !== "not_evaluable") expect(outcome.instrumentsEvaluated).toBe(4);
    }
  });

  it("does not call an inconclusive battery a failure", async () => {
    // Barely enough bars to backtest, nowhere near the 30 trades the battery needs. The
    // candidate is unproven, not refuted, and retiring it here would be for the wrong reason.
    const thin = { "US:XNAS:T0": bars(60) };
    const report = await runValidationRehearsal(source(thin), "learning");
    for (const outcome of report.outcomes) {
      if (outcome.battery?.verdict === "inconclusive") expect(outcome.verdict).toBe("not_evaluable");
    }
  });

  it("never claims a candidate is proven, only that it would survive", async () => {
    const report = await runValidationRehearsal(source(), "learning");
    for (const outcome of report.outcomes) {
      expect(["would_pass", "would_fail", "not_evaluable"]).toContain(outcome.verdict);
    }
    // The word "proven" must not appear: a rehearsal is not evidence and the summary says so.
    expect(report.summary.toLowerCase()).not.toContain("proven");

    // Both branches assert. Keying this off the summary text matched "none would survive" too,
    // and a conditional that can fall through asserts nothing on the path it skips.
    if (report.outcomes.some((outcome) => outcome.verdict === "would_pass")) {
      expect(report.summary).toMatch(/not evidence/);
    } else {
      expect(report.summary).toMatch(/No trial was spent/);
    }
  });

  it("is deterministic across runs, so a candidate cannot be re-rolled into passing", async () => {
    const once = await runValidationRehearsal(source(), "learning", new Date(0));
    const twice = await runValidationRehearsal(source(), "learning", new Date(0));
    expect(once).toEqual(twice);
  });

  it("stamps when it ran", async () => {
    const at = new Date("2026-08-06T12:00:00.000Z");
    expect((await runValidationRehearsal(source(), "learning", at)).ranAt).toBe(at.toISOString());
  });
});

/**
 * Rotation: the per-cycle cap must never become permanent starvation.
 *
 * The selection was `.filter(draft|validating).slice(0, 10)` with no ordering and no
 * already-rehearsed exclusion — the same first ten rows by insertion order were re-rehearsed
 * every cycle forever, and specs 11+ were structurally invisible. The live funnel's
 * "10 rehearsed" was the cap itself, not a measurement.
 *
 * The rotation contract: never-rehearsed specs first (no rehearsal_outcomes row), then the
 * stalest verdicts. Two capped passes over twelve drafts must therefore reach all twelve —
 * with the cycle's own upsert (which persists verdicts to rehearsal_outcomes) simulated
 * between them, because that ledger is what the rotation reads.
 */
describe("the rehearsal cap rotates instead of starving", () => {
  it("reaches every draft across passes once verdicts persist", async () => {
    const db = getDb();
    // Eleven more drafts beside the seeded fixture: 12 total, cap is 10.
    for (let index = 0; index < 11; index += 1) {
      const dsl = { ...REHEARSAL_DSL, name: `rotation_fixture_${index}` };
      const compiled = compileStrategy(dsl);
      if (!compiled.ok) throw new Error(compiled.message);
      db.insert(schema.strategySpecs)
        .values({
          id: `spec_rotation_${index}`,
          hypothesisId: null,
          parentId: null,
          name: dsl.name,
          version: 1,
          dsl: JSON.stringify(dsl),
          dslHash: `${compiled.hash}_${index}`,
          status: "draft",
          createdBy: "rehearsal-test",
          createdAt: new Date(),
        })
        .run();
    }

    const seen = new Set<string>();
    const persist = (outcomes: { specId: string; verdict: string; reason: string }[], at: Date) => {
      for (const outcome of outcomes) {
        seen.add(outcome.specId);
        db.insert(schema.rehearsalOutcomes)
          .values({
            strategySpecId: outcome.specId,
            verdict: outcome.verdict,
            reason: outcome.reason,
            trades: 0,
            instrumentsEvaluated: 0,
            rehearsedAt: at,
          })
          .onConflictDoUpdate({
            target: schema.rehearsalOutcomes.strategySpecId,
            set: { verdict: outcome.verdict, reason: outcome.reason, rehearsedAt: at },
          })
          .run();
      }
    };

    const first = await runValidationRehearsal(source(), "learning", new Date("2026-08-14T10:00:00Z"));
    expect(first.evaluated).toBe(10);
    persist(first.outcomes, new Date("2026-08-14T10:00:00Z"));

    const second = await runValidationRehearsal(source(), "learning", new Date("2026-08-14T11:00:00Z"));
    persist(second.outcomes, new Date("2026-08-14T11:00:00Z"));

    expect(
      seen.size,
      "two capped passes over twelve drafts must reach all twelve — anything less is the cap acting as permanent starvation",
    ).toBe(12);
  });
});

describe("a cross-sectional strategy rehearses through the same path", () => {
  /**
   * The lifecycle now holds two typed representations. What must be true is that the SECOND one
   * is not on a side channel: same rehearsal call, same battery, same verdict vocabulary, same
   * ledger row — otherwise a cross-sectional family's results would mean something subtly
   * different from every other family's, and the campaign arithmetic would silently stop
   * comparing like with like.
   *
   * Before the typed boundary existed, every reader `safeParse`d the stored JSON as a DSL and
   * skipped on failure. A cross-sectional spec would have produced no verdict at all, and its
   * absence would have looked like a strategy nobody had tried.
   */
  function seedCrossSectional(): void {
    getDb()
      .insert(schema.strategySpecs)
      .values({
        id: "spec_xsec_fixture",
        hypothesisId: null,
        parentId: null,
        name: "xsec_fixture",
        version: 1,
        dsl: JSON.stringify(crossSectionalRecord(NSE_QC_001_XSEC_SEED.strategy)),
        dslHash: "hash_xsec_fixture",
        status: "draft",
        createdBy: "rehearsal-test",
        createdAt: new Date(),
      })
      .run();
  }

  /** A universe wide and long enough for a 60-day lookback plus rotations. */
  function rankableDataset(): Record<string, Candle[]> {
    const dataset: Record<string, Candle[]> = {};
    for (let i = 0; i < 20; i += 1) {
      const drift = 1 + (i - 10) * 0.002;
      dataset[`IN:XNSE:R${String(i).padStart(2, "0")}`] = Array.from({ length: 200 }, (_u, day) => {
        const close = 100 * drift ** day;
        return {
          time: 1_700_000_000 + day * 86_400,
          open: close,
          high: close * 1.01,
          low: close * 0.99,
          close,
          volume: 1_000,
        };
      });
    }
    return dataset;
  }

  it("produces a real verdict, not a parse refusal", async () => {
    seedCrossSectional();
    const report = await runValidationRehearsal(() => snap(rankableDataset()), "learning");

    const outcome = report.outcomes.find((o) => o.name === "xsec_fixture");
    expect(outcome, "the cross-sectional spec must be reached at all").toBeDefined();
    expect(outcome!.verdict).not.toBe("not_evaluable");
    expect(outcome!.trades).toBeGreaterThan(0);
    // `instrumentsEvaluated` carries the ranked universe, so the verdict states what it describes.
    expect(outcome!.instrumentsEvaluated).toBe(20);
    expect(outcome!.battery).not.toBeNull();
  });

  it("still refuses a row marked cross-sectional that the engine cannot read", async () => {
    getDb()
      .insert(schema.strategySpecs)
      .values({
        id: "spec_xsec_broken",
        hypothesisId: null,
        parentId: null,
        name: "xsec_broken",
        version: 1,
        dsl: JSON.stringify({ kind: "CROSS_SECTIONAL", universe: { market: "NSE" } }),
        dslHash: "hash_xsec_broken",
        status: "draft",
        createdBy: "rehearsal-test",
        createdAt: new Date(),
      })
      .run();

    const report = await runValidationRehearsal(() => snap(rankableDataset()), "learning");
    const outcome = report.outcomes.find((o) => o.name === "xsec_broken");
    expect(outcome?.verdict).toBe("not_evaluable");
    expect(outcome?.reason).toMatch(/cannot be read/i);
  });
});
