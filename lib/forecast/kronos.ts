import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { quantCoreRoot } from "@/lib/quantcore/filesystem";

/**
 * Kronos forecast intake — see docs/adr/0004-kronos-forecast-intake.md.
 *
 * Kronos (MIT, AAAI 2026) is a PyTorch foundation model over candlestick tokens. It cannot run
 * in this process and is not meant to: the model lives in the Python quant core, and forecasts
 * arrive here as files, like every other quant resource.
 *
 * The frozen contract in `lib/quantcore/contract.ts` is shared with that agent and cannot gain
 * a resource unilaterally, so this reader mirrors its discipline rather than joining its union:
 * typed refusal on absence, Zod validation on presence, and never a fabricated default.
 *
 * The one rule worth stating twice: **a forecast is not evidence.** Every reading is stamped
 * `not_forward_validated` by this module, not by the file it read — a producer must not be able
 * to upgrade its own epistemic standing by writing a different string.
 */

export const KRONOS_CHECKPOINTS = Object.freeze({
  "Kronos-mini": { parameters: 4_100_000, contextLength: 2048 },
  "Kronos-small": { parameters: 24_700_000, contextLength: 512 },
  "Kronos-base": { parameters: 102_300_000, contextLength: 512 },
});
export type KronosCheckpoint = keyof typeof KRONOS_CHECKPOINTS;

export const RELATIVE_FORECAST_DIR = "data/forecasts/kronos";

const BarSchema = z.object({
  /** Unix seconds at the *open* of the forecast bar. */
  time: z.number().int().positive(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().finite().nonnegative(),
});

const FileSchema = z.object({
  instrumentId: z.string().min(1),
  timeframe: z.string().min(1),
  checkpoint: z.string().min(1),
  /** When the producer ran the model. Everything at or before this is not a forecast. */
  generatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "unparseable timestamp"),
  /** Bars of history fed to the model, so a context overrun is detectable rather than silent. */
  lookbackBars: z.number().int().positive(),
  bars: z.array(BarSchema).min(1),
});

export interface KronosForecast extends z.infer<typeof FileSchema> {
  /** Set here, never read from the file. */
  epistemicStatus: "not_forward_validated";
  /** True when `lookbackBars` exceeded the checkpoint's context window. */
  contextOverrun: boolean;
  source: string;
}

export type ForecastErrorCode =
  | "RESOURCE_NOT_PROVIDED"
  | "RESOURCE_MALFORMED"
  | "RESOURCE_STALE"
  | "UNKNOWN_CHECKPOINT";

export interface ForecastFailure {
  ok: false;
  code: ForecastErrorCode;
  message: string;
  retrievedAt: string;
  source: string;
}

export interface ForecastSuccess {
  ok: true;
  data: KronosForecast;
  retrievedAt: string;
  ageMs: number;
  stale: boolean;
  source: string;
}

export type ForecastResult = ForecastSuccess | ForecastFailure;

/** A forecast older than its own horizon is describing bars that have already happened. */
export const FORECAST_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function forecastPath(instrumentId: string, timeframe: string, root = quantCoreRoot()): string {
  // Instrument ids and timeframes come from the catalog, but this path is handed to the
  // filesystem, so anything outside the expected alphabet is replaced rather than trusted.
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(root, RELATIVE_FORECAST_DIR, `${safe(instrumentId)}_${safe(timeframe)}.json`);
}

export interface KronosCoverage {
  available: boolean;
  /** Relative path, so the screen never prints an absolute path from another machine. */
  directory: string;
  files: number;
  instruments: string[];
  reason: string;
}

/**
 * Whether the producer produces anything at all. Asked separately from any single forecast,
 * because "no forecast for AAPL" and "the model has never run here" are different problems and
 * only one of them is worth acting on.
 */
export function kronosCoverage(root = quantCoreRoot()): KronosCoverage {
  const directory = path.join(root, RELATIVE_FORECAST_DIR);
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return {
      available: false,
      directory: RELATIVE_FORECAST_DIR,
      files: 0,
      instruments: [],
      reason: `${RELATIVE_FORECAST_DIR} does not exist under the quant core. Kronos is a PyTorch model and runs there, not here — no forecast has ever been delivered to this deployment.`,
    };
  }

  const files = entries.filter((name) => name.endsWith(".json"));
  return {
    available: files.length > 0,
    directory: RELATIVE_FORECAST_DIR,
    files: files.length,
    instruments: files.map((name) => name.replace(/\.json$/, "")).slice(0, 50),
    reason: files.length
      ? `${files.length} forecast file(s) delivered. Each is not_forward_validated until scored against persistence.`
      : `${RELATIVE_FORECAST_DIR} exists but is empty.`,
  };
}

export function readKronosForecast(
  instrumentId: string,
  timeframe = "1d",
  root = quantCoreRoot(),
  now = Date.now(),
): ForecastResult {
  const absolute = forecastPath(instrumentId, timeframe, root);
  const source = `${RELATIVE_FORECAST_DIR}/${path.basename(absolute)}`;
  const retrievedAt = new Date(now).toISOString();

  let raw: string;
  try {
    raw = fs.readFileSync(absolute, "utf8");
  } catch {
    return {
      ok: false,
      code: "RESOURCE_NOT_PROVIDED",
      message: `No Kronos forecast for ${instrumentId} at ${timeframe}. The model runs in the Python quant core; this deployment produces none itself.`,
      retrievedAt,
      source,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, code: "RESOURCE_MALFORMED", message: "Forecast file is not valid JSON.", retrievedAt, source };
  }

  const parsed = FileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, code: "RESOURCE_MALFORMED", message: parsed.error.message, retrievedAt, source };
  }

  const checkpoint = KRONOS_CHECKPOINTS[parsed.data.checkpoint as KronosCheckpoint];
  if (!checkpoint) {
    return {
      ok: false,
      code: "UNKNOWN_CHECKPOINT",
      message: `"${parsed.data.checkpoint}" is not a published Kronos checkpoint. Refusing rather than guessing its context window.`,
      retrievedAt,
      source,
    };
  }

  // A file claiming to be for another instrument is a producer bug, and silently accepting it
  // would attach one instrument's forecast to another's chart.
  if (parsed.data.instrumentId !== instrumentId) {
    return {
      ok: false,
      code: "RESOURCE_MALFORMED",
      message: `File is for ${parsed.data.instrumentId}, not ${instrumentId}.`,
      retrievedAt,
      source,
    };
  }

  const generatedMs = Date.parse(parsed.data.generatedAt);
  const ageMs = Math.max(0, now - generatedMs);

  return {
    ok: true,
    data: {
      ...parsed.data,
      epistemicStatus: "not_forward_validated",
      contextOverrun: parsed.data.lookbackBars > checkpoint.contextLength,
      source,
    },
    retrievedAt,
    ageMs,
    stale: ageMs > FORECAST_FRESHNESS_MS,
    source,
  };
}
