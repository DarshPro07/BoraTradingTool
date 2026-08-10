import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "mcp/**/*.test.ts"],
    // Process isolation per file. Many suites mutate process.env (MARKETPULSE_DB_PATH,
    // QUANT_CORE_ROOT, MARKETPULSE_TEST_MODE); under the default threads pool env is
    // process-global, so parallel files raced each other's environments — the captured flakes
    // (mcp integration failing in 208ms, forecast/live timing out) were exactly that race.
    // Forks are slower but correct; a flaky test is a defect, and this is the root.
    pool: "forks",
    // 5s is too tight for this repo's DB-heavy suites under forks (which are correct but slower
    // than threads). Three separate files were caught by the JSON flake capture failing at
    // 6.3–7.8s — all timeouts, none logic. One global ceiling beats patching suites one at a
    // time; a test that genuinely hangs still fails, thirty seconds later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
