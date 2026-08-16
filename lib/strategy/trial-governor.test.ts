import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema } from "./dsl";
import { FIXTURE_FAMILY, placeInTestFamily } from "./identity-fixture";
import { recordSelectionTrial } from "./selection-ledger";
import type { TrialCandidate } from "./auto-gauntlet";
import {
  activeReservationsToday,
  authorizeTrial,
  autonomousTrialsEnabled,
  consumeTrialReservation,
  releaseTrialReservation,
  reserveTrialSlot,
  RESERVATION_TTL_MS,
  withAuthorizedTrial,
} from "./trial-governor";

/**
 * The Trial Budget Governor — a permanent statistical trial is spent only when every deterministic
 * policy gate holds AND an atomic durable reservation is obtained. The reservation is the budget's
 * concurrency-, crash- and stale-safe gate; these tests cover the owner's adversarial set.
 */

const ON = { MARKETPULSE_AUTONOMOUS_TRIALS: "1" };
const OFF: Record<string, string | undefined> = {};

function candidate(specId = "stg_probe", eligible = true): TrialCandidate {
  return { specId, name: "probe", guards: [], eligible, reason: eligible ? "every guard holds" : "a guard failed" };
}

/** Seed a real spec, place it in its OWN declared family (so recordSelectionTrial works and never
 *  dedups across specs), and return an eligible candidate for it. */
function seeded(name = "res_probe"): TrialCandidate {
  const dsl = StrategyDslSchema.parse({
    name,
    universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
    entry: { feature: "close", op: "gt", value: 0 },
    exit: { stopLossPct: 0.5, takeProfitPct: 1 },
    sizing: { maxPositionPct: 25 },
    costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
  });
  const specId = recordStrategySpec({ name, dsl, createdBy: "test" });
  placeInTestFamily(specId, dsl, `fam_${specId}`);
  return { specId, name, guards: [], eligible: true, reason: "every guard holds" };
}

/** Record a real selection trial for a candidate — what the gauntlet does (record-before-compute). */
function spendTrial(c: TrialCandidate): void {
  const row = getDb().select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, c.specId)).get();
  const dsl = StrategyDslSchema.parse(JSON.parse(row!.dsl));
  recordSelectionTrial({ specId: c.specId, dsl, evidenceHash: `ev_${c.specId}`, datasetSnapshotId: "dss_test" });
}

describe("autonomousTrialsEnabled", () => {
  it("is OFF unless the dedicated switch is exactly '1' — never the learning mode, never a model", () => {
    expect(autonomousTrialsEnabled({})).toBe(false);
    expect(autonomousTrialsEnabled({ MARKETPULSE_AUTONOMOUS_TRIALS: "0" })).toBe(false);
    expect(autonomousTrialsEnabled({ MARKETPULSE_AUTONOMOUS_TRIALS: "true" })).toBe(false);
    expect(autonomousTrialsEnabled({ MARKETPULSE_AUTONOMOUS_TRIALS: "1" })).toBe(true);
  });
});

describe("authorizeTrial — the policy decision (lane, eligibility, freeze; NOT the budget)", () => {
  useTemporaryDatabase();
  const noAudit = () => {};
  /**
   * A satisfied campaign gate, injected so these tests keep testing THEIR subject.
   *
   * The gate now sits between the owner switch and candidate eligibility, so without this every
   * assertion below would stop at CAMPAIGN_GATE_BLOCKED and prove nothing about eligibility,
   * freeze or the audit ledger. The gate's own behaviour is covered in its own describe.
   */
  const passingGate = () => ({ criteriaSatisfied: true, criteriaHash: "19e571a36128b1ef" });

  it("refuses with the lane OFF even when a candidate is perfectly eligible — the safe default", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: OFF, audit: noAudit });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("LANE_DISABLED");
  });

  it("refuses when no eligible candidate exists, even with the lane ON — never spends to make activity", () => {
    expect(authorizeTrial({ candidate: null, env: ON, audit: noAudit, gate: passingGate }).code).toBe("NO_ELIGIBLE_CANDIDATE");
    expect(authorizeTrial({ candidate: candidate("x", false), env: ON, audit: noAudit, gate: passingGate }).code).toBe("NO_ELIGIBLE_CANDIDATE");
  });

  it("approves the POLICY when lane on + eligible + not frozen (the reservation decides the budget)", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: ON, audit: noAudit, gate: passingGate });
    expect(decision.approved).toBe(true);
    expect(decision.code).toBe("APPROVED_AUTOMATICALLY");
  });

  it("records its decision to the audit ledger but never writes a trial or a reservation", () => {
    authorizeTrial({ candidate: candidate(), env: ON, gate: passingGate });
    authorizeTrial({ candidate: candidate(), env: OFF, gate: passingGate });
    expect(getDb().select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "authorize_trial")).all().length).toBe(2);
    expect(getDb().select().from(schema.trials).all().length).toBe(0);
    expect(getDb().select().from(schema.trialReservations).all().length).toBe(0);
  });
});

