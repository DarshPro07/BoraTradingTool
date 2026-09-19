#!/usr/bin/env node
/**
 * One agent-conductor pass. Registered with the Windows Task Scheduler:
 *
 *   schtasks /create /tn "MarketPulse Agents" /tr "D:\software\node.exe E:\BoraTradingTool\scripts\agents.mjs" /sc minute /mo 30 /f
 *
 * Bundles like `scripts/cycle.mjs` (the `@/` alias needs esbuild) and runs from the repo root, so
 * each headless CLI finds the project's MCP config and the shared memory.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const outfile = path.join(ROOT, "dist", "scripts", "agents-entry.mjs");
await build({ entryPoints: [path.join(ROOT, "scripts", "agents-entry.ts")], outfile, bundle: true, packages: "external", platform: "node", target: "node22", format: "esm" });
const { runAgentsPass } = await import(pathToFileURL(outfile).href);
process.exitCode = await runAgentsPass(process.argv[2] ?? "agents-scheduler");
