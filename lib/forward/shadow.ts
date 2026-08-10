import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { conditionLeaves } from "@/lib/backtest/inspect";
import { buildFeaturePanel, type FeatureVector } from "@/lib/backtest/features";
import { executionContextFor } from "@/lib/broker/execution-profile";
import { CostModelError, FEE_MODEL_ID, roundTripCost } from "@/lib/paper/cost-model";
import { snapshotFromStore } from "@/lib/research-data/snapshot";
import { COMPILER_VERSION, StrategyDslSchema, marketOf, type Condition, type StrategyDsl } from "@/lib/strategy/dsl";
import { validationStanding } from "@/lib/strategy/research-identity";
import type { Candle } from "@/lib/providers/types";

/**
 * The forward SHADOW stage (mission workstream 1).
 *
 * ## The invariant
 *
 * A signal is persisted BEFORE its future outcome exists, and neither signals nor resolved
 * outcomes can be edited afterwards — SQLite triggers enforce both. Everything the historical
 * side can never prove ("would this have worked on data that did not exist when the strategy was
 * built?") is answered only here.
 *
 * ## How prospectiveness is enforced mechanically
 *
 * Each challenger carries a `lastEvaluatedTime` watermark. A pass evaluates only bars strictly
 * AFTER the watermark, then advances it. Replaying old data does nothing (the watermark already
 * covers it), late/out-of-order bars cannot mint retroactive signals, and a signal's outcome is
 * computed only from bars strictly after its event time. Outcomes key on the signal id, so
 * resolution is idempotent by construction.
 *
 * ## SHADOW ≠ PAPER
 *
 * Shadow asks whether the frozen signal logic survives unseen data: no capital, no sizing, no
 * portfolio constraints, no competing signals. The paper stage (the existing trade board →
 * forward-driver → forward_outcomes chain) layers capital and portfolio reality on top and is a
 * separate ledger on purpose.
 */

export const FORWARD_POLICY_VERSION = "fp-2026-08-09.1";

export interface ForwardPolicy {
  version: string;
  /** Frequency-aware: a scalper and a monthly swing strategy do not share one number. */
  minSignals: number;
  minSessions: number;
  /** After-cost expectancy per signal must clear this before promotion counts anything. */
  minNetExpectancy: number;
  maxDriftScore: number;
  /** Running cumulative net return must never dip below −this. */
  maxDrawdown: number;
}

/**
 * Predeclared before activation, derived from the strategy's own historical frequency — never
 * invented after seeing forward results.
 */
export function deriveForwardPolicy(
  historicalTrades: number,
  historicalSessions: number,
  resolution: string,
): ForwardPolicy {
  const minSessions = resolution === "D" ? 40 : 10;
  const perSession = historicalSessions > 0 ? historicalTrades / historicalSessions : 1;
  const minSignals = Math.min(80, Math.max(20, Math.ceil(perSession * minSessions)));
  return { version: FORWARD_POLICY_VERSION, minSignals, minSessions, minNetExpectancy: 0, maxDriftScore: 0.6, maxDrawdown: 0.1 };
}

export type ActivationResult =
  | { ok: true; challengerId: string; policy: ForwardPolicy }
  | { ok: false; code: "SPEC_NOT_FOUND" | "DSL_INVALID" | "NO_RESEARCH_IDENTITY" | "NO_GAUNTLET_EXPERIMENT" | "ECONOMICS_UNPRICEABLE" | "ALREADY_ACTIVE"; message: string };

/**
 * Freeze a strategy version into a forward challenger.
 *
 * Requires: a research identity (family/campaign), a recorded gauntlet experiment whose manifest
 * pins the dataset the strategy was judged on, and priceable economics. Once activated the row is
 * trigger-frozen — a strategy change means a new spec version and a new challenger.
 */
