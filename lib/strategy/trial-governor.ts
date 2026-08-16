import { and, eq, inArray, lt } from "drizzle-orm";
import { evaluateTrialActivation, NSE_QC_001_ACTIVATION } from "./trial-activation";
import { NSE_QC_001 } from "./campaigns/nse-qc-001";
import { getDb, schema } from "@/lib/db";
import { freezeStanding } from "./research-freeze";
// Type-only: erased at compile time, so the governor carries no RUNTIME dependency on
// auto-gauntlet (which imports the governor's authorizeTrial). One-directional at runtime.
import type { TrialCandidate } from "./auto-gauntlet";

/** Trials the loop may spend per day. One is slow enough that a systematic error surfaces first. */
export const DEFAULT_DAILY_TRIAL_BUDGET = 1;

/** The actor recorded against an automatically spent trial. Never `owner`. */
export const AUTONOMOUS_ACTOR = "autonomous_worker";

/**
 * How long a RESERVED slot is honoured before a later reserver may reclaim it as ABANDONED.
 *
 * The reservation, not this TTL, is the correctness mechanism: a stale reclaim is SAFE even if the
 * original holder is still alive, because the fencing token (`id`) means a reclaimed reservation
 * can never be finalized. The TTL only decides how long a crashed holder's slot stays occupied
 * before the budget frees up. Generous, like the cycle lease it replaces.
 */
export const RESERVATION_TTL_MS = 10 * 60_000;

/** The local trading date, YYYY-MM-DD — the budget day. Same local-midnight boundary as `trialsSpentToday`. */
export function localTradingDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Trials this actor has started since local midnight — the daily-budget denominator. */
export function trialsSpentToday(now: Date, actor = AUTONOMOUS_ACTOR): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const since = Math.floor(midnight.getTime() / 1000);

  return getDb()
    .select()
    .from(schema.trials)
    .where(eq(schema.trials.actor, actor))
    .all()
    .filter((row) => {
      // `started_at` is stored as epoch seconds by the gauntlet and as a Date by the ORM layer in
      // some paths. Normalised here rather than trusted, because a millisecond value compared
      // against a second boundary would count every historical trial as "today" and permanently
      // exhaust the budget.
      const raw = row.startedAt as unknown;
      const seconds = raw instanceof Date ? Math.floor(raw.getTime() / 1000) : Number(raw) > 1e11 ? Number(raw) / 1000 : Number(raw);
      return Number.isFinite(seconds) && seconds >= since;
    }).length;
}

/**
 * The Trial Budget Governor — the SOLE deterministic authorizer of a permanent statistical trial.
 *
 * ## Why a dedicated governor instead of a generic allowlist entry
 *
 * A validation trial is not an ordinary autonomous action. Every trial contributes to the
 * multiple-testing denominator that every future candidate in its family is measured against —
 * the Deflated Sharpe Ratio and PBO literature exists precisely because spending trials freely
 * manufactures false discoveries. So the trial ledger is treated like money: LLMs and future
 * Agent/Team workers may PROPOSE candidates, but they may never DECIDE to spend statistical
 * evidence. Only this deterministic function authorizes a spend, and it is influenced by no model.
 *
 * That is why `run_gauntlet` was removed from `AUTONOMOUS_PERMITTED` (owner decision 2026-08-14):
 * a line in the generic allowlist would be reachable by any autonomous actor and, soon, by the
 * Agent/Team layer. The authority is narrowed to this one gate instead.
 *
 * ## Autonomy without a per-trial click, and without broad autonomy
 *
 * The lane is OFF by default. It is enabled only by a dedicated owner-set switch
 * (`MARKETPULSE_AUTONOMOUS_TRIALS=1`) that lives in the process environment — the autonomous
 * system cannot set it, and it is separate from the learning mode and from every other
 * capability. Off, the governor recommends and spends nothing (the safe posture the cycle had
 * before the inherited refactor). On, and only when EVERY deterministic gate holds, it approves
 * exactly one trial — no human click per trial. That is the owner's "autonomy without letting a
 * team spend evidence freely."
 *
 * ## The gates, and where each is enforced
 *
 * - lane enabled (here) · not frozen (here, via `freezeStanding`) · daily budget remaining (here)
 * - candidate cleared every selection guard (upstream, `selectTrialCandidates`): canonical
 *   identity, at the rehearsed rung, cost-honest, tradable at the owner's capital
 * - dataset snapshot immutable + research-campaign identity present (downstream, the gauntlet's
 *   own `DatasetIdentityMissing` / `ResearchIdentityMissing` throws — last-line enforcement)
 * - exactly-once (downstream, `recordSelectionTrial` is idempotent on `configurationFingerprint`,
 *   and records BEFORE the statistic is computed)
 * - holdout untouched (the gauntlet reads only its own snapshot; `requery_locked_holdout` is a
 *   PROHIBITED action that no path here can reach)
 *
 * This function is the lane-level authority; the per-candidate and exactly-once guarantees are
 * enforced at the points that own that state, and named here so the whole chain is legible.
 */

