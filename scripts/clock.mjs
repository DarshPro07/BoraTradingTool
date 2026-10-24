#!/usr/bin/env node
/**
 * The cloud clock (docs/plans/cloud-clock): `node scripts/clock.mjs run|watchdog`, on a GitHub runner.
 * Bundles like `scripts/intraday.mjs` (the `@/` alias needs esbuild) and runs from the repo root.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const outfile = path.join(ROOT, "dist", "scripts", "clock-entry.mjs");
await build({ entryPoints: [path.join(ROOT, "scripts", "clock-entry.ts")], outfile, bundle: true, packages: "external", platform: "node", target: "node22", format: "esm" });
const { runCloudClock } = await import(pathToFileURL(outfile).href);
process.exitCode = await runCloudClock(process.argv[2] ?? "");