export function activateChallenger(specId: string, actor: string, now = new Date()): ActivationResult {
  const db = getDb();
  const spec = db.select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, specId)).get();
  if (!spec) return { ok: false, code: "SPEC_NOT_FOUND", message: `No strategy ${specId}.` };

  const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
  if (!parsed.success) {
    return { ok: false, code: "DSL_INVALID", message: "The stored specification no longer parses; it cannot be observed forward." };
  }
  const dsl = parsed.data;

  const existing = db
    .select()
    .from(schema.forwardChallengers)
    .where(eq(schema.forwardChallengers.strategySpecId, specId))
    .get();
  if (existing) {
    return {
      ok: false,
      code: "ALREADY_ACTIVE",
      message: `Challenger ${existing.id} already observes this strategy version (status ${existing.status}). A logic change is a new version and a new challenger.`,
    };
  }

  const standing = validationStanding(specId);
  if (!standing.eligible || standing.identity === null) {
    return { ok: false, code: "NO_RESEARCH_IDENTITY", message: standing.reason };
  }

  const gauntlet = db
    .select()
    .from(schema.experiments)
    .where(and(eq(schema.experiments.strategySpecId, specId), eq(schema.experiments.kind, "gauntlet")))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!gauntlet) {
    return {
      ok: false,
      code: "NO_GAUNTLET_EXPERIMENT",
      message:
        "No gauntlet experiment exists for this strategy version. Forward observation pins itself to the " +
        "historical evidence it must be compared against; run the gauntlet first so that baseline exists.",
    };
  }

  // Economics must be priceable at activation (owner test 12's activation face): a challenger
  // whose trades cannot be costed would accumulate gross-only evidence that paper promotion
  // could never use.
  try {
    roundTripCost({
      market: marketOf(dsl.universe.market),
      notional: 10_000,
      product: dsl.universe.resolution === "D" ? "DELIVERY" : "INTRADAY",
      at: now,
    });
  } catch (caught) {
    if (caught instanceof CostModelError) {
      return { ok: false, code: "ECONOMICS_UNPRICEABLE", message: `Realistic economics cannot be computed: ${caught.message}` };
    }
    throw caught;
  }

  // Historical frequency for the predeclared policy, from the inspection experiment when one
  // exists (it carries per-trade evidence); conservative defaults otherwise.
  const inspection = db
    .select()
    .from(schema.experiments)
    .where(and(eq(schema.experiments.strategySpecId, specId), eq(schema.experiments.kind, "inspection")))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const historicalTrades = inspection?.tradeCount ?? gauntlet.tradeCount;
  const policy = deriveForwardPolicy(historicalTrades || 20, 60, dsl.universe.resolution);

  const execution = executionContextFor(dsl.universe.market, dsl.universe.resolution, now);
  const challengerId = `fch_${createHash("sha256").update(`${specId}|${now.getTime()}`).digest("hex").slice(0, 16)}`;

  db.insert(schema.forwardChallengers)
    .values({
      id: challengerId,
      strategySpecId: specId,
      strategyFamilyId: standing.identity.familyId,
      researchCampaignId: standing.identity.campaignId,
      activatedAt: now,
      codeFingerprint: `marketpulse-dsl@${COMPILER_VERSION}`,
      engineVersion: COMPILER_VERSION,
      executionProfileId: execution.available ? execution.profile.id : null,
      feeModelId: FEE_MODEL_ID,
      market: dsl.universe.market,
      resolution: dsl.universe.resolution,
      universe: JSON.stringify(dsl.universe),
      dslHash: spec.dslHash,
      promotionExperimentId: gauntlet.id,
      promotionSnapshotId: gauntlet.datasetSnapshotId,
      forwardPolicy: JSON.stringify(policy),
      forwardPolicyVersion: policy.version,
      status: "ACTIVE",
      retiredAt: null,
      retiredReason: null,
      lastEvaluatedTime: Math.floor(now.getTime() / 1000),
      createdBy: actor,
    })
    .run();

  return { ok: true, challengerId, policy };
}

/** Evaluate a condition tree on one bar (with its predecessor, for crossings). */
function evaluateCondition(condition: Condition, vector: FeatureVector, previous: FeatureVector | undefined): boolean {
  if ("feature" in condition || "compare" in condition) {
    // Single-leaf verdicts come from the shared leaf evaluator; null (unknowable) is false here —
    // a signal requires the condition to be TRUE, not merely not-false.
    return conditionLeaves(condition).every((leaf) => leaf.evaluate(vector) === true);
  }
  if ("crossover" in condition || "crossunder" in condition) {
    const pair = "crossover" in condition ? condition.crossover : condition.crossunder;
    if (!previous) return false;
    const nowLeft = vector[pair[0] as keyof FeatureVector];
    const nowRight = vector[pair[1] as keyof FeatureVector];
    const prevLeft = previous[pair[0] as keyof FeatureVector];
    const prevRight = previous[pair[1] as keyof FeatureVector];
    if ([nowLeft, nowRight, prevLeft, prevRight].some((value) => value === undefined)) return false;
    return "crossover" in condition
      ? (prevLeft as number) <= (prevRight as number) && (nowLeft as number) > (nowRight as number)
      : (prevLeft as number) >= (prevRight as number) && (nowLeft as number) < (nowRight as number);
  }
  if ("not" in condition) return !evaluateCondition(condition.not, vector, previous);
  if ("all" in condition) return condition.all.every((child) => evaluateCondition(child, vector, previous));
  return condition.any.some((child) => evaluateCondition(child, vector, previous));
}

