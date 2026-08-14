import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * The Holdout Seal — the data-boundary half of the sealed-holdout apparatus.
 *
 * `holdout_access` (family/campaign consumption gates) and `holdout_ledger` (per-spec audit)
 * already exist and stay the ACCESS enforcement. What this module adds is the THING being
 * protected: an immutable, fingerprinted window of the canonical store with a state machine
 * separating existence from permission:
 *
 *   SEALED                     nothing may evaluate; development snapshots EXCLUDE the window
 *   AUTHORIZED_FOR_EVALUATION  the owner has authorized exactly one controlled evaluation
 *   CONSUMED                   the sample answered its one question; it never answers another
 *   INVALIDATED                the sealed bars changed underneath the fingerprint — the seal is
 *                              evidence of nothing and says so
 *
 * Everything judgment-bearing is PINNED AT SEAL TIME as copies — window, purge/embargo, dataset
 * snapshot, fingerprint, decision rule — so no later change to gates, data or code can move a
 * sealed bar. Generations: one look per generation per campaign (enforced by holdout_access),
 * so the next look requires sealing a NEW, later window as generation N+1.
 */

export type SealState = "SEALED" | "AUTHORIZED_FOR_EVALUATION" | "CONSUMED" | "INVALIDATED";

const ACTIVE_STATES: readonly SealState[] = ["SEALED", "AUTHORIZED_FOR_EVALUATION"];

/** The decision rule is DECLARED BEFORE the data is seen — never derived from the result. */
export interface HoldoutDecisionRule {
  minNetProfitFactor: number;
  minTrades: number;
}

export interface HoldoutSealRow {
  id: string;
  generation: number;
  market: "US" | "NSE" | "BSE";
  resolution: string;
  startTime: number;
  endTime: number;
  purgeGapSeconds: number;
  embargoSeconds: number;
  datasetSnapshotId: string;
  fingerprint: string;
  barCount: number;
  decisionRule: HoldoutDecisionRule;
  state: SealState;
  stateReason: string | null;
  sealedAt: Date;
  sealedBy: string;
}

export interface SealRefusal {
  ok: false;
  code:
    | "ACTIVE_SEAL_EXISTS"
    | "NO_STORED_DATA"
    | "WINDOW_TOO_THIN"
    | "WINDOW_INVALID"
    | "SEAL_NOT_FOUND"
    | "WRONG_STATE"
    | "FINGERPRINT_DRIFT";
  message: string;
}

export type SealResult = { ok: true; seal: HoldoutSealRow } | SealRefusal;

/**
 * Chronology defaults, stated not derived: purge covers the longest label horizon the DSL can
 * declare (afterDays 5) with room, embargo guards serial correlation immediately after the
 * window. Daily labels span days; intraday labels die at the session square-off.
 */
export const HOLDOUT_DEFAULTS = Object.freeze({
  windowFraction: 0.2,
  daily: Object.freeze({ purgeGapSeconds: 14 * 86_400, embargoSeconds: 7 * 86_400, minBars: 60 }),
  intraday: Object.freeze({ purgeGapSeconds: 2 * 86_400, embargoSeconds: 1 * 86_400, minBars: 400 }),
});

function defaultsFor(resolution: string) {
  return resolution === "D" ? HOLDOUT_DEFAULTS.daily : HOLDOUT_DEFAULTS.intraday;
}

function toRow(row: typeof schema.holdoutDefinitions.$inferSelect): HoldoutSealRow {
  return {
    id: row.id,
    generation: row.generation,
    market: row.market as HoldoutSealRow["market"],
    resolution: row.resolution,
    startTime: row.startTime,
    endTime: row.endTime,
    purgeGapSeconds: row.purgeGapSeconds,
    embargoSeconds: row.embargoSeconds,
    datasetSnapshotId: row.datasetSnapshotId,
    fingerprint: row.fingerprint,
    barCount: row.barCount,
    decisionRule: JSON.parse(row.decisionRule) as HoldoutDecisionRule,
    state: row.state as SealState,
    stateReason: row.stateReason,
    sealedAt: row.sealedAt,
    sealedBy: row.sealedBy,
  };
}

/** The one live seal for a universe, if any. Development exclusion reads exactly this. */
export function activeSealFor(market: string, resolution: string): HoldoutSealRow | null {
  const row = getDb()
    .select()
    .from(schema.holdoutDefinitions)
    .where(
      and(
        eq(schema.holdoutDefinitions.market, market),
        eq(schema.holdoutDefinitions.resolution, resolution),
        inArray(schema.holdoutDefinitions.state, [...ACTIVE_STATES]),
      ),
    )
    .get();
  return row ? toRow(row) : null;
}

