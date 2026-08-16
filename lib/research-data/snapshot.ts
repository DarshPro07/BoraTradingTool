import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { normalizeSeries, type PriceBasis } from "@/lib/market/price-basis";
import { actionsByInstrument } from "@/lib/market/corporate-actions";
import { activeSealFor } from "./holdout-seal";
import type { Candle } from "@/lib/providers/types";

/**
 * Dataset snapshots: the research side of the data boundary.
 *
 * ## The defect this closes
 *
 * The canonical store held 30,832 five-minute bars; a replay over them produced 73 trades. The
 * inspection API consulted the live provider's sliding window instead and produced 0. Same
 * strategy, same question, two datasets, two answers — and no error anywhere, because both paths
 * were individually correct.
 *
 * ## The contract
 *
 *   provider → ingestion → canonical store → **dataset snapshot** → experiment → trade ledger
 *
 * Research reads snapshots built from the canonical store, and only the store. A snapshot is
 * identified by a fingerprint over every bar it contains, so the same snapshot id always means the
 * same bars, and one changed bar is a different snapshot. Missing data **refuses** — it is an
 * ingestion task, never a silent live fetch, because an experiment whose data quietly came from
 * "whatever the provider had that day" is not reproducible and therefore not evidence.
 *
 * `HistoricalResearchData` (this module) and `LiveMarketData` (the provider loaders) are separate
 * concepts on purpose. Live views may use live data. Statistics may not.
 */

export interface SnapshotResult {
  ok: true;
  snapshotId: string;
  fingerprint: string;
  barCount: number;
  instruments: string[];
  firstTime: number;
  lastTime: number;
  dataset: Readonly<Record<string, readonly Candle[]>>;
  /**
   * What these prices ARE. A series without a declared basis is what let the canonical store hold
   * two of them at once, so this is never optional and never inferred.
   */
  priceBasis: PriceBasis;
  /**
   * How many of the applied corporate actions were INFERRED from our own prices rather than
   * declared by the provider (`detected:store` vs `yahoo:events`).
   *
   * Lower authority, and carried all the way into the fingerprint so it cannot be lost: a bonus
   * issue Yahoo never reported and we deduced from a 2.99x step is a defensible correction, but it
   * is not the same evidence as an exchange-declared action. A validation-grade dataset must be
   * able to see that it rests partly on inference — and a snapshot built with inference is a
   * DIFFERENT dataset from one built without, so the two must never share a fingerprint.
   */
  inferredActionsUsed: number;
  /** Corporate actions whose discontinuity was found and removed while building this snapshot. */
  actionsApplied: number;
  /** Actions the series was already adjusted for — recorded because "nothing to do" is a finding. */
  actionsSkipped: number;
  /**
   * Actions whose declared ratio disagrees with the stored prices. NOTHING was adjusted for these,
   * and they travel in the snapshot so a reader learns the series has a known unresolved seam
   * rather than discovering it as a strategy result.
   */
  actionsAmbiguous: { instrumentId: string; effectiveTime: number; observedRatio: number; declaredRatio: number }[];
  /**
   * Instruments withheld from `dataset` because their normalized series still steps in a way
   * nothing explains.
   *
   * The guarantee this buys: **a research snapshot contains no unexplained price discontinuity.**
   * An unexplained step is indistinguishable from a spectacular signal — a −50% day with the
   * trend filter intact is the strongest trigger the swing mean-reversion family has — so serving
   * one and hoping is not an option. Withholding is visible and recoverable; the instrument
   * returns the moment its seam is explained.
   */
  quarantined: { instrumentId: string; effectiveTime: number; observedRatio: number; reason: string }[];
}

export interface SnapshotRefusal {
  ok: false;
  code: "NO_STORED_DATA";
  message: string;
}

/**
 * The ONLY actors that see through a live seal: the stages that CONSUME the arriving stream and
 * tune nothing. The forward shadow records predictions on data as it arrives; paper reconciles
 * fills against it. Neither chooses a strategy, so neither can bias the one holdout evaluation.
 *
 * This set is deliberately an allowlist of CONSUMPTION, not of development — the boundary fails
 * CLOSED. Listing development actors instead is what let `gauntlet` (which spends a permanent
 * statistical trial and selects on what it sees) and `statarb-formation` (pair mining is strategy
 * search) replay straight across the sealed window: an actor nobody remembered to enumerate got
 * full sight by default. Under this direction a forgotten actor loses recent bars — visible,
 * recoverable, and honest — instead of silently contaminating the holdout.
 */