export const RESOLUTION_SECONDS: Record<string, number> = { D: 86_400, "1m": 60, "5m": 300, "15m": 900 };

/** IST minute-of-day for a bar CLOSE time, for square-off comparison on NSE/BSE intraday. */
export function istMinute(barTime: number, barSeconds: number): number {
  const closeMs = (barTime + barSeconds) * 1000 + 5.5 * 3600 * 1000;
  const d = new Date(closeMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export interface ShadowPassReport {
  challengersEvaluated: number;
  signalsEmitted: number;
  outcomesResolved: number;
  skipped: string[];
  summary: string;
}

/**
 * One shadow pass: emit signals for bars newly arrived since each challenger's watermark, then
 * resolve any open signal the store has since decided. Store-only — ingestion (accumulator,
 * imports) is the sole road bars travel to get here.
 */
export function runShadowPass(now = new Date()): ShadowPassReport {
  const db = getDb();
  const challengers = db
    .select()
    .from(schema.forwardChallengers)
    .where(eq(schema.forwardChallengers.status, "ACTIVE"))
    .all();

  const skipped: string[] = [];
  let signalsEmitted = 0;
  let outcomesResolved = 0;

  // One snapshot per (market, resolution): challengers share markets.
  const datasets = new Map<string, ReturnType<typeof snapshotFromStore>>();

  for (const challenger of challengers) {
    const spec = db.select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, challenger.strategySpecId)).get();
    const parsed = spec ? StrategyDslSchema.safeParse(JSON.parse(spec.dsl)) : null;
    if (!parsed?.success) {
      skipped.push(`${challenger.id}: stored DSL no longer parses; challenger left untouched.`);
      continue;
    }
    const dsl = parsed.data;

    const key = `${challenger.market}|${challenger.resolution}`;
    if (!datasets.has(key)) {
      datasets.set(key, snapshotFromStore(dsl.universe.market, challenger.resolution, "forward-shadow"));
    }
    const snapshot = datasets.get(key)!;
    if (!snapshot.ok) {
      skipped.push(`${challenger.id}: ${snapshot.message}`);
      continue;
    }

    const barSeconds = RESOLUTION_SECONDS[challenger.resolution] ?? 86_400;
    const emitted = emitSignals(challenger, dsl, snapshot.dataset, barSeconds, now);
    signalsEmitted += emitted.count;

    outcomesResolved += resolveOutcomes(challenger.id, dsl, snapshot.dataset, barSeconds);

    // Advance the watermark to the newest bar actually seen — bars at or before it are settled
    // for this challenger forever. (The trigger permits exactly this field to move.)
    if (emitted.newestBarTime > challenger.lastEvaluatedTime) {
      db.update(schema.forwardChallengers)
        .set({ lastEvaluatedTime: emitted.newestBarTime })
        .where(eq(schema.forwardChallengers.id, challenger.id))
        .run();
    }
  }

  return {
    challengersEvaluated: challengers.length,
    signalsEmitted,
    outcomesResolved,
    skipped,
    summary:
      challengers.length === 0
        ? "No active forward challenger. Activate one from a gauntlet-evaluated strategy to start accumulating prospective evidence."
        : `Shadow pass: ${signalsEmitted} signal(s) recorded before their outcomes exist, ${outcomesResolved} outcome(s) resolved from bars that arrived after their predictions.${skipped.length > 0 ? ` ${skipped.length} challenger(s) skipped.` : ""}`,
  };
}