describe("reserveTrialSlot — the atomic durable budget gate", () => {
  useTemporaryDatabase();

  function backdate(reservationId: number, byMs: number): void {
    getDb()
      .update(schema.trialReservations)
      .set({ expiresAt: new Date(Date.now() - byMs) })
      .where(eq(schema.trialReservations.id, reservationId))
      .run();
  }

  it("[owner #1] two attempts against budget=1: exactly one reserves, the second is BUDGET_EXHAUSTED", () => {
    const first = reserveTrialSlot({ candidate: seeded("one"), budget: 1 });
    const second = reserveTrialSlot({ candidate: seeded("two"), budget: 1 });
    expect(first.reserved).toBe(true);
    expect(second.reserved).toBe(false);
    if (!second.reserved) expect(second.code).toBe("BUDGET_EXHAUSTED");
  });

  it("allocates distinct slots up to the budget, then exhausts", () => {
    const a = reserveTrialSlot({ candidate: seeded("aaa"), budget: 2 });
    const b = reserveTrialSlot({ candidate: seeded("bbb"), budget: 2 });
    const c = reserveTrialSlot({ candidate: seeded("ccc"), budget: 2 });
    expect(a.reserved && b.reserved).toBe(true);
    if (a.reserved && b.reserved) expect(a.slot).not.toBe(b.slot);
    expect(c.reserved).toBe(false);
  });

  it("[owner #2] a non-expired RESERVED slot is honoured — no second authorization while the first is live", () => {
    reserveTrialSlot({ candidate: seeded("live"), budget: 1 });
    expect(reserveTrialSlot({ candidate: seeded("other"), budget: 1 }).reserved).toBe(false);
  });

  it("[owner #2b] an EXPIRED reservation is reclaimed as ABANDONED and its slot frees up", () => {
    const first = reserveTrialSlot({ candidate: seeded("stale"), budget: 1 });
    expect(first.reserved).toBe(true);
    if (!first.reserved) return;
    backdate(first.reservationId, RESERVATION_TTL_MS + 60_000);

    const second = reserveTrialSlot({ candidate: seeded("fresh"), budget: 1 });
    expect(second.reserved, "a stale holder's slot is reclaimable").toBe(true);

    const original = getDb().select().from(schema.trialReservations).where(eq(schema.trialReservations.id, first.reservationId)).get();
    expect(original?.state).toBe("ABANDONED");
  });

  it("[owner #3] release frees the slot immediately — a crash before the gauntlet does not burn budget", () => {
    const first = reserveTrialSlot({ candidate: seeded("released"), budget: 1 });
    expect(first.reserved).toBe(true);
    if (!first.reserved) return;
    releaseTrialReservation(first.reservationId);

    expect(activeReservationsToday()).toBe(0);
    expect(reserveTrialSlot({ candidate: seeded("next"), budget: 1 }).reserved).toBe(true);
  });

  it("[owner #6] a zombie whose reservation was reclaimed cannot finalize — the fencing token rejects it", () => {
    const zombie = reserveTrialSlot({ candidate: seeded("zombie"), budget: 1 });
    expect(zombie.reserved).toBe(true);
    if (!zombie.reserved) return;
    // The zombie stalls; its reservation expires and a live authorizer reclaims the slot.
    backdate(zombie.reservationId, RESERVATION_TTL_MS + 60_000);
    const live = reserveTrialSlot({ candidate: seeded("live"), budget: 1 });
    expect(live.reserved).toBe(true);

    // The zombie wakes and tries to finalize its OLD reservation — rejected, no spend.
    expect(consumeTrialReservation(zombie.reservationId), "a reclaimed reservation can never be finalized").toBe(false);
    const zombieRow = getDb().select().from(schema.trialReservations).where(eq(schema.trialReservations.id, zombie.reservationId)).get();
    expect(zombieRow?.state).toBe("ABANDONED");
  });

  it("[owner #5] reclaiming a reservation never deletes a recorded trial — no crash-and-peek", () => {
    const peekCandidate = seeded("peek");
    const first = reserveTrialSlot({ candidate: peekCandidate, budget: 1 });
    expect(first.reserved).toBe(true);
    if (!first.reserved) return;
    // The gauntlet records its trial BEFORE computing (gauntlet.ts), then the process crashes.
    getDb().insert(schema.trials).values({
      strategySpecId: peekCandidate.specId, kind: "gauntlet", verdict: "pending", actor: "autonomous_worker", startedAt: new Date(),
    }).run();
    const trialsBefore = getDb().select().from(schema.trials).all().length;

    // The stale reservation is later reclaimed — but the recorded trial (its statistical cost) stands.
    backdate(first.reservationId, RESERVATION_TTL_MS + 60_000);
    reserveTrialSlot({ candidate: seeded("retry"), budget: 1 });
    expect(getDb().select().from(schema.trials).all().length, "the paid-for trial is never erased by a reclaim").toBe(trialsBefore);
  });

  it("[owner #7] the budget is reconstructed from the durable table after a restart", () => {
    reserveTrialSlot({ candidate: seeded("durable"), budget: 1 });
    // A restart carries no in-memory state — the reservation persists in the DB, so the count holds.
    expect(activeReservationsToday()).toBe(1);
    expect(reserveTrialSlot({ candidate: seeded("post_restart"), budget: 1 }).reserved).toBe(false);
  });
});

