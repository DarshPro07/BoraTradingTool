import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    // `e2e/lib/**` holds test INFRASTRUCTURE (route derivation, session helpers), not browser
    // specs, and infrastructure that decides what gets tested must itself be tested — a broken
    // route walk would silently empty the Playwright matrix. The repo's convention keeps the two
    // runners apart by extension: Playwright owns `*.spec.ts`, vitest owns `*.test.ts`, so this
    // glob cannot pick up a browser spec.
    // `tests/invariants/**` holds the SYSTEM INVARIANT SUITE: a deliberately small set of claims
    // that must never be false, each exercised through the real production composition rather than
    // against mocked collaborators. It is separated from the unit suite so that "2,035 tests green"
    // can never be read as "the scientific guarantees hold" — three P0-class defects in one day
    // escaped precisely because every unit passed while the wire between them was never run.
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "mcp/**/*.test.ts",
      "e2e/lib/**/*.test.ts",
      "tests/invariants/**/*.test.ts",
    ],
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