function emitSignals(
  challenger: typeof schema.forwardChallengers.$inferSelect,
  dsl: StrategyDsl,
  dataset: Readonly<Record<string, readonly Candle[]>>,
  barSeconds: number,
  now: Date,
): { count: number; newestBarTime: number } {
  const db = getDb();
  let count = 0;
  let newestBarTime = challenger.lastEvaluatedTime;
  const observedAt = Math.floor(now.getTime() / 1000);
  const stopPct = dsl.exit.stopLossPct;
  const targetPct = dsl.exit.takeProfitPct;
  const horizonBars = dsl.exit.afterDays ?? (challenger.resolution === "D" ? 20 : 75);
  const leafSet = conditionLeaves(dsl.entry);

  for (const [instrumentId, bars] of Object.entries(dataset)) {
    // Session features (minutes_since_open, opening range) exist only when the panel knows the
    // market and resolution — the same options every engine passes.
    const panel = buildFeaturePanel(bars, { market: marketOf(dsl.universe.market), resolution: challenger.resolution });
    for (let index = 1; index < bars.length; index += 1) {
      const bar = bars[index];
      if (bar.time <= challenger.lastEvaluatedTime) continue; // settled history: no retroactive signals
      newestBarTime = Math.max(newestBarTime, bar.time);

      const vector = panel.at(index);
      const previous = panel.at(index - 1);
      if (!vector || !evaluateCondition(dsl.entry, vector, previous)) continue;

      const entryPrice = bar.close;
      const clauses = leafSet.map((leaf) => ({ clause: leaf.clause, passed: leaf.evaluate(vector) }));
      const features = leafSet.map((leaf) => ({
        feature: leaf.feature,
        value: (vector[leaf.feature as keyof FeatureVector] as number | undefined) ?? null,
      }));
      const id = `fws_${createHash("sha256")
        .update(`${challenger.id}|${instrumentId}|${bar.time}`)
        .digest("hex")
        .slice(0, 16)}`;
      const payload = {
        id,
        challengerId: challenger.id,
        instrumentId,
        eventTime: bar.time,
        observedAt,
        clauseEvidence: JSON.stringify(clauses),
        featureValues: JSON.stringify(features),
        entryPrice,
        stopPrice: stopPct !== undefined ? entryPrice * (1 - stopPct / 100) : null,
        targetPrice: targetPct !== undefined ? entryPrice * (1 + targetPct / 100) : null,
        horizonBars,
        executionProfileId: challenger.executionProfileId,
        costModelId: challenger.feeModelId,
        dataQuality: JSON.stringify({ basis: "canonical-store", barsAvailable: bars.length, lastBarTime: bars[bars.length - 1].time }),
        fingerprint: "",
      };
      payload.fingerprint = createHash("sha256")
        .update(`${payload.id}|${payload.eventTime}|${payload.entryPrice}|${payload.stopPrice}|${payload.targetPrice}|${payload.clauseEvidence}`)
        .digest("hex")
        .slice(0, 24);

      try {
        db.insert(schema.forwardSignals).values(payload).run();
        count += 1;
      } catch (caught) {
        // The UNIQUE(challenger, instrument, event_time) fired: this market event already has its
        // one signal, and it keeps it (owner test 4).
        if (!/UNIQUE constraint failed/i.test(caught instanceof Error ? caught.message : "")) throw caught;
      }
    }
  }
  return { count, newestBarTime };
}