const SEAL_SIGHTED_ACTORS: ReadonlySet<string> = new Set(["forward-shadow", "paper-forward"]);

/**
 * The basis research reads by default.
 *
 * SPLIT_ADJUSTED, because a split is an accounting event and not information about value: a
 * continuous series is what technical and price-pattern research needs, and the mixed-basis
 * defect proved what the alternative costs. Execution simulation asks for RAW explicitly — those
 * are the numbers that were on the tape — and dividend-sensitive work asks for TOTAL_RETURN.
 *
 * Changing this changes every fingerprint, which is the point: a snapshot on a different basis is
 * a different dataset, and must not be mistaken for the old one.
 */
export const RESEARCH_PRICE_BASIS: PriceBasis = "SPLIT_ADJUSTED";

/**
 * A single-bar move beyond this, left after normalization, is treated as unexplained.
 *
 * Deliberately generous: real Indian equities do move 40% in a session, rarely. The point is not
 * to catch every anomaly but to refuse the ones that are indistinguishable from a corporate-action
 * artifact — and every measured case in this store was 44% or more.
 */
export const UNEXPLAINED_STEP = 0.4;

/** The DSL resolution → the store's resolution key. Absent = the store cannot serve it. */
export const STORE_RESOLUTION: Readonly<Record<string, string>> = Object.freeze({
  D: "D",
  "1m": "1",
  "5m": "5",
  "15m": "15",
});

/**
 * Build (or reuse) a snapshot of everything the canonical store holds for a universe.
 *
 * Deterministic: same stored bars → same fingerprint → the existing snapshot row is reused rather
 * than duplicated. The provider is never consulted; an empty store is a refusal that names the
 * remedy (ingestion), because silently fetching would let today's provider window impersonate a
 * historical dataset.
 */
export function snapshotFromStore(
  market: "US" | "NSE" | "BSE",
  resolution: string,
  actor = "research",
): SnapshotResult | SnapshotRefusal {
  /**
   * DEVELOPMENT EXCLUSION (sealed holdout): while a seal is live for this universe, DEVELOPMENT
   * snapshots must not contain the sealed region — [start − purgeGap, end + embargo] — or the
   * holdout is development data and its one evaluation is biased before it happens. The purge
   * keeps development labels (which span forward in time) from overlapping INTO the window; the
   * embargo keeps the window's serial correlation from leaking OUT of it. A consumed or
   * invalidated seal frees the region, and the unsealed fingerprint returns byte-identically.
   *
   * DEVELOPMENT BY DEFAULT, by actor: rehearsal, backtest, validation, research, gauntlet and
   * the statarb searches are all FITTING — they choose and tune on what they see — and so is any
   * actor added later by someone who never read this file. Only the CONSUMPTION stages in
   * SEAL_SIGHTED_ACTORS see through the seal: they record predictions on the arriving stream and
   * tune nothing, and blinding THEM silently zeroed the entire shadow stage on the first
   * consolidation master run (an active seal's tail IS the recent data forward observation
   * exists to watch).
   */
  const seal = SEAL_SIGHTED_ACTORS.has(actor) ? null : activeSealFor(market, resolution);
  if (!seal) {
    return buildSnapshot(market, resolution, actor, `${market}|${resolution}|`, () => true, null);
  }
  const lo = seal.startTime - seal.purgeGapSeconds;
  const hi = seal.endTime + seal.embargoSeconds;
  return buildSnapshot(
    market,
    resolution,
    actor,
    `${market}|${resolution}|`,
    (time) => time < lo || time > hi,
    `excludes sealed holdout ${seal.id} region [${lo}, ${hi}] (window + purge + embargo)`,
  );
}

/**
 * A snapshot of ONLY the bars inside [startTime, endTime] — the sealed-holdout window builder.
 *
 * Its hash seed carries the window, so a window snapshot can never collide with (or be mistaken
 * for) the full-store snapshot of identical content, and the same window over the same bars is
 * the same fingerprint forever — which is what seal-integrity verification recomputes.
 */
export function snapshotWindow(
  market: "US" | "NSE" | "BSE",
  resolution: string,
  startTime: number,
  endTime: number,
  actor = "holdout",
): SnapshotResult | SnapshotRefusal {
  return buildSnapshot(
    market,
    resolution,
    actor,
    `${market}|${resolution}|window:${startTime}:${endTime}|`,
    (time) => time >= startTime && time <= endTime,
    `sealed window [${startTime}, ${endTime}]`,
  );
}