export function sealById(id: string): HoldoutSealRow | null {
  const row = getDb().select().from(schema.holdoutDefinitions).where(eq(schema.holdoutDefinitions.id, id)).get();
  return row ? toRow(row) : null;
}

export function listSeals(): HoldoutSealRow[] {
  return getDb().select().from(schema.holdoutDefinitions).all().map(toRow).sort((a, b) => b.generation - a.generation);
}

export interface CreateSealInput {
  market: "US" | "NSE" | "BSE";
  resolution: string;
  /** The rule is pinned here, supplied by the CALLER (who owns the gate numbers). */
  decisionRule: HoldoutDecisionRule;
  actor: string;
  /** Explicit window, epoch seconds inclusive. Default: the trailing fraction of the store. */
  startTime?: number;
  endTime?: number;
  purgeGapSeconds?: number;
  embargoSeconds?: number;
  now?: Date;
}

/**
 * Seal a window. The dataset snapshot is materialized NOW (immutable, fingerprinted) and the
 * definition stores copies of everything a later evaluation depends on.
 */
export async function createSeal(input: CreateSealInput): Promise<SealResult> {
  const db = getDb();
  const now = input.now ?? new Date();

  const active = activeSealFor(input.market, input.resolution);
  if (active) {
    return {
      ok: false,
      code: "ACTIVE_SEAL_EXISTS",
      message:
        `Seal ${active.id} (generation ${active.generation}, state ${active.state}) already covers ` +
        `${input.market}/${input.resolution}. One live sealed region per universe — consume or ` +
        "invalidate it before sealing another.",
    };
  }

  // The store's span, read directly — building a full snapshot just to learn min/max would
  // record a snapshot row as a side effect of asking a question.
  const { STORE_RESOLUTION } = await import("./snapshot");
  const storeResolution = STORE_RESOLUTION[input.resolution];
  if (!storeResolution) {
    return { ok: false, code: "NO_STORED_DATA", message: `Resolution ${input.resolution} is not a store resolution.` };
  }
  const prefix = input.market === "US" ? "US:" : input.market === "NSE" ? "IN:XNSE:" : "IN:XBOM:";
  const rows = db
    .select({ time: schema.priceCandles.time, ticker: schema.priceCandles.ticker })
    .from(schema.priceCandles)
    .where(eq(schema.priceCandles.resolution, storeResolution))
    .all()
    .filter((row) => row.ticker.startsWith(prefix));
  if (rows.length === 0) {
    return {
      ok: false,
      code: "NO_STORED_DATA",
      message: `The canonical store holds no ${input.resolution} bars for ${input.market}; there is nothing to seal.`,
    };
  }
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const row of rows) {
    if (row.time < first) first = row.time;
    if (row.time > last) last = row.time;
  }

  const startTime = input.startTime ?? Math.floor(last - (last - first) * HOLDOUT_DEFAULTS.windowFraction);
  const endTime = input.endTime ?? last;
  if (!(startTime < endTime)) {
    return { ok: false, code: "WINDOW_INVALID", message: `Window [${startTime}, ${endTime}] is empty or inverted.` };
  }

  const { snapshotWindow } = await import("./snapshot");
  const snapshot = snapshotWindow(input.market, input.resolution, startTime, endTime, input.actor);
  if (!snapshot.ok) return { ok: false, code: "NO_STORED_DATA", message: snapshot.message };

  const defaults = defaultsFor(input.resolution);
  if (snapshot.barCount < defaults.minBars) {
    return {
      ok: false,
      code: "WINDOW_TOO_THIN",
      message:
        `The window holds ${snapshot.barCount} bars; a holdout below ${defaults.minBars} cannot ` +
        "support the pinned minimum-trades rule and would judge nothing. Widen the window or " +
        "accumulate more history first.",
    };
  }

  const generation =
    1 +
    getDb()
      .select({ generation: schema.holdoutDefinitions.generation })
      .from(schema.holdoutDefinitions)
      .where(
        and(
          eq(schema.holdoutDefinitions.market, input.market),
          eq(schema.holdoutDefinitions.resolution, input.resolution),
        ),
      )
      .all()
      .reduce((max, row) => Math.max(max, row.generation), 0);

  const id = `hd_${createHash("sha256")
    .update(`${input.market}|${input.resolution}|${generation}|${snapshot.fingerprint}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;

  const seal = {
    id,
    generation,
    market: input.market,
    resolution: input.resolution,
    startTime,
    endTime,
    purgeGapSeconds: input.purgeGapSeconds ?? defaults.purgeGapSeconds,
    embargoSeconds: input.embargoSeconds ?? defaults.embargoSeconds,
    datasetSnapshotId: snapshot.snapshotId,
    fingerprint: snapshot.fingerprint,
    barCount: snapshot.barCount,
    decisionRule: JSON.stringify(input.decisionRule),
    state: "SEALED" as const,
    stateReason: null,
    sealedAt: now,
    sealedBy: input.actor,
    authorizedAt: null,
    authorizedBy: null,
    consumedAt: null,
    invalidatedAt: null,
  };
  getDb().insert(schema.holdoutDefinitions).values(seal).run();
  return { ok: true, seal: toRow(seal as typeof schema.holdoutDefinitions.$inferSelect) };
}

