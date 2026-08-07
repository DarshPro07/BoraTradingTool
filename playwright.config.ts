import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const testDatabase = process.env.MARKETPULSE_E2E_DB_PATH
  ?? path.join(process.cwd(), ".tmp", `playwright-${process.pid}.sqlite`);
process.env.MARKETPULSE_E2E_DB_PATH = testDatabase;
const serverCommand = process.env.CI
  ? `npm run start -- --port ${port}`
  : `npm run dev -- --port ${port}`;

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
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: serverCommand,
    url: `${baseURL}/api/ai/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      MARKETPULSE_TEST_MODE: "1",
      MARKETPULSE_DB_PATH: testDatabase,
      QUANT_CORE_URL: "off",
      QUANT_CORE_ROOT: ".tmp/no-quant-core",
    },
  },
});
