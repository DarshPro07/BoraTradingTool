import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getYahooCorporateActions } from "@/lib/providers/yahoo";
import type { CorporateAction } from "./price-basis";
import type { Instrument } from "./types";

/**
 * The corporate-action ledger: what happened to the share count and the distributions, recorded
 * so a continuous price series can be RECONSTRUCTED rather than the store rewritten.
 *
 * The store keeps raw traded prices because execution simulation, fill modelling and cost
 * accounting need the numbers that were actually on the tape. Rewriting stored bars in place is
 * how the canonical series acquired two adjustment bases in the first place, so the correction
 * deliberately does not touch them.
 *
 * Fails closed when the table is absent, like `bar-ingestion-ledger`: recording becomes a no-op
 * returning 0, and reading returns an empty list. A missing ledger must not take an ingest down.
 */

export function corporateActionLedgerReady(): boolean {
  try {
    getDb().select().from(schema.corporateActions).limit(1).all();
    return true;
  } catch {
    return false;
  }
}

/**
 * Append actions for one instrument. Idempotent by `(instrument_id, effective_time, kind)`, so
 * re-syncing a symbol every day costs nothing and cannot duplicate an event.
 *
 * Returns how many were newly recorded — 0 is the normal steady state, not a failure.
 */
export function recordCorporateActions(
  actions: readonly CorporateAction[],
  evidenceByKey: Readonly<Record<string, string>> = {},
  now = new Date(),
): number {
  if (!corporateActionLedgerReady() || actions.length === 0) return 0;
  let recorded = 0;
  for (const action of actions) {
    const key = `${action.effectiveTime}|${action.kind}`;
    try {
      const result = getDb()
        .insert(schema.corporateActions)
        .values({
          instrumentId: action.instrumentId,
          effectiveTime: action.effectiveTime,
          kind: action.kind,
          ratio: action.ratio,
          amount: action.amount,
          source: action.source,
          evidence: evidenceByKey[key] ?? null,
          recordedAt: now,
        })
        .onConflictDoNothing()
        .run();
      recorded += result.changes > 0 ? 1 : 0;
    } catch {
      // A single malformed action must not cost the rest of the sync.
    }
  }
  return recorded;
}

/** Every recorded action for an instrument, oldest first. Empty when the ledger is absent. */
export function actionsFor(instrumentId: string): CorporateAction[] {
  if (!corporateActionLedgerReady()) return [];
  return getDb()
    .select()
    .from(schema.corporateActions)
    .where(eq(schema.corporateActions.instrumentId, instrumentId))
    .orderBy(asc(schema.corporateActions.effectiveTime))
    .all()
    .map((row) => ({
      instrumentId: row.instrumentId,
      effectiveTime: row.effectiveTime,
      kind: row.kind === "DIVIDEND" ? ("DIVIDEND" as const) : ("SPLIT" as const),
      ratio: row.ratio,
      amount: row.amount,
      source: row.source,
    }));
}

/** All actions, grouped by instrument — one read for a whole-universe normalization pass. */
export function actionsByInstrument(): Map<string, CorporateAction[]> {
  const grouped = new Map<string, CorporateAction[]>();
  if (!corporateActionLedgerReady()) return grouped;
  for (const row of getDb()
    .select()
    .from(schema.corporateActions)
    .orderBy(asc(schema.corporateActions.effectiveTime))
    .all()) {
    const list = grouped.get(row.instrumentId) ?? [];
    list.push({
      instrumentId: row.instrumentId,
      effectiveTime: row.effectiveTime,
      kind: row.kind === "DIVIDEND" ? "DIVIDEND" : "SPLIT",
      ratio: row.ratio,
      amount: row.amount,
      source: row.source,
    });
    grouped.set(row.instrumentId, list);
  }
  return grouped;
}

export interface ActionSyncReport {
  instruments: number;
  recorded: number;
  failed: number;
  errors: string[];
}

