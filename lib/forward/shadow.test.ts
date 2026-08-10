import fs from "node:fs";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { persistCandles } from "@/lib/market/candle-store";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { placeInTestFamily, registerTestSnapshot } from "@/lib/strategy/identity-fixture";
import { recordExperiment } from "@/lib/research-data/snapshot";
import { COMPILER_VERSION, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { activateChallenger, deriveForwardPolicy, forwardScorecard, runShadowPass } from "./shadow";

/**
 * The forward-evidence invariants, adversarially (owner tests 1–17 at the engine level).
 *
 * The one that matters most: a signal exists BEFORE its outcome, and nothing — not a later pass,
 * not a replay, not raw SQL — can edit either afterwards.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-forward-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "fwd.db");
  closeDbForTests();
  getDb();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Monday 2026-08-03 09:15 IST as unix seconds. */
const OPEN = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;
const BARS_PER_SESSION = 75;

const DSL = StrategyDslSchema.parse({
  name: "fwd_probe",
  universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
  entry: { feature: "minutes_since_open", op: "gte", value: 15 },
  exit: { stopLossPct: 0.5, takeProfitPct: 1 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
}) as StrategyDsl;

function seedSession(session: number, start = 100): void {
  persistCandles(
    Array.from({ length: BARS_PER_SESSION }, (_, index) => {
      const price = start + index * 0.3;
      return {
        ticker: "IN:XNSE:RELIANCE",
        resolution: "5",
        time: OPEN + session * 86_400 + index * 300,
        open: price - 0.1,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        volume: 1_000,
      };
    }),
  );
}

/** A spec with identity + gauntlet experiment, ready for activation. */
function seedActivatableSpec(name = "fwd_probe"): string {
  const specId = recordStrategySpec({ name, version: 1, dsl: DSL, createdBy: "test" });
  placeInTestFamily(specId, DSL, `fam_${name}`);
  registerTestSnapshot(`dss_${name}`, `fp_${name}`);
  recordExperiment({
    specId,
    snapshotId: `dss_${name}`,
    kind: "gauntlet",
    engineVersion: COMPILER_VERSION,
    executionProfileId: null,
    summary: "seeded gauntlet baseline",
    trades: [],
    actor: "test",
  });
  return specId;
}

/** Activate with the watermark rewound so already-seeded bars count as future arrivals. */
function activate(specId: string): string {
  const activation = activateChallenger(specId, "test", new Date((OPEN - 86_400) * 1000));
  if (!activation.ok) throw new Error(activation.message);
  return activation.challengerId;
}

describe("activation freezes identity (owner tests 7, 12)", () => {
  it("refuses a spec with no gauntlet experiment — the baseline must exist first", () => {
    const specId = recordStrategySpec({ name: "no_gauntlet", version: 1, dsl: DSL, createdBy: "test" });
    placeInTestFamily(specId, DSL, "fam_no_gauntlet");
    const result = activateChallenger(specId, "test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_GAUNTLET_EXPERIMENT");
  });

  it("refuses when economics cannot be priced at activation", () => {
    const usDsl = StrategyDslSchema.parse({
      ...DSL,
      name: "fwd_us_old",
      universe: { market: "US", maxPositions: 4, resolution: "D" },
      exit: { afterDays: 5, stopLossPct: 2 },
      costs: { commissionBps: 5, slippageBps: 7 },
    }) as StrategyDsl;
    const specId = recordStrategySpec({ name: usDsl.name, version: 1, dsl: usDsl, createdBy: "test" });
    placeInTestFamily(specId, usDsl, "fam_us_old");
    registerTestSnapshot("dss_us_old", "fp_us_old");
    recordExperiment({
      specId,
      snapshotId: "dss_us_old",
      kind: "gauntlet",
      engineVersion: COMPILER_VERSION,
      executionProfileId: null,
      summary: "s",
      trades: [],
      actor: "test",
    });
    // 2023: before any US fee schedule. Unpriceable economics must refuse activation.
    const result = activateChallenger(specId, "test", new Date("2023-06-01T00:00:00Z"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ECONOMICS_UNPRICEABLE");
  });

  it("one challenger per strategy version; a change means a new version (owner test 7)", () => {
    const specId = seedActivatableSpec("one_per_version");
    activate(specId);
    const again = activateChallenger(specId, "test");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_ACTIVE");

    // A NEW spec version activates its own challenger with its own forward clock.
    const v2 = seedActivatableSpec("one_per_version_v2");
    const activation = activateChallenger(v2, "test");
    expect(activation.ok).toBe(true);
  });

  it("the challenger row is trigger-frozen: identity fields cannot be edited", () => {
    const specId = seedActivatableSpec("frozen");
    const challengerId = activate(specId);
    closeDbForTests();
    const raw = new Database(process.env.MARKETPULSE_DB_PATH!);
    expect(() =>
      raw.prepare("UPDATE forward_challengers SET forward_policy = '{}' WHERE id = ?").run(challengerId),
    ).toThrow(/frozen/i);
    expect(() => raw.prepare("DELETE FROM forward_challengers WHERE id = ?").run(challengerId)).toThrow(/append-only/i);
    raw.close();
  });
});

describe("signals precede outcomes and cannot be rewritten (owner tests 1, 2, 4, 15)", () => {
  it("a pass over one session emits signals; outcomes resolve only from later bars", () => {
    seedSession(0);
    const specId = seedActivatableSpec("emits");
    activate(specId);

    const report = runShadowPass(new Date((OPEN + 86_400) * 1000));
    expect(report.signalsEmitted).toBeGreaterThan(0);

    const signals = getDb().select().from(schema.forwardSignals).all();
    const outcomes = getDb().select().from(schema.forwardSignalOutcomes).all();
    expect(signals.length).toBe(report.signalsEmitted);
    // Every outcome's exit strictly follows its signal's event — the prediction came first.
    const byId = new Map(signals.map((signal) => [signal.id, signal]));
    for (const outcome of outcomes) {
      expect(outcome.exitTime).toBeGreaterThan(byId.get(outcome.signalId)!.eventTime);
    }
  });

  it("signals and outcomes are immutable against raw SQL (owner tests 2, 15)", () => {
    seedSession(0);
    const specId = seedActivatableSpec("immutable");
    activate(specId);
    runShadowPass(new Date((OPEN + 86_400) * 1000));

    closeDbForTests();
    const raw = new Database(process.env.MARKETPULSE_DB_PATH!);
    const signal = raw.prepare("SELECT id FROM forward_signals LIMIT 1").get() as { id: string };
    expect(() => raw.prepare("UPDATE forward_signals SET entry_price = 1 WHERE id = ?").run(signal.id)).toThrow(/immutable/i);
    expect(() => raw.prepare("DELETE FROM forward_signals WHERE id = ?").run(signal.id)).toThrow(/append-only/i);
    const outcome = raw.prepare("SELECT signal_id FROM forward_signal_outcomes LIMIT 1").get() as
      | { signal_id: string }
      | undefined;
    if (outcome) {
      expect(() =>
        raw.prepare("UPDATE forward_signal_outcomes SET exit_price = 1 WHERE signal_id = ?").run(outcome.signal_id),
      ).toThrow(/immutable|laundered/i);
    }
    raw.close();
  });

  it("one market event mints exactly one signal, ever (owner test 4)", () => {
    seedSession(0);
    const specId = seedActivatableSpec("dedupe");
    activate(specId);
    runShadowPass(new Date((OPEN + 86_400) * 1000));
    const first = getDb().select().from(schema.forwardSignals).all().length;

    runShadowPass(new Date((OPEN + 2 * 86_400) * 1000));
    expect(getDb().select().from(schema.forwardSignals).all().length).toBe(first);
  });
});

describe("no retroactive signals (owner tests 3, 16)", () => {
  it("bars that arrive at or before the watermark cannot mint signals", () => {
    const specId = seedActivatableSpec("no_retro");
    // Activate FIRST (watermark = day before session 0), evaluate session 0…
    activate(specId);
    seedSession(0);
    runShadowPass(new Date((OPEN + 86_400) * 1000));
    const after = getDb().select().from(schema.forwardSignals).all().length;
    expect(after).toBeGreaterThan(0);

    // …then a late/out-of-order backfill of EARLIER bars lands in the store. Replaying must not
    // create signals for history the challenger has already passed over.
    persistCandles(
      Array.from({ length: 30 }, (_, index) => ({
        ticker: "IN:XNSE:TCS",
        resolution: "5",
        time: OPEN - 86_400 + index * 300,
        open: 50,
        high: 51,
        low: 49,
        close: 50,
        volume: 500,
      })),
    );
    runShadowPass(new Date((OPEN + 86_400) * 1000));
    expect(getDb().select().from(schema.forwardSignals).all().length).toBe(after);
  });
});

describe("restart and idempotency (owner tests 5, 6, 17)", () => {
  it("unresolved signals survive a restart and resolve later, exactly once", () => {
    seedSession(0);
    const specId = seedActivatableSpec("restart");
    activate(specId);
    runShadowPass(new Date((OPEN + 86_400) * 1000));
    const unresolvedBefore =
      getDb().select().from(schema.forwardSignals).all().length -
      getDb().select().from(schema.forwardSignalOutcomes).all().length;
    expect(unresolvedBefore).toBeGreaterThanOrEqual(0);

    closeDbForTests(); // application restart
    getDb();

    // New session's bars arrive; the resolver picks up where it left off.
    seedSession(1, 130);
    const second = runShadowPass(new Date((OPEN + 2 * 86_400) * 1000));
    const outcomes = getDb().select().from(schema.forwardSignalOutcomes).all();
    expect(outcomes.length).toBeGreaterThan(0);

    // Idempotent: a third pass with nothing new resolves nothing again and changes no row.
    const snapshotOfOutcomes = JSON.stringify(outcomes);
    const third = runShadowPass(new Date((OPEN + 2 * 86_400) * 1000));
    expect(third.outcomesResolved).toBe(0);
    expect(third.signalsEmitted).toBe(0);
    expect(JSON.stringify(getDb().select().from(schema.forwardSignalOutcomes).all())).toBe(snapshotOfOutcomes);
    void second;
  });
});

describe("scorecard and policy (owner tests 13, 14)", () => {
  it("predeclares frequency-aware policy at activation and reports INSUFFICIENT honestly", () => {
    const slow = deriveForwardPolicy(10, 60, "D");
    const fast = deriveForwardPolicy(600, 60, "5m");
    expect(slow.minSessions).toBe(40);
    expect(fast.minSignals).toBeGreaterThanOrEqual(slow.minSignals);

    seedSession(0);
    const specId = seedActivatableSpec("scorecard");
    const challengerId = activate(specId);
    runShadowPass(new Date((OPEN + 86_400) * 1000));

    const card = forwardScorecard(challengerId)!;
    expect(card.policy.version).toBeTruthy();
    // One session of signals can never meet a ≥10-session policy: promotion stays unearned.
    expect(["INSUFFICIENT", "ON_TRACK", "DRIFTING"]).toContain(card.verdict);
    expect(card.verdict).not.toBe("MEETS_POLICY");
  });

  it("compares against the frozen historical experiment it pinned (owner test 13)", () => {
    seedSession(0);
    const specId = seedActivatableSpec("baseline");
    // An inspection experiment with per-trade evidence is the baseline the scorecard must cite.
    recordExperiment({
      specId,
      snapshotId: "dss_baseline",
      kind: "inspection",
      engineVersion: COMPILER_VERSION,
      executionProfileId: null,
      summary: "2 trade(s)",
      trades: [{ netReturn: 0.004 }, { netReturn: -0.002 }],
      actor: "test",
    });
    const challengerId = activate(specId);
    runShadowPass(new Date((OPEN + 86_400) * 1000));

    const card = forwardScorecard(challengerId)!;
    expect(card.baseline).not.toBeNull();
    expect(card.baseline!.trades).toBe(2);
    expect(card.baseline!.snapshotId).toBe("dss_baseline");
  });
});
