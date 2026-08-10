/**
 * Writes the Kronos job list, with the bars already attached.
 *
 * ## Why the bars travel with the manifest
 *
 * `docs/KRONOS_RUNNER.md` describes a manifest carrying `providerSymbol`, on the assumption that
 * the runner talks to the data source itself. That made sense when the quant core was a separate
 * service at `E:/Trading_BOT`. It is not — that directory does not exist, and the Python side is
 * a script in this repository.
 *
 * So the runner fetching its own bars would mean a second data layer: a second set of provider
 * credentials, a second cache, a second definition of "the last 512 daily bars", and two
 * components that can silently disagree about what today's close was. Attaching the bars here
 * means the model sees exactly the series the backtester sees.
 *
 * `providerSymbol` is still written, so a future fetching runner remains possible. This is
 * additive, not a replacement.
 *
 * Usage:  npx tsx scripts/forecast-manifest.mts [count]
 */
import fs from "node:fs";
import path from "node:path";
import { buildForecastManifest } from "@/lib/forecast/manifest";
import { quantCoreRoot } from "@/lib/quantcore/filesystem";
import { fetchInstrumentBars } from "@/lib/learning/dataset";
import { listCurrentInstruments } from "@/lib/market/catalog";

const count = Number(process.argv[2] ?? "6");
const instruments = listCurrentInstruments({ exchange: "XNSE" }).slice(
  0,
  Number.isFinite(count) ? Math.max(1, count) : 6,
);

const manifest = buildForecastManifest(
  instruments.map((item) => ({ id: item.id, providerSymbol: item.providerSymbol })),
);

const withBars: Array<Record<string, unknown>> = [];
const unfetchable: Array<{ instrumentId: string; reason: string }> = [];

for (const request of manifest.requests) {
  const instrument = instruments.find((item) => item.id === request.instrumentId);
  if (!instrument) continue;

  let bars: readonly { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  try {
    bars = await fetchInstrumentBars(instrument, "D");
  } catch (caught) {
    unfetchable.push({
      instrumentId: request.instrumentId,
      reason: caught instanceof Error ? caught.message.split("\n")[0] : String(caught),
    });
    continue;
  }

  // Fewer bars than asked for is not an error — it is a shorter history, and the runner is told
  // the true number so it never reports a lookback it did not have. Silently padding, or
  // reporting the requested figure, is how `contextOverrun` stops meaning anything.
  const window = bars.slice(-request.lookbackBars);
  if (window.length < 64) {
    unfetchable.push({
      instrumentId: request.instrumentId,
      reason: `Only ${window.length} bar(s) available; below the 64 needed for a forecast worth scoring.`,
    });
    continue;
  }

  withBars.push({ ...request, lookbackBars: window.length, bars: window });
}

const outputPath = path.join(quantCoreRoot(), "forecast-manifest.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    { ...manifest, requests: withBars, rejected: [...manifest.rejected, ...unfetchable] },
    null,
    2,
  ),
);

console.log(`Wrote ${withBars.length} request(s) to ${outputPath}`);
for (const entry of [...manifest.rejected, ...unfetchable]) {
  console.log(`  rejected ${entry.instrumentId}: ${entry.reason}`);
}