/** The dedicated, owner-set switch. Off by default; the autonomous system cannot set it. */
export function autonomousTrialsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.MARKETPULSE_AUTONOMOUS_TRIALS === "1";
}

export type TrialAuthorizationCode =
  | "APPROVED_AUTOMATICALLY"
  | "LANE_DISABLED"
  /**
   * The registered campaign's pre-declared criteria are not satisfied, could not be evaluated, or
   * no longer match the hash they were pinned under.
   *
   * Added 2026-08-17 to close a P0: `evaluateTrialActivation` was imported by exactly one file,
   * `app/brain/page.tsx` — a display page — so the pre-registered gate governed nothing. The owner
   * switch was not a second lock in front of the gate; it was the only lock.
   */
  | "CAMPAIGN_GATE_BLOCKED"
  | "NO_ELIGIBLE_CANDIDATE"
  | "RESEARCH_FROZEN"
  | "BUDGET_EXHAUSTED";

export interface TrialAuthorization {
  approved: boolean;
  code: TrialAuthorizationCode;
  reason: string;
  budget: { perDay: number; spentToday: number; remaining: number };
  /** The durable reservation backing an APPROVED authorization; the caller finalizes it. */
  reservationId?: number;
}

/** What the campaign gate must report before a permanent trial may be spent. */
export interface CampaignGateReading {
  criteriaSatisfied: boolean;
  criteriaHash: string;
}

/**
 * The criteria hash NSE-QC-001 was registered under.
 *
 * Checked at authorization, not merely displayed: if the bar has moved, the pin no longer
 * describes the experiment being run, and a trial spent against unpinned criteria cannot be
 * accounted for afterwards. Moving the bar is allowed — silently spending against a moved bar is
 * not.
 */
export const REGISTERED_CRITERIA_HASH = "19e571a36128b1ef";

export interface AuthorizeTrialInput {
  /** The candidate selected for a spend, or null when none cleared the selection guards. */
  candidate: TrialCandidate | null;
  /**
   * Reads the registered campaign gate. Injectable for tests; the default evaluates the LIVE gate.
   *
   * Deliberately a function rather than a boolean: a green verdict computed on `/brain` minutes
   * ago must never be passed in and trusted. Authorization evaluates authoritative current state
   * inside the same path that spends, because the display can be stale and the spend is permanent.
   */
  gate?: () => CampaignGateReading | null;
  now?: Date;
  budget?: number;
  env?: Readonly<Record<string, string | undefined>>;
  /** Records the authorization decision to the audit ledger. Default writes; injectable for tests. */
  audit?: (decision: TrialAuthorization, candidate: TrialCandidate | null) => void;
}

/**
 * The deterministic POLICY decision — lane, eligibility, freeze. It does NOT check the budget:
 * the budget is a scarce, concurrency-sensitive resource, so it is enforced atomically and durably
 * by the reservation (`reserveTrialSlot`), not by a read here that a racing caller could duplicate.
 *
 * Pure with respect to the trial ledger and the reservation table — it decides and records the
 * DECISION only. `withAuthorizedTrial` composes this policy check with the atomic reservation.
 */
/**
 * Evaluate the registered campaign gate against authoritative current state.
 *
 * Returns null rather than throwing when the campaign is not registered in this database — the
 * caller treats an unobtainable verdict as a refusal, so "no campaign here" cannot read as
 * "no objection".
 */
function liveCampaignGate(): CampaignGateReading | null {
  const decision = evaluateTrialActivation(NSE_QC_001.families, NSE_QC_001_ACTIVATION);
  return { criteriaSatisfied: decision.criteriaSatisfied, criteriaHash: decision.criteriaHash };
}

