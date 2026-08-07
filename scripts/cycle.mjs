#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Run one learning cycle from the command line. Registered with the Windows Task Scheduler:
 *
 *   schtasks /create /tn "MarketPulse Cycle" ^
 *     /tr "D:\\software\\node22\\node.exe E:\\BoraTradingTool\\scripts\\cycle.mjs" ^
 *     /sc minute /mo 15 /f
 *
 * Bundles first because `scripts/cycle-entry.ts` imports through the `@/` alias, which plain Node
 * does not resolve — esbuild reads the mapping straight out of tsconfig.json. It is already a
 * devDependency (`esbuild.mcp.mjs` does the same for the MCP server), so this adds no dependency.
 * The rebuild costs roughly a tenth of a second against a cycle that takes seconds.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Task Scheduler starts a task in C:\Windows\System32, not in the project. `databasePath()`
// resolves against `process.cwd()`, so without this the scheduled cycle would quietly create and
// operate on a *second, empty* marketpulse.db inside System32 — running forever, learning nothing,
// and leaving the real database untouched.
process.chdir(ROOT);

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
process.exitCode = await runOneCycle(process.argv[2] ?? "scheduler");
