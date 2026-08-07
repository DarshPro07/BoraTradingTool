#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Run learning cycles on a loop until interrupted.
 *
 *   node scripts/daemon.mjs [minutes]
 *
 * This is the development convenience, not the durable driver. **It dies on reboot and does not
 * come back** — which is precisely why `AutonomyStrip` names the driver that ran last: a stopped
 * daemon and a healthy scheduler produce identical-looking run logs right up until the moment the
 * gap matters, and by then you have lost a day of cycles without being told.
 *
 * For autonomy that survives a restart, use `scripts/cycle.mjs` under the Task Scheduler.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const minutes = Number(process.argv[2] ?? 15);
if (!Number.isFinite(minutes) || minutes < 1) {
  process.stderr.write(`Interval must be at least 1 minute. Received: ${process.argv[2]}\n`);
  process.exit(1);
}
const intervalMs = minutes * 60_000;

const outfile = path.join(ROOT, "dist", "scripts", "cycle-entry.mjs");
await build({
  entryPoints: [path.join(ROOT, "scripts", "cycle-entry.ts")],
  outfile,
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node22",
  format: "esm",
});
const { runOneCycle } = await import(pathToFileURL(outfile).href);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    // Finish the cycle in flight rather than killing it mid-write. The lease would expire on its
    // own, but a half-written research job is a worse thing to leave behind than a ten-minute wait.
    process.stdout.write("\nStopping after the current cycle.\n");
    stopping = true;
  });
}

process.stdout.write(`Daemon started — one cycle every ${minutes} minute(s). Ctrl-C to stop.\n`);

while (!stopping) {
  await runOneCycle("daemon");
  if (stopping) break;
  // Sleep in short slices so Ctrl-C is honoured promptly instead of after a full interval.
  for (let waited = 0; waited < intervalMs && !stopping; waited += 1_000) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