describe("consume / release lifecycle", () => {
  useTemporaryDatabase();

  it("consume marks RESERVED → SPENT and returns true; a second consume is a no-op false", () => {
    const r = reserveTrialSlot({ candidate: seeded(), budget: 1 });
    expect(r.reserved).toBe(true);
    if (!r.reserved) return;
    expect(consumeTrialReservation(r.reservationId)).toBe(true);
    expect(getDb().select().from(schema.trialReservations).where(eq(schema.trialReservations.id, r.reservationId)).get()?.state).toBe("SPENT");
    expect(consumeTrialReservation(r.reservationId)).toBe(false);
  });

  it("a SPENT slot still occupies the budget (it was really spent)", () => {
    const r = reserveTrialSlot({ candidate: seeded(), budget: 1 });
    if (r.reserved) consumeTrialReservation(r.reservationId);
    expect(activeReservationsToday()).toBe(1);
    expect(reserveTrialSlot({ candidate: seeded("xyz"), budget: 1 }).reserved).toBe(false);
  });
});

describe("withAuthorizedTrial — policy + reservation + ledger-truth finalize", () => {
  /**
   * Injected so these tests keep testing the RESERVATION lifecycle. The campaign gate now sits in
   * front of candidate eligibility, so without it every case below would stop at
   * CAMPAIGN_GATE_BLOCKED and never reach the reservation it exists to exercise.
   */
  const passingGate = () => ({ criteriaSatisfied: true, criteriaHash: "19e571a36128b1ef" });

  useTemporaryDatabase();

  const reservations = () => getDb().select().from(schema.trialReservations).all();

  it("lane off → refuses without reserving anything", async () => {
    const decision = await withAuthorizedTrial({ candidate: seeded(), env: OFF }, (a) => a);
    expect(decision.code).toBe("LANE_DISABLED");
    expect(reservations().length).toBe(0);
  });

  it("a real spend (a selection trial lands) → the reservation is consumed as SPENT", async () => {
    const c = seeded();
    const decision = await withAuthorizedTrial({ candidate: c, env: ON, budget: 1, gate: passingGate }, (a) => {
      expect(a.approved).toBe(true);
      expect(a.reservationId).toBeGreaterThan(0);
      spendTrial(c); // the gauntlet ran
      return a;
    });
    expect(decision.approved).toBe(true);
    expect(reservations()[0]?.state).toBe("SPENT");
  });

  it("a refusal with NO trial recorded (no data) → the reservation is RELEASED, budget freed", async () => {
    await withAuthorizedTrial({ candidate: seeded(), env: ON, budget: 1, gate: passingGate }, (a) => a); // records nothing
    expect(reservations()[0]?.state).toBe("RELEASED");
    expect(activeReservationsToday()).toBe(0);
  });

  it("a throw BEFORE any trial is recorded → RELEASED, throw propagates (no budget burned)", async () => {
    await expect(
      withAuthorizedTrial({ candidate: seeded(), env: ON, budget: 1, gate: passingGate }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(reservations()[0]?.state).toBe("RELEASED");
  });

  it("a throw AFTER the trial is recorded → CONSUMED, never released — the undercount the verifier flagged", async () => {
    // The gauntlet records its selection trial (record-before-compute), THEN throws (e.g. a holdout
    // refusal). Trusting the callback would release the slot while a trial stood — a budget
    // undercount. The ledger-truth finalize consumes it instead.
    const c = seeded();
    await expect(
      withAuthorizedTrial({ candidate: c, env: ON, budget: 1, gate: passingGate }, () => {
        spendTrial(c); // record-before-compute
        throw new Error("HoldoutBudgetExhausted"); // throw AFTER the record
      }),
    ).rejects.toThrow("HoldoutBudgetExhausted");
    expect(reservations()[0]?.state, "a recorded trial must consume its slot even on a later throw").toBe("SPENT");
    expect(activeReservationsToday(), "the slot stays spent — the budget is not undercounted").toBe(1);
  });

  it("[owner #1, end to end] a second spend against budget=1 is refused BUDGET_EXHAUSTED", async () => {
    const first = seeded("first");
    await withAuthorizedTrial({ candidate: first, env: ON, budget: 1, gate: passingGate }, (a) => {
      spendTrial(first);
      return a;
    });
    const second = await withAuthorizedTrial({ candidate: seeded("second"), env: ON, budget: 1, gate: passingGate }, (a) => a);
    expect(second.approved).toBe(false);
    expect(second.code).toBe("BUDGET_EXHAUSTED");
  });
});

describe("the registered campaign gate governs authorization, not just the owner switch", () => {
  useTemporaryDatabase();
  const noAudit = () => {};

  /**
   * The P0 defect this closes, found 2026-08-17.
   *
   * `evaluateTrialActivation` — the pre-registered gate, hashed `19e571a36128b1ef`, whose criteria
   * were declared before any strategy result was seen — was imported by exactly ONE file:
   * `app/brain/page.tsx`. A display page. The authorization path that spends a permanent
   * statistical trial never consulted it.
   *
   * So `MARKETPULSE_AUTONOMOUS_TRIALS=1` did not mean "the owner permits trials IF the registered
   * experiment is ready". It meant "start spending", and would have done so at 18/60 breadth, 38%
   * sector classification and ZERO strategies in the ready pool.
   *
   * Each layer was individually correct — the gate computed honestly, the governor guarded
   * honestly — and the wire between them was never run. That is this repository's signature
   * failure mode, named in CLAUDE.md: a declared resolution ignored in three separate layers.
   *
   * The invariant now lives at the choke point, for the same reason the OHLC coherence check
   * belongs in `persistCandles` rather than in one caller: an upstream check can be bypassed by
   * the next caller somebody adds.
   *
   * FAIL CLOSED throughout. A failure to establish permission must never become permission.
   */
  const gateOk = () => ({ criteriaSatisfied: true, criteriaHash: "19e571a36128b1ef" });
  const gateBlocked = () => ({ criteriaSatisfied: false, criteriaHash: "19e571a36128b1ef" });

  it("DENIES when the owner switch is off and the gate is blocked", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: OFF, audit: noAudit, gate: gateBlocked });
    expect(decision.approved).toBe(false);
  });

  it("DENIES when the owner switch is off even though the gate is satisfied", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: OFF, audit: noAudit, gate: gateOk });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("LANE_DISABLED");
  });

  it("DENIES when the switch is ON but the registered criteria are NOT satisfied", () => {
    // The row that matters. Before this fix, this combination authorized a permanent spend.
    const decision = authorizeTrial({ candidate: candidate(), env: ON, audit: noAudit, gate: gateBlocked });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("CAMPAIGN_GATE_BLOCKED");
    expect(decision.reason).toMatch(/registered/i);
  });

  it("DENIES when the gate evaluator throws — an error is not permission", () => {
    const decision = authorizeTrial({
      candidate: candidate(),
      env: ON,
      audit: noAudit,
      gate: () => {
        throw new Error("coverage report unavailable");
      },
    });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("CAMPAIGN_GATE_BLOCKED");
    expect(decision.reason).toMatch(/could not be evaluated/i);
  });

  it("DENIES on a criteria-hash mismatch — the bar moved, so the pin no longer describes it", () => {
    const decision = authorizeTrial({
      candidate: candidate(),
      env: ON,
      audit: noAudit,
      gate: () => ({ criteriaSatisfied: true, criteriaHash: "deadbeefdeadbeef" }),
    });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("CAMPAIGN_GATE_BLOCKED");
    expect(decision.reason).toMatch(/hash/i);
  });

  it("DENIES when the gate cannot be obtained at all", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: ON, audit: noAudit, gate: () => null });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("CAMPAIGN_GATE_BLOCKED");
  });

  it("proceeds to the existing checks only when switch AND gate both hold", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: ON, audit: noAudit, gate: gateOk });
    // Past the campaign gate; whatever it decides next is the pre-existing policy, unchanged.
    expect(decision.code).not.toBe("CAMPAIGN_GATE_BLOCKED");
    expect(decision.code).not.toBe("LANE_DISABLED");
  });

  it("defaults to evaluating the LIVE gate when no evaluator is injected", () => {
    // A green boolean computed on /brain minutes ago must never be passed in and trusted. The
    // authorization evaluates authoritative current state; the display can be stale.
    const decision = authorizeTrial({ candidate: candidate(), env: ON, audit: noAudit });
    // Nothing is registered in this temporary database, so the live gate cannot be satisfied.
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("CAMPAIGN_GATE_BLOCKED");
  });
});
