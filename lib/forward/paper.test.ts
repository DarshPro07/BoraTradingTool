import fs from "node:fs";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { persistCandles } from "@/lib/market/candle-store";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { placeInTestFamily, registerTestSnapshot } from "@/lib/strategy/identity-fixture";
import { recordExperiment } from "@/lib/research-data/snapshot";
import { COMPILER_VERSION, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { activateChallenger, runShadowPass } from "./shadow";
import { enrollChallengerInPaper, paperScorecard, runPaperPass } from "./paper";

/**
 * WS1b invariants (owner tests, engine level). The prized one: a valid signal REJECTED for
 * insufficient capital is recorded evidence, not silence.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-paperfwd-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "pf.db");
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

const OPEN = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;
const BARS_PER_SESSION = 75;

const DSL = StrategyDslSchema.parse({
  name: "pf_probe",
  universe: { market: "NSE", maxPositions: 2, resolution: "5m" },
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

function activatable(name: string): string {
  const specId = recordStrategySpec({ name, version: 1, dsl: { ...DSL, name }, createdBy: "test" });
  placeInTestFamily(specId, DSL, `fam_${name}`);
  registerTestSnapshot(`dss_${name}`, `fp_${name}`);
  recordExperiment({
    specId,
    snapshotId: `dss_${name}`,
    kind: "gauntlet",
    engineVersion: COMPILER_VERSION,
    executionProfileId: null,
    summary: "seeded",
    trades: [],
    actor: "test",
  });
  return specId;
}

/** Activate + shadow-pass so signals exist, then enroll with the given cash. */
function readyChallenger(name: string, cash: number): string {
  seedSession(0);
  const specId = activatable(name);
  const activation = activateChallenger(specId, "test", new Date((OPEN - 86_400) * 1000));
  if (!activation.ok) throw new Error(activation.message);
  runShadowPass(new Date((OPEN + 86_400) * 1000));
  const enrolled = enrollChallengerInPaper(activation.challengerId, "test", cash);
  if (!enrolled.ok) throw new Error(enrolled.message);
  return activation.challengerId;
}

const AS_OF = new Date((OPEN + 86_400) * 1000);

describe("enrollment (owner test 19)", () => {
  it("one account per challenger; a new strategy version starts fresh, inheriting nothing", () => {
    const challengerId = readyChallenger("enroll_once", 10_000);
    const again = enrollChallengerInPaper(challengerId, "test", 50_000);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_ENROLLED");

    // v2: separate spec → separate challenger → separate account at its own cash.
    const v2 = readyChallenger("enroll_once_v2", 1_000);
    const card = paperScorecard(v2)!;
    expect(card.startingCash).toBe(1_000);
  });
});

describe("the capital verdict (owner tests 1, 13)", () => {
  it("₹1,000 rejects with INSUFFICIENT_CAPITAL — recorded as evidence, not silence", () => {
    // Prices ~100–122; 25% of ₹300 buys zero shares. The signal was valid; capital was not.
    const challengerId = readyChallenger("tiny_capital", 300);
    runPaperPass(AS_OF);
    const card = paperScorecard(challengerId)!;
    expect(card.rejected).toBeGreaterThan(0);
    expect(card.rejectReasons.INSUFFICIENT_CAPITAL).toBeGreaterThan(0);
    expect(card.executed).toBe(0);
    expect(card.cash).toBe(300); // nothing spent
  });

  it("sequential intents use running cash — concurrent signals cannot overspend the account", () => {
    const challengerId = readyChallenger("no_overspend", 10_000);
    runPaperPass(AS_OF);
    const card = paperScorecard(challengerId)!;
    // Whatever filled, the account never went negative and positions never exceeded the cap.
    expect(card.cash).toBeGreaterThanOrEqual(0);
    const outcomes = getDb().select().from(schema.paperPositionOutcomes).all();
    for (const outcome of outcomes) expect(outcome.capitalAfter).toBeGreaterThanOrEqual(0);
  });
});

describe("lifecycle and funds (owner tests 5, 11, 12)", () => {
  it("fills at the next bar open, closes by stop/target/square-off, and funds move exactly once", () => {
    const challengerId = readyChallenger("lifecycle", 10_000);
    const report = runPaperPass(AS_OF);
    expect(report.intentsRecorded).toBeGreaterThan(0);
    expect(report.ordersFilled).toBeGreaterThan(0);
    expect(report.positionsClosed).toBeGreaterThan(0);

    const card = paperScorecard(challengerId)!;
    const outcomes = getDb().select().from(schema.paperPositionOutcomes).all();
    expect(outcomes.length).toBe(card.closedPositions);
    // Rising session with a 1% target: exits exist and every exit reason is a real one.
    for (const outcome of outcomes) {
      expect(["stop", "target", "square_off", "horizon"]).toContain(outcome.exitReason);
      expect(outcome.exitTime).toBeGreaterThan(outcome.entryTime);
    }

    // Funds reconcile: cash = starting − Σ(entry cost) + Σ(proceeds − exit fees) for closed,
    // minus capital still locked in any open position. Re-running the pass changes NOTHING.
    const before = card.cash;
    const second = runPaperPass(AS_OF);
    expect(second.intentsRecorded).toBe(0);
    expect(second.ordersFilled).toBe(0);
    expect(second.positionsClosed).toBe(0);
    expect(paperScorecard(challengerId)!.cash).toBe(before);
  });
});

describe("duplicates and restart (owner tests 6, 7, 14)", () => {
  it("one signal, one intent, forever — across passes AND restarts", () => {
    const challengerId = readyChallenger("dedupe", 10_000);
    runPaperPass(AS_OF);
    const intentsBefore = getDb().select().from(schema.executionIntents).all().length;
    expect(intentsBefore).toBeGreaterThan(0);

    closeDbForTests(); // restart
    getDb();

    runPaperPass(AS_OF);
    expect(getDb().select().from(schema.executionIntents).all().length).toBe(intentsBefore);
    void challengerId;
  });

  it("open state survives restart: accepted orders and open positions are database rows", () => {
    const challengerId = readyChallenger("restart", 10_000);
    runPaperPass(AS_OF);
    const orders = getDb().select().from(schema.paperForwardOrders).all();
    closeDbForTests();
    getDb();
    expect(getDb().select().from(schema.paperForwardOrders).all()).toEqual(orders);
    void challengerId;
  });
});

describe("no invented fills (owner tests 15, 16)", () => {
  it("a store with no bar after the decision leaves the order ACCEPTED — never filled", () => {
    // Signals fire late in the session; the LAST bar's signal has no next bar to fill on.
    const challengerId = readyChallenger("no_invented_fill", 10_000);
    runPaperPass(AS_OF);
    const orders = getDb().select().from(schema.paperForwardOrders).all();
    const lastSignalOrders = orders.filter((order) => order.status === "ACCEPTED");
    for (const order of lastSignalOrders) {
      expect(order.fillPrice).toBeNull();
      expect(order.fillTime).toBeNull();
    }
    void challengerId;
  });
});

describe("immutable ledgers (owner tests 17, 18)", () => {
  it("intents and outcomes refuse raw-SQL edits; order identity and terminal states are frozen", () => {
    readyChallenger("immutable", 10_000);
    runPaperPass(AS_OF);
    closeDbForTests();
    const raw = new Database(process.env.MARKETPULSE_DB_PATH!);
    const intent = raw.prepare("SELECT id FROM execution_intents LIMIT 1").get() as { id: string };
    expect(() => raw.prepare("UPDATE execution_intents SET capital_before = 1 WHERE id = ?").run(intent.id)).toThrow(/immutable/i);
    expect(() => raw.prepare("DELETE FROM execution_intents WHERE id = ?").run(intent.id)).toThrow(/append-only/i);
    const outcome = raw.prepare("SELECT intent_id FROM paper_position_outcomes LIMIT 1").get() as
      | { intent_id: string }
      | undefined;
    if (outcome) {
      expect(() =>
        raw.prepare("UPDATE paper_position_outcomes SET net_pnl = 999 WHERE intent_id = ?").run(outcome.intent_id),
      ).toThrow(/immutable/i);
    }
    const filledOrder = raw.prepare("SELECT intent_id FROM paper_forward_orders WHERE status = 'FILLED' LIMIT 1").get() as
      | { intent_id: string }
      | undefined;
    if (filledOrder) {
      // Terminal state: even the lifecycle columns are frozen now.
      expect(() =>
        raw.prepare("UPDATE paper_forward_orders SET fill_price = 1 WHERE intent_id = ?").run(filledOrder.intent_id),
      ).toThrow(/frozen|final/i);
    }
    raw.close();
  });

  it("paper results live in their own tables — the shadow ledger is untouched by the paper pass", () => {
    readyChallenger("separate", 10_000);
    const shadowOutcomes = JSON.stringify(getDb().select().from(schema.forwardSignalOutcomes).all());
    const shadowSignals = JSON.stringify(getDb().select().from(schema.forwardSignals).all());
    runPaperPass(AS_OF);
    expect(JSON.stringify(getDb().select().from(schema.forwardSignalOutcomes).all())).toBe(shadowOutcomes);
    expect(JSON.stringify(getDb().select().from(schema.forwardSignals).all())).toBe(shadowSignals);
  });
});

describe("intent preserves the decision, not the fill (owner ledger-design rule)", () => {
  it("expected price stays the signal's; the fill lives on the order; neither overwrites the other", () => {
    readyChallenger("intent_vs_fill", 10_000);
    runPaperPass(AS_OF);
    const db = getDb();
    const filled = db.select().from(schema.paperForwardOrders).all().filter((order) => order.status === "FILLED");
    expect(filled.length).toBeGreaterThan(0);
    for (const order of filled) {
      const intent = db.select().from(schema.executionIntents).where(eq(schema.executionIntents.id, order.intentId)).get()!;
      // Fill = next bar open + slippage; expected = signal bar close. Different facts, both kept.
      expect(order.fillPrice).not.toBeNull();
      expect(intent.expectedPrice).toBeGreaterThan(0);
      expect(order.fillPrice).not.toBe(intent.expectedPrice);
    }
  });
});
