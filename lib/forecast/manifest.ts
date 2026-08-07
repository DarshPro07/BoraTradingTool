import { KRONOS_CHECKPOINTS, RELATIVE_FORECAST_DIR, type KronosCheckpoint } from "./kronos";

/**
 * The request side of the Kronos seam.
 *
 * The reader in `./kronos.ts` consumes forecasts. This produces the job list that says which
 * ones to make. Together they are the whole contract: a runner that satisfies this manifest and
 * writes files the reader accepts is finished, and nothing in this repository needs to change
 * when the weights are eventually downloaded.
 *
 * The manifest is validated here rather than in the runner, because the one mistake that is
 * invisible at runtime is asking for more lookback than the checkpoint can see. Kronos-small
 * and -base have a 512-token context; hand them 2000 bars and the model silently reads the last
 * 512, producing a forecast that looks like it used four years of history and used ten months.
 */

export interface ForecastRequest {
  instrumentId: string;
  /** Provider symbol, because the runner talks to the data source, not to our catalog. */
  providerSymbol: string;
  timeframe: string;
  checkpoint: KronosCheckpoint;
  /** Bars of history to feed the model. Never more than the checkpoint's context window. */
  lookbackBars: number;
  /** Bars to forecast forward. */
  horizonBars: number;
}

export interface ForecastManifest {
  version: 1;
  createdAt: string;
  /** Where the runner must write its output, relative to the quant core root. */
  outputDir: string;
  requests: ForecastRequest[];
  rejected: Array<{ instrumentId: string; reason: string }>;
}

export interface ManifestOptions {
  /**
   * Kronos-mini by default: 4.1M parameters and a 2048-bar context. It runs on CPU, and its
   * longer window suits daily bars — the bigger checkpoints buy capacity this system cannot
   * yet show it needs.
   */
  checkpoint?: KronosCheckpoint;
  timeframe?: string;
  lookbackBars?: number;
  horizonBars?: number;
  now?: Date;
}

export const DEFAULTS = Object.freeze({
  // Kronos-base at the owner's choice: 102.3M parameters, 512-bar context.
  //
  // Worth stating what the choice costs, because it is not free. `Kronos-mini` has a 2048-bar
  // context — four times the history — at 4.1M parameters. Base trades that reach for capacity,
  // so on daily bars it attends to roughly two years rather than eight.
  //
  // `lookbackBars` is 512 rather than the old value for exactly that reason: base cannot attend
  // past it, and asking for more is the one mistake invisible at runtime — the model silently
  // reads the last 512 and returns a forecast that looks like it used the whole window.
  checkpoint: "Kronos-base" as KronosCheckpoint,
  timeframe: "1d",
  lookbackBars: 512,
  horizonBars: 5,
});

/**
 * A horizon beyond this is not forecasting, it is fiction — autoregressive error compounds on
 * every step, and each generated bar is fed back in as though it were observed.
 */
export const MAX_HORIZON_BARS = 30;

export function buildForecastManifest(
  instruments: readonly { id: string; providerSymbol: string }[],
  options: ManifestOptions = {},
): ForecastManifest {
  const checkpoint = options.checkpoint ?? DEFAULTS.checkpoint;
  const timeframe = options.timeframe ?? DEFAULTS.timeframe;
  const horizonBars = options.horizonBars ?? DEFAULTS.horizonBars;
  const requestedLookback = options.lookbackBars ?? DEFAULTS.lookbackBars;
  const now = options.now ?? new Date();

  const spec = KRONOS_CHECKPOINTS[checkpoint];
  const requests: ForecastRequest[] = [];
  const rejected: Array<{ instrumentId: string; reason: string }> = [];

  // Clamped once, up front, so every request in the manifest is honest about what the model
  // will actually read. Silently truncating inside the runner is the failure this prevents.
  const lookbackBars = Math.min(requestedLookback, spec.contextLength);

  if (horizonBars < 1 || horizonBars > MAX_HORIZON_BARS) {
    return {
      version: 1,
      createdAt: now.toISOString(),
      outputDir: RELATIVE_FORECAST_DIR,
      requests: [],
      rejected: instruments.map((instrument) => ({
        instrumentId: instrument.id,
        reason: `Horizon ${horizonBars} is outside 1..${MAX_HORIZON_BARS}. Autoregressive error compounds each step; beyond that the later bars are generated from generated bars.`,
      })),
    };
  }

  const seen = new Set<string>();
  for (const instrument of instruments) {
    if (seen.has(instrument.id)) {
      rejected.push({ instrumentId: instrument.id, reason: "Duplicate request in the same manifest." });
      continue;
    }
    if (!instrument.providerSymbol?.trim()) {
      rejected.push({ instrumentId: instrument.id, reason: "No provider symbol; the runner would have nothing to fetch." });
      continue;
    }
    seen.add(instrument.id);
    requests.push({
      instrumentId: instrument.id,
      providerSymbol: instrument.providerSymbol,
      timeframe,
      checkpoint,
      lookbackBars,
      horizonBars,
    });
  }

  return { version: 1, createdAt: now.toISOString(), outputDir: RELATIVE_FORECAST_DIR, requests, rejected };
}

/** True when the request asked for more history than the chosen checkpoint can attend to. */
export function wasLookbackClamped(options: ManifestOptions = {}): boolean {
  const checkpoint = options.checkpoint ?? DEFAULTS.checkpoint;
  return (options.lookbackBars ?? DEFAULTS.lookbackBars) > KRONOS_CHECKPOINTS[checkpoint].contextLength;
}
