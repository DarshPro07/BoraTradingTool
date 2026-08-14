import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { loadStoredCandles } from "@/lib/market/candle-store";
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
}

export interface SnapshotRefusal {
  ok: false;
  code: "NO_STORED_DATA";
  message: string;
}

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
   * DEVELOPMENT EXCLUSION (sealed holdout): while a seal is live for this universe, research
   * snapshots must not contain the sealed region — [start − purgeGap, end + embargo] — or the
   * holdout is development data and its one evaluation is biased before it happens. The purge
   * keeps development labels (which span forward in time) from overlapping INTO the window; the
   * embargo keeps the window's serial correlation from leaking OUT of it. A consumed or
   * invalidated seal frees the region, and the unsealed fingerprint returns byte-identically.
   */
  const seal = activeSealFor(market, resolution);
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
  hash.update(hashSeed, "utf8");

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
    const bars = loadStoredCandles(instrumentId, storeResolution)
      .filter((bar) => includeBar(bar.time))
      .map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
      }));
    if (bars.length === 0) continue;

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
      fingerprint,
      sourceLineage:
        "canonical candle store (accumulator + verified imports); see audit_events dataset_import rows" +
        (lineageNote ? `; ${lineageNote}` : ""),
      normalizationVersion: "utc-clock-repair-2026-08-09",
      createdAt: new Date(),
      createdBy: actor,
    })
    .run();

  return { ok: true, snapshotId, fingerprint, barCount, instruments, firstTime, lastTime, dataset };
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
