#!/usr/bin/env node
/**
 * Start the MarketPulse MCP server from anywhere — for Codex, Gemini and OpenCode, which launch
 * MCP servers from their own working directory. The server resolves the database, migrations and
 * reports against `process.cwd()`, so it runs as a child in the repository root with stdio passed
 * straight through. (Importing the bundle instead does nothing: it starts only as the main module.)
 * One launcher, one database: every model shares the same memory.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(ROOT, "dist", "mcp", "server.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    MARKETPULSE_DB_PATH: "marketpulse.db",
    QUANT_CORE_ROOT: "E:/Trading_BOT",
    QUANT_CORE_URL: "http://127.0.0.1:8787",
    ...process.env,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