export function authorizeTrial(input: AuthorizeTrialInput): TrialAuthorization {
  const now = input.now ?? new Date();
  const budget = input.budget ?? DEFAULT_DAILY_TRIAL_BUDGET;
  const env = input.env ?? process.env;
  const spentToday = activeReservationsToday(now);
  const budgetView = { perDay: budget, spentToday, remaining: Math.max(0, budget - spentToday) };
  const audit = input.audit ?? recordAuthorizationAudit;

  const decide = (approved: boolean, code: TrialAuthorizationCode, reason: string): TrialAuthorization => {
    const decision = { approved, code, reason, budget: budgetView };
    audit(decision, input.candidate);
    return decision;
  };

  // 1. The dedicated lane switch. Off by default; the whole point of the governor is that this is
  //    a narrow, owner-only authority rather than a line in the generic allowlist.
  if (!autonomousTrialsEnabled(env)) {
    return decide(
      false,
      "LANE_DISABLED",
      "The autonomous trial lane is off. A trial is spent only when the owner sets " +
        "MARKETPULSE_AUTONOMOUS_TRIALS=1 — a dedicated switch, never the learning mode or a model. " +
        "Recorded as a recommendation; nothing was spent.",
    );
  }

  // 2. The REGISTERED campaign gate. Fails closed on every path: unsatisfied criteria, an
  //    evaluator that throws, a reading that cannot be obtained, or a criteria hash that no longer
  //    matches the registration. A failure to establish permission must never become permission.
  //
  //    Evaluated HERE rather than in a caller for the same reason the OHLC coherence check lives
  //    in `persistCandles`: an upstream check is bypassed by the next caller somebody adds, and
  //    this is the point where a permanent statistical trial is actually spent.
  const readGate = input.gate ?? liveCampaignGate;
  let gateReading: CampaignGateReading | null;
  try {
    gateReading = readGate();
  } catch (caught) {
    return decide(
      false,
      "CAMPAIGN_GATE_BLOCKED",
      "The registered campaign gate could not be evaluated " +
        `(${caught instanceof Error ? caught.message.split(/\r?\n/)[0] : String(caught)}). ` +
        "Refused: an error is not permission.",
    );
  }
  if (gateReading === null) {
    return decide(
      false,
      "CAMPAIGN_GATE_BLOCKED",
      "The registered campaign gate could not be obtained. Refused: absence of a verdict is not a " +
        "favourable verdict.",
    );
  }
  if (gateReading.criteriaHash !== REGISTERED_CRITERIA_HASH) {
    return decide(
      false,
      "CAMPAIGN_GATE_BLOCKED",
      `The activation criteria hash is ${gateReading.criteriaHash}, not the registered ` +
        `${REGISTERED_CRITERIA_HASH}. The bar has moved, so the pin no longer describes this ` +
        "experiment and a trial spent now could not be accounted for against the declaration.",
    );
  }
  if (!gateReading.criteriaSatisfied) {
    return decide(
      false,
      "CAMPAIGN_GATE_BLOCKED",
      "The registered campaign's pre-declared criteria are not satisfied. The owner switch permits " +
        "autonomous trials IF the registered experiment is ready — it does not override the " +
        "declaration. Read the gate's own blockers for what remains.",
    );
  }

  //    `selectTrialCandidates` owns the
  //    per-candidate integrity (identity, rung, cost honesty, capital fit); the governor refuses
  //    to invent one.
  if (!input.candidate || !input.candidate.eligible) {
    return decide(
      false,
      "NO_ELIGIBLE_CANDIDATE",
      "No candidate cleared every selection guard. A trial is never spent to create activity.",
    );
  }

  // 3. The freeze switch — nobody may spend while the research accounting is under repair.
  const freeze = freezeStanding("gauntlet_trial");
  if (!freeze.allowed) {
    return decide(false, "RESEARCH_FROZEN", freeze.reason);
  }

  // The budget is deliberately NOT decided here — see `reserveTrialSlot`. This advisory view
  // (active reservations today) informs the report; the atomic gate is the reservation.
  return decide(
    true,
    "APPROVED_AUTOMATICALLY",
    `Policy holds: lane enabled, ${input.candidate.name} cleared selection, not frozen. ` +
      `${budgetView.remaining} of ${budget} slot(s) appear free today — the reservation decides atomically.`,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Durable trial reservations — the atomic, fenced, crash-safe budget gate.
 *
 * The reservation replaces the earlier filesystem lease. A lease with a TTL closed the
 * check-then-spend TOCTOU but had a stale-lock variant (a holder running past the TTL could be
 * reclaimed while still alive, and a second authorizer could then spend). The reservation is
 * strictly stronger:
 *   - `UNIQUE(trading_date, budget_slot) WHERE state IN ('RESERVED','SPENT')` is the atomic
 *     exclusion — SQLite rejects a second reserve for an occupied slot. No held transaction spans
 *     the long gauntlet; the reserve is one short write, the spend runs outside it, the finalize is
 *     a second short write.
 *   - the reservation's `id` is a FENCING TOKEN: a zombie that wakes after its slot was reclaimed
 *     cannot finalize, because finalize matches on `id` AND `state='RESERVED'` and a reclaimed
 *     reservation is `ABANDONED`.
 *   - crash-and-peek is prevented upstream by the gauntlet recording its selection trial BEFORE
 *     computing the statistic; a crash mid-gauntlet therefore leaves the trial (and its
 *     multiple-testing cost) on disk, so no free retry can observe a result it did not pay for.
 * ──────────────────────────────────────────────────────────────────────────── */

export type ReservationState = "RESERVED" | "SPENT" | "RELEASED" | "ABANDONED";

/** Active (RESERVED-not-expired or SPENT) reservations for today — the durable budget count. */
export function activeReservationsToday(now = new Date(), actor = AUTONOMOUS_ACTOR): number {
  const tradingDate = localTradingDate(now);
  return getDb()
    .select()
    .from(schema.trialReservations)
    .where(and(eq(schema.trialReservations.tradingDate, tradingDate), eq(schema.trialReservations.actor, actor)))
    .all()
    .filter((row) => row.state === "SPENT" || (row.state === "RESERVED" && row.expiresAt.getTime() > now.getTime()))
    .length;
}

export type ReserveOutcome =
  | { reserved: true; reservationId: number; slot: number }
  | { reserved: false; code: "BUDGET_EXHAUSTED"; reason: string };

/**
 * Atomically reserve one daily budget slot, or refuse. One short transaction: reclaim any expired
 * RESERVED rows for today (freeing their slots), then INSERT a RESERVED row for the first free
 * slot. The partial unique index guarantees that two concurrent reservers cannot both take the
 * same slot — the loser's INSERT throws and is retried against the next slot, or exhausts.
 */
export function reserveTrialSlot(input: {
  candidate: TrialCandidate;
  now?: Date;
  budget?: number;
  actor?: string;
}): ReserveOutcome {
  const now = input.now ?? new Date();
  const budget = input.budget ?? DEFAULT_DAILY_TRIAL_BUDGET;
  const actor = input.actor ?? AUTONOMOUS_ACTOR;
  const tradingDate = localTradingDate(now);
  const db = getDb();

  return db.transaction((tx): ReserveOutcome => {
    // Reclaim crashed/stalled holders: an expired RESERVED slot becomes ABANDONED and frees up.
    // Safe even if that holder is somehow still alive — the fencing token blocks its finalize.
    tx.update(schema.trialReservations)
      .set({ state: "ABANDONED", finalizedAt: now })
      .where(
        and(
          eq(schema.trialReservations.tradingDate, tradingDate),
          eq(schema.trialReservations.state, "RESERVED"),
          lt(schema.trialReservations.expiresAt, now),
        ),
      )
      .run();

    const active = tx
      .select()
      .from(schema.trialReservations)
      .where(
        and(
          eq(schema.trialReservations.tradingDate, tradingDate),
          inArray(schema.trialReservations.state, ["RESERVED", "SPENT"]),
        ),
      )
      .all();
    const used = new Set(active.map((row) => row.budgetSlot));

    for (let slot = 0; slot < budget; slot += 1) {
      if (used.has(slot)) continue;
      try {
        const result = tx
          .insert(schema.trialReservations)
          .values({
            tradingDate,
            budgetSlot: slot,
            strategySpecId: input.candidate.specId,
            actor,
            state: "RESERVED",
            reservedAt: now,
            expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
          })
          .run();
        return { reserved: true, reservationId: Number(result.lastInsertRowid), slot };
      } catch (caught) {
        // The partial UNIQUE index rejected a concurrent double-reserve of this slot. Try the next.
        if (String((caught as { message?: string }).message ?? "").includes("UNIQUE")) {
          used.add(slot);
          continue;
        }
        throw caught;
      }
    }

    return {
      reserved: false,
      code: "BUDGET_EXHAUSTED",
      reason: `All ${budget} trial slot(s) for ${tradingDate} are held or spent. No trial was spent.`,
    };
  });
}

/**
 * Finalize a reservation as SPENT. Returns false — WITHOUT spending — if the reservation is no
 * longer RESERVED (reclaimed while we ran, or already finalized): a zombie whose slot was taken by
 * a live authorizer must never record a trial against a reservation it no longer owns. The
 * `AND state='RESERVED'` in the update is the fence.
 */
export function consumeTrialReservation(reservationId: number, now = new Date()): boolean {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(schema.trialReservations).where(eq(schema.trialReservations.id, reservationId)).get();
    if (!row || row.state !== "RESERVED") return false;
    tx.update(schema.trialReservations)
      .set({ state: "SPENT", finalizedAt: now })
      .where(and(eq(schema.trialReservations.id, reservationId), eq(schema.trialReservations.state, "RESERVED")))
      .run();
    return true;
  });
}