/** SEALED → AUTHORIZED_FOR_EVALUATION. An owner act; everything else is refused with the state. */
export function authorizeSeal(id: string, actor: string, now = new Date()): SealResult {
  const seal = sealById(id);
  if (!seal) return { ok: false, code: "SEAL_NOT_FOUND", message: `No holdout seal ${id}.` };
  if (seal.state !== "SEALED") {
    return {
      ok: false,
      code: "WRONG_STATE",
      message: `Seal ${id} is ${seal.state}; only a SEALED holdout can be authorized for evaluation.`,
    };
  }
  getDb()
    .update(schema.holdoutDefinitions)
    .set({ state: "AUTHORIZED_FOR_EVALUATION", authorizedAt: now, authorizedBy: actor, stateReason: null })
    .where(and(eq(schema.holdoutDefinitions.id, id), eq(schema.holdoutDefinitions.state, "SEALED")))
    .run();
  return { ok: true, seal: { ...seal, state: "AUTHORIZED_FOR_EVALUATION" } };
}

/** AUTHORIZED_FOR_EVALUATION → CONSUMED. Called by the evaluator after the result is durable. */
export function consumeSeal(id: string, reason: string, now = new Date()): SealResult {
  const seal = sealById(id);
  if (!seal) return { ok: false, code: "SEAL_NOT_FOUND", message: `No holdout seal ${id}.` };
  if (seal.state !== "AUTHORIZED_FOR_EVALUATION") {
    return {
      ok: false,
      code: "WRONG_STATE",
      message: `Seal ${id} is ${seal.state}; only an authorized holdout can be consumed.`,
    };
  }
  getDb()
    .update(schema.holdoutDefinitions)
    .set({ state: "CONSUMED", consumedAt: now, stateReason: reason })
    .where(and(eq(schema.holdoutDefinitions.id, id), eq(schema.holdoutDefinitions.state, "AUTHORIZED_FOR_EVALUATION")))
    .run();
  return { ok: true, seal: { ...seal, state: "CONSUMED", stateReason: reason } };
}

export function invalidateSeal(id: string, reason: string, now = new Date()): SealResult {
  const seal = sealById(id);
  if (!seal) return { ok: false, code: "SEAL_NOT_FOUND", message: `No holdout seal ${id}.` };
  getDb()
    .update(schema.holdoutDefinitions)
    .set({ state: "INVALIDATED", invalidatedAt: now, stateReason: reason })
    .where(eq(schema.holdoutDefinitions.id, id))
    .run();
  return { ok: true, seal: { ...seal, state: "INVALIDATED", stateReason: reason } };
}

/**
 * Recompute the sealed window's fingerprint against the store as it is NOW. Drift means the
 * sealed bars changed underneath the definition — the seal proves nothing and is invalidated
 * loudly rather than evaluated quietly.
 */
export async function verifySealIntegrity(id: string): Promise<SealResult> {
  const seal = sealById(id);
  if (!seal) return { ok: false, code: "SEAL_NOT_FOUND", message: `No holdout seal ${id}.` };

  const { snapshotWindow } = await import("./snapshot");
  const rebuilt = snapshotWindow(seal.market, seal.resolution, seal.startTime, seal.endTime, "holdout-integrity");
  if (!rebuilt.ok || rebuilt.fingerprint !== seal.fingerprint) {
    const why = rebuilt.ok
      ? `fingerprint ${rebuilt.fingerprint} != sealed ${seal.fingerprint}`
      : rebuilt.message;
    invalidateSeal(id, `Sealed bars changed underneath the definition: ${why}`);
    return {
      ok: false,
      code: "FINGERPRINT_DRIFT",
      message:
        `Holdout ${id} no longer matches its sealed fingerprint (${why}). It has been INVALIDATED — ` +
        "an evaluation over mutated holdout data would be evidence of nothing.",
    };
  }
  return { ok: true, seal };
}
