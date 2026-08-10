import fs from "node:fs";
import path from "node:path";
import { quantCoreRoot } from "@/lib/quantcore/filesystem";
import { RELATIVE_FORECAST_DIR } from "./kronos";
import { FORECAST_GATES, scoreForecast, type ForecastScoreResult, type ScoredBar } from "./score";

/**
 * The live-validation loop for the forecaster.
 *
 * ## Why this file had to exist for any of it to mean anything
 *
 * `scoreForecast` was written, correct and rigorous — paired against persistence, bootstrapped,
 * seeded — and **nothing ever called it**. The runner wrote one file per instrument and
 * overwrote it on the next pass, so by the time a prediction could be graded it had already been
 * replaced by a newer one. There was no mechanical path from "a forecast was made" to "was it
 * right", which is why `data-quality` could report coverage and never a verdict.
 *
 * ## Why this is the only honest evidence available cheaply
 *
 * Every other number in this system is computed over history the model or strategy was selected
 * on. This one is not: the prediction is on disk before the outcome exists, and the outcome
 * cannot be re-selected. Lookahead is structurally impossible here rather than guarded against —
 * which is a stronger property than any backtest can offer, and it costs no capital and places
 * no order.
 *
 * ## Pooling, and the invariant it must not break
 *
 * A single forecast is four or five bars; `FORECAST_GATES.minScoredBars` is 30. So bars are
 * pooled across runs before a verdict is possible, and `scoreForecast` is handed one
 * `generatedAt` for bars that came from many. That is safe **only** because every bar is checked
 * against its own forecast's timestamp here, before pooling. Skipping that check would let one
 * stale archive entry contribute a bar that was already history when it was written — the exact
 * failure the scorer's own guard exists to catch.
 */

const HISTORY_DIR = "history";
const LEDGER = "scores.jsonl";

export interface ArchivedForecast {
  file: string;
  instrumentId: string;
  timeframe: string;
  generatedAt: string;
  bars: readonly (ScoredBar & { time: number })[];
}

export interface LiveScoreReport {
  /** Archived forecasts whose bars have all resolved and which were graded this pass. */
  scored: number;
  /** Still waiting for the market to produce their bars. */
  pending: number;
  scoredBars: number;
  droppedAsLookahead: number;
  /** Null until enough bars have accumulated for the gate to permit a claim. */
  verdict: ForecastScoreResult | null;
  reason: string;
}

export type BarLoader = (instrumentId: string, timeframe: string) => Promise<readonly ScoredBar[]>;

function historyDir(root: string): string {
  return path.join(root, RELATIVE_FORECAST_DIR, HISTORY_DIR);
}

function ledgerPath(root: string): string {
  return path.join(root, RELATIVE_FORECAST_DIR, LEDGER);
}