function resolveOutcomes(
  challengerId: string,
  dsl: StrategyDsl,
  dataset: Readonly<Record<string, readonly Candle[]>>,
  barSeconds: number,
): number {
  const db = getDb();
  const open = db
    .select({ signal: schema.forwardSignals })
    .from(schema.forwardSignals)
    .leftJoin(schema.forwardSignalOutcomes, eq(schema.forwardSignalOutcomes.signalId, schema.forwardSignals.id))
    .where(and(eq(schema.forwardSignals.challengerId, challengerId), isNull(schema.forwardSignalOutcomes.signalId)))
    .all()
    .map((row) => row.signal);

  const intraday = dsl.universe.resolution !== "D";
  const execution = intraday
    ? executionContextFor(dsl.universe.market, dsl.universe.resolution, new Date())
    : null;
  const squareOffMinute = execution?.available ? execution.profile.mandatoryExitMinute ?? null : null;

  let resolved = 0;
  for (const signal of open) {
    const bars = dataset[signal.instrumentId] ?? [];
    // Strictly after the prediction: a bar that had already printed cannot resolve it.
    const later = bars.filter((bar) => bar.time > signal.eventTime);
    if (later.length === 0) continue;

    let exit: { price: number; time: number; reason: string } | null = null;
    let mfe = 0;
    let mae = 0;
    for (let held = 0; held < later.length; held += 1) {
      const bar = later[held];
      mfe = Math.max(mfe, (bar.high - signal.entryPrice) / signal.entryPrice);
      mae = Math.min(mae, (bar.low - signal.entryPrice) / signal.entryPrice);

      if (signal.stopPrice !== null && bar.low <= signal.stopPrice) {
        // A bar containing both stop and target resolves to the stop; gapped-through fills at the open.
        exit = { price: Math.min(bar.open, signal.stopPrice), time: bar.time, reason: "stop" };
        break;
      }
      if (signal.targetPrice !== null && bar.high >= signal.targetPrice) {
        exit = { price: signal.targetPrice, time: bar.time, reason: "target" };
        break;
      }
      if (intraday && squareOffMinute !== null && istMinute(bar.time, barSeconds) >= squareOffMinute) {
        exit = { price: bar.close, time: bar.time, reason: "square_off" };
        break;
      }
      if (held + 1 >= signal.horizonBars) {
        exit = { price: bar.close, time: bar.time, reason: "horizon" };
        break;
      }
    }
    if (!exit) continue; // still open — the honest state until the market decides

    const grossReturn = (exit.price - signal.entryPrice) / signal.entryPrice;
    let costReturn: number | null = null;
    let economicsUnavailable: string | null = null;
    try {
      const notional = 10_000;
      const trip = roundTripCost({
        market: marketOf(dsl.universe.market),
        notional,
        product: intraday ? "INTRADAY" : "DELIVERY",
        at: new Date(signal.eventTime * 1000),
      });
      costReturn = trip.total / notional;
    } catch (caught) {
      if (caught instanceof CostModelError) economicsUnavailable = caught.message;
      else throw caught;
    }
    const netReturn = costReturn === null ? null : grossReturn - costReturn;
    const benchmarkReturn = (later[Math.min(later.length - 1, signal.horizonBars - 1)].close - signal.entryPrice) / signal.entryPrice;

    const fingerprint = createHash("sha256")
      .update(`${signal.id}|${exit.price}|${exit.time}|${exit.reason}|${grossReturn}`)
      .digest("hex")
      .slice(0, 24);

    try {
      db.insert(schema.forwardSignalOutcomes)
        .values({
          signalId: signal.id,
          resolvedAt: Math.floor(Date.now() / 1000),
          entryFill: signal.entryPrice,
          exitPrice: exit.price,
          exitTime: exit.time,
          exitReason: exit.reason,
          mfe,
          mae,
          grossReturn,
          costReturn,
          netReturn,
          economicsUnavailable,
          benchmarkReturn,
          fingerprint,
        })
        .run();
      resolved += 1;
    } catch (caught) {
      // PK collision = another pass already resolved it. Idempotent by construction (owner test 6).
      if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(caught instanceof Error ? caught.message : "")) throw caught;
    }
  }
  return resolved;
}

export interface ForwardScorecard {
  challengerId: string;
  specId: string;
  specName: string;
  status: string;
  policy: ForwardPolicy;
  signals: number;
  resolved: number;
  open: number;
  sessionsObserved: number;
  winRate: number | null;
  meanNetReturn: number | null;
  meanGrossReturn: number | null;
  maxDrawdown: number | null;
  unpricedOutcomes: number;
  baseline: { experimentId: string; snapshotId: string | null; trades: number; meanNetReturn: number | null; winRate: number | null } | null;
  driftScore: number | null;
  verdict: "INSUFFICIENT" | "ON_TRACK" | "DRIFTING" | "MEETS_POLICY" | "FAILS_POLICY";
  summary: string;
}

