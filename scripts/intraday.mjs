#!/usr/bin/env node
/**
 * One minute of the intraday trader (IN1). Registered with the Windows Task Scheduler:
 *
 *   see docs/plans/fund-os/00-status.md for the task definition (every minute, weekdays 09:14-15:39 IST)
 *
 * Bundles like `scripts/cycle.mjs` (the `@/` alias needs esbuild) and runs from the repo root, so
 * each headless CLI finds the project's MCP config and the shared memory.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const outfile = path.join(ROOT, "dist", "scripts", "intraday-entry.mjs");
await build({ entryPoints: [path.join(ROOT, "scripts", "intraday-entry.ts")], outfile, bundle: true, packages: "external", platform: "node", target: "node22", format: "esm" });
const { runIntradayOnce } = await import(pathToFileURL(outfile).href);
process.exitCode = await runIntradayOnce(process.argv[2] ?? "intraday-scheduler");