/** Filesystem-safe, and stable for a given run so re-archiving the same run is a no-op. */
function archiveName(instrumentId: string, timeframe: string, generatedAt: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe(instrumentId)}_${safe(timeframe)}_${safe(generatedAt)}.json`;
}

/**
 * Copies a forecast somewhere the next run will not overwrite it.
 *
 * Keyed on `generatedAt`, so the fifteen-minute cycle re-archiving an unchanged file costs
 * nothing, while a genuinely new run is kept separately.
 */
export function archiveForecast(
  forecast: { instrumentId: string; timeframe: string; generatedAt: string; bars: readonly ScoredBar[] },
  root = quantCoreRoot(),
): string {
  const directory = historyDir(root);
  fs.mkdirSync(directory, { recursive: true });

  const target = path.join(
    directory,
    archiveName(forecast.instrumentId, forecast.timeframe, forecast.generatedAt),
  );
  if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(forecast, null, 2));
  return target;
}

function scoredAlready(root: string): Set<string> {
  try {
    return new Set(
      fs
        .readFileSync(ledgerPath(root), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { file: string }).file),
    );
  } catch {
    return new Set();
  }
}

/** Archived forecasts that have not yet been graded. */
export function pendingForecasts(root = quantCoreRoot()): ArchivedForecast[] {
  const directory = historyDir(root);
  let names: string[];
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const done = scoredAlready(root);
  const pending: ArchivedForecast[] = [];

  for (const name of names) {
    if (done.has(name)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as ArchivedForecast;
      if (parsed?.bars?.length) pending.push({ ...parsed, file: name });
    } catch {
      // A corrupt archive entry is skipped rather than failing the pass. It stays on disk, so it
      // is still inspectable — deleting evidence because it would not parse is how a record of a
      // bad run disappears.
    }
  }
  return pending;
}

/**
 * Grades every archived forecast whose bars have resolved, and reports the pooled verdict.
 *
 * A forecast is only graded once **all** of its bars have actuals. Grading a partially-resolved
 * forecast would let its easy near-term bars count while its harder later ones were still
 * outstanding, and the pool would drift optimistic exactly as the horizon extended.
 */
export async function scoreDueForecasts(
  loadBars: BarLoader,
  root = quantCoreRoot(),
): Promise<LiveScoreReport> {
  const pending = pendingForecasts(root);
  if (pending.length === 0) {
    return { scored: 0, pending: 0, scoredBars: 0, droppedAsLookahead: 0, verdict: null, reason: "No forecasts are awaiting a grade." };
  }

  const actualsFor = new Map<string, readonly ScoredBar[]>();
  const pooledPredicted: ScoredBar[] = [];
  const pooledActual: ScoredBar[] = [];
  const graded: string[] = [];
  let dropped = 0;
  let stillPending = 0;
  let loadFailure: string | null = null;

  for (const item of pending) {
    const key = `${item.instrumentId}|${item.timeframe}`;
    if (!actualsFor.has(key)) {
      try {
        actualsFor.set(key, await loadBars(item.instrumentId, item.timeframe));
      } catch (caught) {
        // Refused, not thrown, and the archive is left intact: a provider outage must not destroy
        // pending predictions, which are the only unbiased evidence this system has.
        loadFailure = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
        actualsFor.set(key, []);
      }
    }

    const actual = actualsFor.get(key) ?? [];
    const byTime = new Map(actual.map((bar) => [bar.time, bar.close]));

    // Every bar resolved, or the forecast waits. Partial grading drifts optimistic.
    if (!item.bars.every((bar) => byTime.has(bar.time))) {
      stillPending += 1;
      continue;
    }

    const generatedMs = Date.parse(item.generatedAt);
    const honest = item.bars.filter((bar) => {
      const ahead = bar.time * 1000 > generatedMs;
      if (!ahead) dropped += 1;
      return ahead;
    });

    if (honest.length === 0) {
      // Nothing scoreable, but it has been examined — recorded as graded so it is not retried
      // every pass forever.
      graded.push(item.file);
      continue;
    }

    pooledPredicted.push(...honest);
    for (const bar of actual) pooledActual.push(bar);
    graded.push(item.file);
  }

  const scoredBars = pooledPredicted.length;
  let verdict: ForecastScoreResult | null = null;

  if (scoredBars >= FORECAST_GATES.minScoredBars) {
    // The pool's earliest timestamp. Safe as the shared `generatedAt` precisely because every bar
    // above was already checked against its own forecast's timestamp.
    const earliest = pending
      .filter((item) => graded.includes(item.file))
      .reduce((min, item) => Math.min(min, Date.parse(item.generatedAt)), Number.POSITIVE_INFINITY);

    verdict = scoreForecast(
      { generatedAt: new Date(earliest).toISOString(), bars: dedupeByTime(pooledPredicted) },
      dedupeByTime(pooledActual),
    );
  }

  appendLedger(root, graded, verdict);

  const reason = loadFailure
    ? `Bars could not be loaded for at least one instrument: ${loadFailure}. Nothing was discarded; the archive is intact.`
    : scoredBars < FORECAST_GATES.minScoredBars
      ? `${scoredBars} bar(s) have resolved. A verdict needs ${FORECAST_GATES.minScoredBars}; below that, directional accuracy is a coin-flip estimate with a huge standard error.`
      : (verdict as { reason?: string })?.reason ?? "Scored.";

  return { scored: graded.length, pending: stillPending, scoredBars, droppedAsLookahead: dropped, verdict, reason };
}

/**
 * Bars pooled from overlapping forecast windows can repeat a timestamp. Left in, a duplicated bar
 * would be counted twice by the bootstrap and narrow the confidence interval on evidence that was
 * never independent.
 */
function dedupeByTime(bars: readonly ScoredBar[]): ScoredBar[] {
  const seen = new Map<number, ScoredBar>();
  for (const bar of bars) if (!seen.has(bar.time)) seen.set(bar.time, bar);
  return [...seen.values()].sort((a, b) => a.time - b.time);
}

/**
 * Archives whatever the runner last wrote, so the next run cannot destroy it.
 *
 * Idempotent per run, so calling this every cycle is free.
 *
 * Returns the **total** awaiting a grade, not how many this call added. The scheduled cycle and a
 * manual run overlap freely — during development the scheduler archived ten of twelve new
 * forecasts a second before a manual pass picked up the remaining two, which truthfully reported
 * "archived 2" and read as though only two existed. A delta between two concurrent writers is not
 * a fact about the system; the total is.
 */
export function archiveCurrentForecasts(root = quantCoreRoot()): number {
  const directory = path.join(root, RELATIVE_FORECAST_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return pendingForecasts(root).length;
  }

  for (const name of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as ArchivedForecast;
      if (parsed?.instrumentId && parsed?.generatedAt && parsed?.bars?.length) {
        archiveForecast(parsed, root);
      }
    } catch {
      // Unparseable output is left where it is rather than archived. Grading a file the reader
      // would itself refuse would put a number on something nothing else accepts.
    }
  }
  return pendingForecasts(root).length;
}

/** Append-only. A score that can be rewritten is not a record of anything. */
function appendLedger(root: string, files: readonly string[], verdict: ForecastScoreResult | null): void {
  if (files.length === 0) return;
  const directory = path.join(root, RELATIVE_FORECAST_DIR);
  fs.mkdirSync(directory, { recursive: true });

  const at = new Date().toISOString();
  const lines = files
    .map((file) =>
      JSON.stringify({
        file,
        scoredAt: at,
        verdict: verdict && verdict.ok ? verdict.verdict : null,
        scoredBars: verdict?.scoredBars ?? 0,
      }),
    )
    .join("\n");
  fs.appendFileSync(ledgerPath(root), `${lines}\n`);
}