/** Compare a challenger's forward record against the frozen historical experiment it pinned. */
export function forwardScorecard(challengerId: string): ForwardScorecard | null {
  const db = getDb();
  const challenger = db.select().from(schema.forwardChallengers).where(eq(schema.forwardChallengers.id, challengerId)).get();
  if (!challenger) return null;
  const spec = db.select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, challenger.strategySpecId)).get();
  const policy = JSON.parse(challenger.forwardPolicy) as ForwardPolicy;

  const signals = db.select().from(schema.forwardSignals).where(eq(schema.forwardSignals.challengerId, challengerId)).all();
  const outcomes = db
    .select({ outcome: schema.forwardSignalOutcomes })
    .from(schema.forwardSignalOutcomes)
    .leftJoin(schema.forwardSignals, eq(schema.forwardSignals.id, schema.forwardSignalOutcomes.signalId))
    .where(eq(schema.forwardSignals.challengerId, challengerId))
    .all()
    .map((row) => row.outcome);

  const priced = outcomes.filter((outcome) => outcome.netReturn !== null);
  const nets = priced.map((outcome) => outcome.netReturn as number);
  const meanNet = nets.length > 0 ? nets.reduce((total, value) => total + value, 0) / nets.length : null;
  const grosses = outcomes.map((outcome) => outcome.grossReturn);
  const meanGross = grosses.length > 0 ? grosses.reduce((total, value) => total + value, 0) / grosses.length : null;
  const winRate = nets.length > 0 ? nets.filter((value) => value > 0).length / nets.length : null;

  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of nets) {
    running += value;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  const sessionDays = new Set(signals.map((signal) => new Date(signal.eventTime * 1000).toISOString().slice(0, 10)));

  // The frozen historical baseline: the inspection experiment's per-trade ledger for this spec
  // (the gauntlet experiment pins identity; the inspection experiment carries the trades).
  const inspection = db
    .select()
    .from(schema.experiments)
    .where(and(eq(schema.experiments.strategySpecId, challenger.strategySpecId), eq(schema.experiments.kind, "inspection")))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  let baseline: ForwardScorecard["baseline"] = null;
  if (inspection) {
    const trades = db
      .select()
      .from(schema.experimentTrades)
      .where(eq(schema.experimentTrades.experimentId, inspection.id))
      .all()
      .map((row) => JSON.parse(row.payload) as { netReturn?: number });
    const histNets = trades.map((trade) => trade.netReturn).filter((value): value is number => typeof value === "number");
    baseline = {
      experimentId: inspection.id,
      snapshotId: inspection.datasetSnapshotId,
      trades: trades.length,
      meanNetReturn: histNets.length > 0 ? histNets.reduce((total, value) => total + value, 0) / histNets.length : null,
      winRate: histNets.length > 0 ? histNets.filter((value) => value > 0).length / histNets.length : null,
    };
  }

  // Drift: mean of capped, normalized divergences on the dimensions both sides can measure.
  let driftScore: number | null = null;
  if (baseline && meanNet !== null && baseline.meanNetReturn !== null && winRate !== null && baseline.winRate !== null) {
    const expectancyDrift = Math.min(1, Math.abs(meanNet - baseline.meanNetReturn) / (Math.abs(baseline.meanNetReturn) + 0.001));
    const winRateDrift = Math.min(1, Math.abs(winRate - baseline.winRate));
    driftScore = (expectancyDrift + winRateDrift) / 2;
  }

  const sufficient = nets.length >= policy.minSignals && sessionDays.size >= policy.minSessions;
  let verdict: ForwardScorecard["verdict"];
  if (!sufficient) {
    verdict = driftScore !== null && driftScore > policy.maxDriftScore ? "DRIFTING" : nets.length > 0 ? "ON_TRACK" : "INSUFFICIENT";
  } else {
    const passes =
      (meanNet ?? -1) > policy.minNetExpectancy &&
      (driftScore ?? 0) <= policy.maxDriftScore &&
      maxDrawdown <= policy.maxDrawdown;
    verdict = passes ? "MEETS_POLICY" : "FAILS_POLICY";
  }

  return {
    challengerId,
    specId: challenger.strategySpecId,
    specName: spec?.name ?? challenger.strategySpecId,
    status: challenger.status,
    policy,
    signals: signals.length,
    resolved: outcomes.length,
    open: signals.length - outcomes.length,
    sessionsObserved: sessionDays.size,
    winRate,
    meanNetReturn: meanNet,
    meanGrossReturn: meanGross,
    maxDrawdown: nets.length > 0 ? maxDrawdown : null,
    unpricedOutcomes: outcomes.length - priced.length,
    baseline,
    driftScore,
    verdict,
    summary:
      outcomes.length === 0
        ? `${signals.length} prospective signal(s) recorded, none resolved yet. Evidence accumulates only as the market answers.`
        : `${outcomes.length}/${signals.length} resolved over ${sessionDays.size} session(s); policy needs ${policy.minSignals} resolved across ${policy.minSessions}. ` +
          (driftScore !== null ? `Drift vs frozen baseline ${driftScore.toFixed(2)} (max ${policy.maxDriftScore}). ` : "No comparable baseline dimension yet. ") +
          `Verdict: ${verdict}.`,
  };
}