/** Release a reservation whose spend did not occur (the gauntlet refused before recording a trial). */
export function releaseTrialReservation(reservationId: number, now = new Date()): void {
  getDb()
    .update(schema.trialReservations)
    .set({ state: "RELEASED", finalizedAt: now })
    .where(and(eq(schema.trialReservations.id, reservationId), eq(schema.trialReservations.state, "RESERVED")))
    .run();
}

/** How many selection trials the ledger holds for a spec — the source of truth for "was it spent". */
function selectionTrialsForSpec(specId: string): number {
  return getDb()
    .select()
    .from(schema.selectionTrials)
    .where(eq(schema.selectionTrials.strategySpecId, specId))
    .all().length;
}

/**
 * Compose the policy decision with the atomic durable reservation, then finalize on LEDGER TRUTH.
 *
 * Flow: `authorizeTrial` (lane/eligible/freeze) → if approved, `reserveTrialSlot` (atomic budget)
 * → run `onDecision` (the spend) OUTSIDE any transaction → finalize.
 *
 * The finalize decision is NOT the caller's word for whether it spent — it is whether a selection
 * trial for this spec actually landed in the ledger during the spend. This closes a budget
 * undercount that a `{spent}` self-report cannot: `runGauntlet` records its selection trial BEFORE
 * computing (so the multiple-testing cost is paid), and can still throw afterward (a holdout-budget
 * refusal). Trusting the callback, a throw-after-record would RELEASE the slot while a trial stood —
 * freeing budget for an extra trial. Checking the ledger instead, a recorded trial always CONSUMES
 * the slot however `onDecision` returned or threw; a refusal before any record RELEASES it. The
 * throw still propagates after the slot is correctly finalized.
 */