function buildSnapshot(
  market: "US" | "NSE" | "BSE",
  resolution: string,
  actor: string,
  hashSeed: string,
  includeBar: (time: number) => boolean,
  lineageNote: string | null,
  basis: PriceBasis = RESEARCH_PRICE_BASIS,
): SnapshotResult | SnapshotRefusal {
  const storeResolution = STORE_RESOLUTION[resolution];
  if (!storeResolution) {
    return {
      ok: false,
      code: "NO_STORED_DATA",
      message: `Resolution ${resolution} is not a store resolution. Nothing can be snapshotted for it.`,
    };
  }

  const dataset: Record<string, readonly Candle[]> = {};
  let firstTime = Number.POSITIVE_INFINITY;
  let lastTime = 0;
  let barCount = 0;

  const hash = createHash("sha256");
  // The basis is part of the identity. Two snapshots over identical bars on different bases are
  // different datasets, and a fingerprint that ignored the basis would let one pass as the other.
  hash.update(`${hashSeed}basis=${basis};`, "utf8");

  const actionLedger = actionsByInstrument();
  let actionsApplied = 0;
  let actionsSkipped = 0;
  const actionsAmbiguous: SnapshotResult["actionsAmbiguous"] = [];
  const quarantined: SnapshotResult["quarantined"] = [];
  let inferredActionsUsed = 0;

  // Enumerate the store, not today's security master. A delisted security with retained bars is
  // historical evidence and must remain eligible for a historical dataset snapshot.
  const prefix = market === "US" ? "US:" : market === "NSE" ? "IN:XNSE:" : "IN:XBOM:";
  const instrumentIds = getDb()
    .selectDistinct({ ticker: schema.priceCandles.ticker })
    .from(schema.priceCandles)
    .all()
    .map((row) => row.ticker)
    .filter((ticker) => ticker.startsWith(prefix))
    .sort();

  for (const instrumentId of instrumentIds) {
    const stored = loadStoredCandles(instrumentId, storeResolution)
      .filter((bar) => includeBar(bar.time))
      .map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
      }));
    if (stored.length === 0) continue;

    // The store holds RAW traded prices; the requested basis is reconstructed here, per
    // instrument, from the recorded actions. Nothing is written back — rewriting stored bars in
    // place is exactly how the series acquired two bases.
    const normalized = normalizeSeries(stored, actionLedger.get(instrumentId) ?? [], basis);
    actionsApplied += normalized.applied.length;
    actionsSkipped += normalized.skipped.length;
    for (const item of normalized.applied) {
      if (item.action.source.startsWith("detected:")) {
        inferredActionsUsed += 1;
        // Into the hash, per instrument and action: an inferred correction changes the prices, and
        // a fingerprint that ignored its PROVENANCE would let an inferred series pass as a
        // declared one.
        hash.update(`inferred:${instrumentId}:${item.action.effectiveTime}:${item.factor};`, "utf8");
      }
    }
    for (const item of normalized.ambiguous) {
      actionsAmbiguous.push({
        instrumentId,
        effectiveTime: item.action.effectiveTime,
        observedRatio: item.observedRatio,
        declaredRatio: item.declaredRatio,
      });
    }
    // A seam nothing explains must not reach research. Checked AFTER normalization, so a step a
    // recorded action already removed is not counted twice.
    let unexplained: { time: number; ratio: number; reason: string } | null = null;
    for (let i = 1; i < normalized.bars.length && unexplained === null; i += 1) {
      const previous = normalized.bars[i - 1];
      const current = normalized.bars[i];
      if (previous.close <= 0) continue;
      if (Math.abs(current.close - previous.close) / previous.close <= UNEXPLAINED_STEP) continue;
      unexplained = {
        time: current.time,
        ratio: previous.close / current.close,
        reason: previous.volume
          ? "step matches no recorded or plausible corporate action"
          : "first real print after a run of zero-volume placeholder bars",
      };
    }
    if (unexplained !== null) {
      quarantined.push({
        instrumentId,
        effectiveTime: unexplained.time,
        observedRatio: unexplained.ratio,
        reason: unexplained.reason,
      });
      continue;
    }

    const bars = normalized.bars;

    dataset[instrumentId] = bars;
    barCount += bars.length;
    firstTime = Math.min(firstTime, bars[0].time);
    lastTime = Math.max(lastTime, bars[bars.length - 1].time);

    // Deterministic order: catalog order per instrument, time order within. One changed bar —
    // price, volume or timestamp — changes the fingerprint.
    hash.update(instrumentId, "utf8");
    for (const bar of bars) {
      hash.update(`${bar.time},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume};`, "utf8");
    }
  }

  if (barCount === 0) {
    return {
      ok: false,
      code: "NO_STORED_DATA",
      message:
        `The canonical store holds no ${resolution} bars for ${market}. Research data is never ` +
        "replaced with a default or fetched live mid-experiment — missing history is an ingestion " +
        "task (run the accumulator or an import), not a silent provider call.",
    };
  }

  const fingerprint = hash.digest("hex").slice(0, 24);
  const instruments = Object.keys(dataset).sort();
  const db = getDb();

  const existing = db
    .select()
    .from(schema.datasetSnapshots)
    .where(eq(schema.datasetSnapshots.fingerprint, fingerprint))
    .get();

  if (existing) {
    return {
      ok: true,
      snapshotId: existing.id,
      fingerprint,
      barCount,
      instruments,
      firstTime,
      lastTime,
      dataset,
      priceBasis: basis,
      inferredActionsUsed,
      quarantined,
      actionsApplied,
      actionsSkipped,
      actionsAmbiguous,
    };
  }

  const snapshotId = `dss_${fingerprint.slice(0, 16)}`;
  db.insert(schema.datasetSnapshots)
    .values({
      id: snapshotId,
      market,
      resolution,
      instruments: JSON.stringify(instruments),
      firstTime,
      lastTime,
      barCount,
      priceBasis: basis,
      fingerprint,
      sourceLineage:
        "canonical candle store (accumulator + verified imports); see audit_events dataset_import rows" +
        (lineageNote ? `; ${lineageNote}` : ""),
      // Bumped with the basis contract: a series reconstructed from the corporate-action ledger
      // is a NEW normalization generation, not a revision of the old one.
      normalizationVersion: "corporate-action-basis-2026-08-16",
      createdAt: new Date(),
      createdBy: actor,
    })
    .run();

  return {
    ok: true,
    snapshotId,
    fingerprint,
    barCount,
    instruments,
    firstTime,
    lastTime,
    dataset,
    priceBasis: basis,
    inferredActionsUsed,
    quarantined,
    actionsApplied,
    actionsSkipped,
    actionsAmbiguous,
  };
}

