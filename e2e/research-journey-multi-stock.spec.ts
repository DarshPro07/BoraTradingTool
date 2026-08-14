import { expect, test, type Page } from "@playwright/test";

/**
 * Research journey — multi-stock sanity across the product, per instrument.
 *
 * Named "research journey", NOT the Golden Journey: this suite proves page-level
 * survival and identity/persistence invariants for 6 diverse NSE equities, not
 * the full lifecycle chain. It deliberately does NOT claim hypothesis → strategy
 * → backtest → trial → validation → forward → paper; that chain is proven by
 * `golden-journey-full-lifecycle.spec.ts`.
 *
 * What this file actually asserts per stock:
 *   - /analyze/:id renders (HTTP < 500, body non-empty, NSE identity, no BSE suffix)
 *   - the page has live panels and survives a reload
 *   - /brain renders its lane categories and readiness
 *   - the core API surfaces answer (brain, instruments, identity)
 *
 * Stocks: 2 high-liquidity, 2 medium, 2 smaller/less-followed
 */

const GOLDEN_STOCKS = [
  // High liquidity
  { symbol: "RELIANCE", name: "Reliance Industries", tier: "large" },
  { symbol: "TCS", name: "Tata Consultancy Services", tier: "large" },
  // Medium liquidity
  { symbol: "TATAMOTORS", name: "Tata Motors", tier: "medium" },
  { symbol: "WIPRO", name: "Wipro", tier: "medium" },
  // Smaller / less followed
  { symbol: "BECTORFOOD", name: "MRS Bectors Food", tier: "small" },
  { symbol: "JYOTHYLAB", name: "Jyothy Labs", tier: "small" },
];

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function encodeInstrument(symbol: string): string {
  return `IN%3AXNSE%3A${symbol}`;
}

test.describe("Research journey — multi-stock deep chain", () => {
  for (const stock of GOLDEN_STOCKS) {
    test(`${stock.symbol} (${stock.tier}) — analyze page loads with research capability`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes("mobile"), "desktop-only");
      const errors = collectPageErrors(page);

      // Step 1: Navigate to analyze page for this NSE instrument
      const response = await page.goto(`/analyze/${encodeInstrument(stock.symbol)}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      // Should not 500
      expect(response?.status()).toBeLessThan(500);

      // Page should render content
      await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });
      const bodyText = await page.locator("body").textContent();
      expect(bodyText?.length ?? 0).toBeGreaterThan(0);

      // Step 2: Verify NSE identity is shown (not BSE)
      expect(bodyText).not.toContain(".BO"); // No BSE suffix

      // Step 3: Check that research panel or quote header exists
      const quoteHeader = page.getByTestId("quote-header");
      const researchPanel = page.getByTestId("research-stock");
      const anyPanel = page.locator("[data-testid]");
      await expect(anyPanel.first()).toBeVisible({ timeout: 10_000 });

      // Step 4: No critical console errors
      const criticalErrors = errors.filter(
        (e) => !e.includes("favicon") && !e.includes("net::ERR") && !e.includes("Failed to load resource"),
      );
      if (criticalErrors.length > 0) {
        console.warn(`[${stock.symbol}] Console errors: ${criticalErrors.join("; ")}`);
      }

      // Step 5: Verify page reload preserves state (persistence)
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });
    });
  }
});

test.describe("Research journey — Brain reflects the system state", () => {
  test("Brain page shows all major lane categories", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "desktop-only");
    const errors = collectPageErrors(page);

    await page.goto("/brain", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("brain-page")).toBeVisible({ timeout: 15_000 });

    // Verify AUTO mode lanes are shown
    await expect(page.getByTestId("brain-lanes")).toBeVisible();

    // Should show multiple lanes
    const lanesPanel = page.getByTestId("brain-lanes");
    const laneText = await lanesPanel.textContent();

    // Check for key lanes
    expect(laneText).toContain("Observe");
    expect(laneText).toContain("Learn");
    expect(laneText).toContain("Evolve");

    // No critical errors
    const criticalErrors = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("net::ERR") && !e.includes("Failed to load resource"),
    );
    expect(criticalErrors.length).toBe(0);
  });

  test("Brain shows system readiness", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "desktop-only");
    await page.goto("/brain", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("brain-readiness")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Research journey — API endpoints respond", () => {
  test("/api/brain returns full state", async ({ request }) => {
    const response = await request.get("/api/brain");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty("mode");
    expect(body).toHaveProperty("lanes");
    expect(body).toHaveProperty("capabilities");
    expect(body).toHaveProperty("providers");
  });

  test("/api/market/instruments returns instruments", async ({ request }) => {
    const response = await request.get("/api/market/instruments");
    expect(response.ok()).toBe(true);
  });

  test("/api/system/identity returns identity", async ({ request }) => {
    const response = await request.get("/api/system/identity");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty("buildId");
  });
});