export type ActionFetcher = (
  providerSymbol: string,
  from: number,
  to: number,
) => Promise<
  readonly { effectiveTime: number; kind: "SPLIT" | "DIVIDEND"; ratio: number | null; amount: number | null; evidence: string }[]
>;

const defaultFetcher: ActionFetcher = (symbol, from, to) => getYahooCorporateActions(symbol, from, to);

/**
 * Pull declared corporate actions for a set of instruments into the ledger.
 *
 * Injectable fetcher for the same reason the accumulator's is: a cycle test that reaches the
 * network is a test of the network. Reference data, so a slow lane — this is not on any render
 * path and nothing waits for it.
 */
export async function syncCorporateActions(
  instruments: readonly Instrument[],
  from: number,
  to: number,
  fetchActions: ActionFetcher = defaultFetcher,
): Promise<ActionSyncReport> {
  const report: ActionSyncReport = { instruments: 0, recorded: 0, failed: 0, errors: [] };
  for (const instrument of instruments) {
    report.instruments += 1;
    try {
      const fetched = await fetchActions(instrument.providerSymbol, from, to);
      const evidence: Record<string, string> = {};
      const actions: CorporateAction[] = fetched.map((item) => {
        evidence[`${item.effectiveTime}|${item.kind}`] = item.evidence;
        return {
          instrumentId: instrument.id,
          effectiveTime: item.effectiveTime,
          kind: item.kind,
          ratio: item.ratio,
          amount: item.amount,
          source: "yahoo:events",
        };
      });
      report.recorded += recordCorporateActions(actions, evidence);
    } catch (caught) {
      report.failed += 1;
      report.errors.push(
        `${instrument.id}: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
      );
    }
  }
  return report;
}

/** A step in the stored series that no market move plausibly explains. */
export interface Discontinuity {
  instrumentId: string;
  /** The first bar on the far side of the step — the candidate effective time. */
  effectiveTime: number;
  previousClose: number;
  close: number;
  /** previousClose / close. A 1:2 split reads ~2.0; a 1:10 reads ~10.0. */
  observedRatio: number;
  /** True when the PRIOR bar had no volume: a stale placeholder, not a corporate action. */
  staleJunction: boolean;
}

/**
 * Where the stored series steps, found from our own prices.
 *
 * This is what makes the repair tractable. Syncing corporate actions for every instrument would
 * be ~2,000 provider calls for a defect that touches a few dozen; the store already knows exactly
 * where its own series break, so it selects the work.
 *
 * Two sources, deliberately kept apart: this is an INFERENCE from prices, while the provider's
 * event feed is a DECLARATION. `normalizeSeries` only adjusts where the two agree, so neither is
 * trusted alone.
 *
 * `staleJunction` marks the other cause of a large step — a run of zero-volume placeholder bars
 * followed by the first real print. That is not a corporate action and must never be "corrected"
 * into one.
 */
export function detectDiscontinuities(resolution: string, threshold = 0.4): Discontinuity[] {
  const rows = getDb()
    .select()
    .from(schema.priceCandles)
    .where(eq(schema.priceCandles.resolution, resolution))
    .orderBy(asc(schema.priceCandles.ticker), asc(schema.priceCandles.time))
    .all();

  const found: Discontinuity[] = [];
  let previous: (typeof rows)[number] | null = null;
  for (const row of rows) {
    if (previous !== null && previous.ticker === row.ticker && previous.close > 0) {
      const change = Math.abs(row.close - previous.close) / previous.close;
      if (change > threshold) {
        found.push({
          instrumentId: row.ticker,
          effectiveTime: row.time,
          previousClose: previous.close,
          close: row.close,
          observedRatio: previous.close / row.close,
          staleJunction: !previous.volume,
        });
      }
    }
    previous = row;
  }
  return found;
}

/**
 * The instruments whose stored series break in a way a corporate action would explain.
 *
 * Stale junctions are excluded: their step is an ingestion artifact, and asking the provider about
 * them would invite a wrong correction.
 */
export function instrumentsNeedingActions(resolution: string, threshold = 0.4): string[] {
  return [
    ...new Set(
      detectDiscontinuities(resolution, threshold)
        .filter((item) => !item.staleJunction)
        .map((item) => item.instrumentId),
    ),
  ].sort();
}

/**
 * Ratios a share-count change plausibly takes.
 *
 * Indian issuers use BONUS issues heavily, and Yahoo does not report them in `events.splits` for
 * `.NS` symbols — 13 of the 26 instruments with a measured discontinuity had no declared split at
 * all, while their prices stepped by ~2.0, ~3.0 and ~4.0 (a 1:1, 2:1 or 3:1 bonus). Refusing to
 * recognise those would leave the defect in place for half the affected universe; inventing an
 * arbitrary ratio to make a series continuous would be fabrication.
 *
 * The middle is this list: a step is only ever inferred when it lands near a ratio a corporate
 * action actually produces. Anything else stays unexplained, and an unexplained seam quarantines
 * the instrument rather than being smoothed away.
 */
export const PLAUSIBLE_ACTION_RATIOS: readonly number[] = [
  1.5, 2, 2.5, 3, 4, 5, 6, 10, 20,
  // Reverse splits / consolidations raise the price, so before/after falls below 1.
  1 / 1.5, 0.5, 1 / 2.5, 1 / 3, 0.25, 0.2, 0.1,
];

/** The plausible ratio nearest `observed`, or null when none is within `tolerance`. */
export function nearestPlausibleRatio(observed: number, tolerance = 0.12): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of PLAUSIBLE_ACTION_RATIOS) {
    const distance = Math.abs(observed - candidate) / candidate;
    if (distance <= tolerance && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export interface InferenceReport {
  inferred: number;
  unexplained: { instrumentId: string; effectiveTime: number; observedRatio: number }[];
}

/**
 * Record share-count changes our own prices show but the provider never declared.
 *
 * Source is `detected:store`, deliberately distinct from `yahoo:events`: this is an INFERENCE
 * from prices, and the ledger keeps the difference in authority visible forever. A discontinuity
 * that matches no plausible ratio is returned as `unexplained` and nothing is recorded for it —
 * those instruments are the ones a snapshot must refuse to serve.
 */
export function inferActionsFromStore(
  resolution: string,
  now = new Date(),
  tolerance = 0.12,
): InferenceReport {
  const declared = actionsByInstrument();
  const report: InferenceReport = { inferred: 0, unexplained: [] };

  for (const item of detectDiscontinuities(resolution)) {
    if (item.staleJunction) continue;

    // Already declared near this boundary? The provider's word wins; nothing to infer.
    const known = (declared.get(item.instrumentId) ?? []).some(
      (action) => action.kind === "SPLIT" && Math.abs(action.effectiveTime - item.effectiveTime) <= 6 * 86_400,
    );
    if (known) continue;

    const ratio = nearestPlausibleRatio(item.observedRatio, tolerance);
    if (ratio === null) {
      report.unexplained.push({
        instrumentId: item.instrumentId,
        effectiveTime: item.effectiveTime,
        observedRatio: item.observedRatio,
      });
      continue;
    }
    report.inferred += recordCorporateActions(
      [
        {
          instrumentId: item.instrumentId,
          effectiveTime: item.effectiveTime,
          kind: "SPLIT",
          ratio,
          amount: null,
          source: "detected:store",
        },
      ],
      {
        [`${item.effectiveTime}|SPLIT`]:
          `inferred from a stored step of ${item.observedRatio.toFixed(4)} ` +
          `(${item.previousClose} -> ${item.close}); nearest plausible ratio ${ratio}. ` +
          "No provider event declared this — likely a bonus issue, which Yahoo does not report for .NS.",
      },
      now,
    );
  }
  return report;
}
