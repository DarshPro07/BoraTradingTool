import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PRIMARY_ROUTES = [
  "/command",
  "/dashboard",
  "/scanner",
  "/analyst",
  "/analyze/US%3AXNAS%3AAAPL",
  "/edge-factory",
  "/strategies",
  "/experiments",
  "/library",
  "/memory",
  "/paper",
  "/portfolio",
  "/learning",
  "/jobs",
  "/data-quality",
  "/audit",
  "/settings",
] as const;

function trackRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test("all primary screens render without runtime errors", async ({ page }) => {
  const runtimeErrors = trackRuntimeErrors(page);

  for (const route of PRIMARY_ROUTES) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("body"), route).not.toContainText("Application error");
    await expect(page.getByText("PAPER", { exact: true }).first(), route).toBeVisible();
    await expectNoPageOverflow(page);
  }

  expect(runtimeErrors).toEqual([]);
});

test("market selector and instrument search preserve canonical navigation", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "NSE", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?market=NSE/);
  await expect(page.getByRole("heading", { name: "NSE India" })).toBeVisible();

  await page.getByLabel("Search instrument").fill("IN:XNSE:RELIANCE");
  await page.getByRole("button", { name: "OPEN", exact: true }).click();
  await expect(page).toHaveURL(/\/analyze\/IN%3AXNSE%3ARELIANCE/);
  await expect(page.locator("body")).toContainText("RELIANCE");
});

/**
 * These two tests need the fixtures that `MARKETPULSE_TEST_MODE=1` installs, which the managed
 * `webServer` sets and an externally-started dev server does not. Run against a normal server they
 * fail for the wrong reason — a red suite that says nothing about the application.
 *
 * Skipped with a stated reason rather than loosened: an assertion relaxed until it passes in both
 * environments would stop testing the fixture path in either.
 */
const usesExternalServer = Boolean(process.env.MARKETPULSE_E2E_BASE_URL?.trim());
const fixtureOnly = usesExternalServer
  ? "requires MARKETPULSE_TEST_MODE fixtures; the external server under test does not run in test mode"
  : false;

test("AI desk returns cited fixture analysis", async ({ page }) => {
  test.skip(Boolean(fixtureOnly), String(fixtureOnly));
  await page.goto("/ai");
  await expect(page.getByRole("heading", { name: "AI Research Desk" })).toBeVisible();
  await page.getByRole("button", { name: "RUN EVIDENCE REVIEW" }).click();
  await expect(page.getByText("Citations", { exact: true })).toBeVisible();
  await expect(page.getByText(/confidence/i).first()).toBeVisible();
  await expect(page.locator(".evidence-row").first()).toBeVisible();
});

test("paper order stays in the simulated ledger", async ({ page }) => {
  test.skip(Boolean(fixtureOnly), String(fixtureOnly));
  await page.goto("/paper");
  await expect(page.getByRole("heading", { name: "Paper Portfolio" })).toBeVisible();
  const watchlist = await page.evaluate(async () => {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json", "x-marketpulse-csrf": "1" },
      body: JSON.stringify({ ticker: "AAPL" }),
    });
    return response.status;
  });
  expect(watchlist).toBeLessThan(300);
  await page.getByLabel("Quantity").fill("1");
  await page.getByRole("button", { name: "PLACE BUY PAPER ORDER" }).click();
  await expect(page.getByText(/FILLED: BUY 1 US:XNAS:AAPL/)).toBeVisible();
  await expect(page.getByText("FILLED", { exact: true }).first()).toBeVisible();
});

test("legacy live-order endpoint remains fail-closed", async ({ page }) => {
  await page.goto("/settings");
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/trade/place", {
      method: "POST",
      headers: { "content-type": "application/json", "x-marketpulse-csrf": "1" },
      body: JSON.stringify({ ticker: "AAPL", side: "buy", quantity: 1 }),
    });
    return { status: result.status, body: await result.json() };
  });
  expect(response.status).toBe(503);
  expect(response.body).toMatchObject({ error: "EXECUTION_ADAPTER_MISSING" });
});

test("captures dashboard and analyst visual evidence", async ({ page }, testInfo: TestInfo) => {
  await page.goto("/dashboard");
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });

  await page.goto("/analyst");
  await page.screenshot({ path: testInfo.outputPath("analyst.png"), fullPage: true });
});
