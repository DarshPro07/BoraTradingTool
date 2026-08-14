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

  it("refuses with the lane OFF even when a candidate is perfectly eligible — the safe default", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: OFF, audit: noAudit });
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("LANE_DISABLED");
  });

  it("refuses when no eligible candidate exists, even with the lane ON — never spends to make activity", () => {
    expect(authorizeTrial({ candidate: null, env: ON, audit: noAudit }).code).toBe("NO_ELIGIBLE_CANDIDATE");
    expect(authorizeTrial({ candidate: candidate("x", false), env: ON, audit: noAudit }).code).toBe("NO_ELIGIBLE_CANDIDATE");
  });

  it("approves the POLICY when lane on + eligible + not frozen (the reservation decides the budget)", () => {
    const decision = authorizeTrial({ candidate: candidate(), env: ON, audit: noAudit });
    expect(decision.approved).toBe(true);
    expect(decision.code).toBe("APPROVED_AUTOMATICALLY");
  });

  it("records its decision to the audit ledger but never writes a trial or a reservation", () => {
    authorizeTrial({ candidate: candidate(), env: ON });
    authorizeTrial({ candidate: candidate(), env: OFF });
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
  useTemporaryDatabase();

  const reservations = () => getDb().select().from(schema.trialReservations).all();

  it("lane off → refuses without reserving anything", async () => {
    const decision = await withAuthorizedTrial({ candidate: seeded(), env: OFF }, (a) => a);
    expect(decision.code).toBe("LANE_DISABLED");
    expect(reservations().length).toBe(0);
  });

  it("a real spend (a selection trial lands) → the reservation is consumed as SPENT", async () => {
    const c = seeded();
    const decision = await withAuthorizedTrial({ candidate: c, env: ON, budget: 1 }, (a) => {
      expect(a.approved).toBe(true);
      expect(a.reservationId).toBeGreaterThan(0);
      spendTrial(c); // the gauntlet ran
      return a;
    });
    expect(decision.approved).toBe(true);
    expect(reservations()[0]?.state).toBe("SPENT");
  });

  it("a refusal with NO trial recorded (no data) → the reservation is RELEASED, budget freed", async () => {
    await withAuthorizedTrial({ candidate: seeded(), env: ON, budget: 1 }, (a) => a); // records nothing
    expect(reservations()[0]?.state).toBe("RELEASED");
    expect(activeReservationsToday()).toBe(0);
  });

  it("a throw BEFORE any trial is recorded → RELEASED, throw propagates (no budget burned)", async () => {
    await expect(
      withAuthorizedTrial({ candidate: seeded(), env: ON, budget: 1 }, () => {
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
      withAuthorizedTrial({ candidate: c, env: ON, budget: 1 }, () => {
        spendTrial(c); // record-before-compute
        throw new Error("HoldoutBudgetExhausted"); // throw AFTER the record
      }),
    ).rejects.toThrow("HoldoutBudgetExhausted");
    expect(reservations()[0]?.state, "a recorded trial must consume its slot even on a later throw").toBe("SPENT");
    expect(activeReservationsToday(), "the slot stays spent — the budget is not undercounted").toBe(1);
  });

  it("[owner #1, end to end] a second spend against budget=1 is refused BUDGET_EXHAUSTED", async () => {
    const first = seeded("first");
    await withAuthorizedTrial({ candidate: first, env: ON, budget: 1 }, (a) => {
      spendTrial(first);
      return a;
    });
    const second = await withAuthorizedTrial({ candidate: seeded("second"), env: ON, budget: 1 }, (a) => a);
    expect(second.approved).toBe(false);
    expect(second.code).toBe("BUDGET_EXHAUSTED");
  });
});
