import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * An already-running server can be used instead of spawning one.
 *
 * `webServer` shells out to `npm run dev`, and on this Windows setup Playwright's spawn shell has
 * no `npm` on PATH — the suite failed with "'npm' is not recognized" before a single test ran. An
 * e2e suite that cannot start is worse than none: it reports nothing while looking like coverage,
 * which is exactly how UI regressions reach a screen with a green test run behind them.
 *
 * Set MARKETPULSE_E2E_BASE_URL to point at a server you started yourself.
 */
const externalBaseURL = process.env.MARKETPULSE_E2E_BASE_URL?.trim();
const port = Number(process.env.MARKETPULSE_E2E_PORT ?? 3100);
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;
const explicitDatabase = process.env.MARKETPULSE_E2E_DB_PATH;
const realBootstrap = process.env.MARKETPULSE_E2E_REAL_BOOTSTRAP === "1";
const testDatabase = explicitDatabase
  ?? path.join(process.cwd(), ".tmp", `playwright-${process.pid}.sqlite`);
// Tests that seed the store write to this file directly, so it must be the SAME file the server
// reads. That is guaranteed when this config spawns the server, or when the operator passed the
// external server's database path explicitly. An external server with an unknown database gets no
// path at all — the seeding tests then skip instead of writing bars into a file nothing reads.
if (externalBaseURL && !explicitDatabase) {
  delete process.env.MARKETPULSE_E2E_DB_PATH;
} else {
  process.env.MARKETPULSE_E2E_DB_PATH = testDatabase;
}
const serverCommand = process.env.CI
  ? `npm run start -- --port ${port}`
  : `npm run dev -- --port ${port}`;
const desktopViewport = {
  width: Number(process.env.MARKETPULSE_E2E_VIEWPORT_WIDTH ?? 1440),
  height: Number(process.env.MARKETPULSE_E2E_VIEWPORT_HEIGHT ?? 1000),
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  // Omitted entirely when an external server is supplied — Playwright must not try to spawn one
  // it was told not to manage.
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: serverCommand,
          url: `${baseURL}/api/ai/status`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: {
            MARKETPULSE_TEST_MODE: realBootstrap ? "0" : "1",
            MARKETPULSE_DB_PATH: testDatabase,
            QUANT_CORE_URL: "off",
            QUANT_CORE_ROOT: ".tmp/no-quant-core",
            ...(process.env.CI
              ? {}
              : { MARKETPULSE_NEXT_DIST_DIR: path.join(".tmp", `next-playwright-${process.pid}`) }),
          },
        },
      }),
});