/** The most recent completed experiment for a spec, with its ledger. */
export function latestExperiment(specId: string) {
  const db = getDb();
  const experiment = db
    .select()
    .from(schema.experiments)
    .where(eq(schema.experiments.strategySpecId, specId))
    .orderBy(desc(schema.experiments.createdAt))
    .get();
  if (!experiment) return null;

  const trades = db
    .select()
    .from(schema.experimentTrades)
    .where(eq(schema.experimentTrades.experimentId, experiment.id))
    .all()
    .sort((a, b) => a.tradeIndex - b.tradeIndex)
    .map((row) => JSON.parse(row.payload) as unknown);

  const snapshot = db
    .select()
    .from(schema.datasetSnapshots)
    .where(eq(schema.datasetSnapshots.id, experiment.datasetSnapshotId))
    .get();

  return { experiment, trades, snapshot: snapshot ?? null };
}

/** Persist an experiment and its trade ledger — evidence, stored as produced. */
export function recordExperiment(input: {
  specId: string;
  snapshotId: string;
  kind: string;
  engineVersion: string;
  executionProfileId: string | null;
  summary: string;
  trades: unknown[];
  actor: string;
  /** 13b reproducibility manifest, stored verbatim as JSON. */
  manifest?: object;
}): string {
  const db = getDb();
  const experimentId = `exp_${createHash("sha256")
    .update(`${input.specId}|${input.snapshotId}|${input.kind}|${input.engineVersion}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;

  const existing = db.select().from(schema.experiments).where(eq(schema.experiments.id, experimentId)).get();
  if (existing) return experimentId; // same spec + same snapshot + same engine = same experiment

  const now = new Date();
  db.insert(schema.experiments)
    .values({
      id: experimentId,
      strategySpecId: input.specId,
      datasetSnapshotId: input.snapshotId,
      kind: input.kind,
      engineVersion: input.engineVersion,
      executionProfileId: input.executionProfileId,
      tradeCount: input.trades.length,
      summary: input.summary,
      manifest: input.manifest ? JSON.stringify(input.manifest) : null,
      createdAt: now,
      createdBy: input.actor,
    })
    .run();

  for (let index = 0; index < input.trades.length; index += 1) {
    db.insert(schema.experimentTrades)
      .values({ experimentId, tradeIndex: index, payload: JSON.stringify(input.trades[index]) })
      .run();
  }
  return experimentId;
}
