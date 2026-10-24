#!/usr/bin/env node
/**
 * The owner's side of the cloud clock: `node scripts/ledger.mjs status|cutover|pull|promote`.
 * See scripts/ledger-entry.ts. Bundles like `scripts/intraday.mjs` and runs from the repo root.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const outfile = path.join(ROOT, "dist", "scripts", "ledger-entry.mjs");
await build({ entryPoints: [path.join(ROOT, "scripts", "ledger-entry.ts")], outfile, bundle: true, packages: "external", platform: "node", target: "node22", format: "esm" });
const { runLedger } = await import(pathToFileURL(outfile).href);
process.exitCode = await runLedger(process.argv[2] ?? "", process.argv.slice(3));