export async function withAuthorizedTrial<T>(
  input: AuthorizeTrialInput,
  onDecision: (authorization: TrialAuthorization) => Promise<T> | T,
): Promise<T> {
  const authorization = authorizeTrial(input);
  if (!authorization.approved || !input.candidate) {
    return onDecision(authorization);
  }

  const reservation = reserveTrialSlot({
    candidate: input.candidate,
    now: input.now,
    budget: input.budget,
  });
  if (!reservation.reserved) {
    const refused: TrialAuthorization = {
      approved: false,
      code: reservation.code,
      reason: reservation.reason,
      budget: authorization.budget,
    };
    recordAuthorizationAudit(refused, input.candidate);
    return onDecision(refused);
  }

  const approved: TrialAuthorization = { ...authorization, reservationId: reservation.reservationId };
  const specId = input.candidate.specId;
  const trialsBefore = selectionTrialsForSpec(specId);

  let value: T;
  let thrown: unknown;
  let didThrow = false;
  try {
    value = await onDecision(approved);
  } catch (caught) {
    thrown = caught;
    didThrow = true;
  }

  // Ledger truth: a new selection trial for this spec means the slot was really spent.
  if (selectionTrialsForSpec(specId) > trialsBefore) {
    consumeTrialReservation(reservation.reservationId);
  } else {
    releaseTrialReservation(reservation.reservationId);
  }

  if (didThrow) throw thrown;
  return value!;
}

/** The governor's decisions are durable evidence — who authorized what, and why, and whether spent. */
function recordAuthorizationAudit(decision: TrialAuthorization, candidate: TrialCandidate | null): void {
  try {
    getDb()
      .insert(schema.auditEvents)
      .values({
        actor: "trial-budget-governor",
        action: "authorize_trial",
        decision: decision.approved ? "allowed" : "denied",
        denialCode: decision.approved ? null : decision.code,
        subject: candidate?.specId ?? "none",
        detail: decision.reason.slice(0, 500),
        learningMode: null,
        createdAt: new Date(),
      })
      .run();
  } catch {
    // An audit-write failure must not itself authorize or deny a trial; the decision stands and
    // the caller still sees it. The gauntlet's own trial ledger remains the authoritative spend.
  }
}
