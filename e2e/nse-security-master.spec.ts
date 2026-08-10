import { expect, test, type Page } from "@playwright/test";

function runtimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openTopSearch(page: Page, query: string) {
  const input = page.getByRole("combobox", { name: "Search instrument", exact: true });
  await input.fill(query);
  await expect(page.getByRole("listbox", { name: "Search instrument results" })).toBeVisible();
  return input;
}

test("1 searches the verified NSE master by symbol", async ({ page }) => {
  const errors = runtimeErrors(page);
  await page.goto("/dashboard");
  await openTopSearch(page, "RELIANCE");
  await expect(page.getByRole("option", { name: /RELIANCE.*INE002A01018/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("2 searches by company name", async ({ page }) => {
  await page.goto("/dashboard");
  await openTopSearch(page, "Tata Consultancy");
  await expect(page.getByRole("option", { name: /TCS.*Tata Consultancy/ })).toBeVisible();
});

test("3 searches by ISIN", async ({ page }) => {
  await page.goto("/dashboard");
  await openTopSearch(page, "INE002A01018");
  await expect(page.getByRole("option", { name: /RELIANCE.*INE002A01018/ })).toBeVisible();
});

test("4 filters current results by NSE series", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("combobox", { name: "Search instrument", exact: true }).click();
  await page.getByLabel("NSE series").selectOption("SM");
  await expect(page.getByRole("option", { name: /SMALLSME.*SM/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /RELIANCE/ })).toHaveCount(0);
});

test("5 supports keyboard selection and escape", async ({ page }) => {
  await page.goto("/dashboard");
  const input = await openTopSearch(page, "RELIANCE");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("IN:XNSE:RELIANCE");
  await input.press("ArrowDown");
  await input.press("Escape");
  await expect(page.getByRole("listbox", { name: "Search instrument results" })).toHaveCount(0);
});

test("6 preserves the selected ISIN-backed identity after refresh", async ({ page }) => {
  await page.goto("/ai");
  const input = page.getByRole("combobox", { name: "Instrument", exact: true });
  await input.fill("RELIANCE");
  await page.getByRole("option", { name: /RELIANCE.*INE002A01018/ }).click();
  await expect(input).toHaveValue("IN:XNSE:RELIANCE");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Instrument", exact: true })).toHaveValue("IN:XNSE:RELIANCE");
});

test("7 returns bounded deterministic API pages", async ({ page }) => {
  await page.goto("/dashboard");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/market/instruments?exchange=XNSE&limit=2&offset=1");
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(200);
  expect(result.body.instruments).toHaveLength(2);
  expect(result.body.pagination).toMatchObject({ limit: 2, offset: 1, total: 5 });
});

test("8 AI selection does not render a giant datalist", async ({ page }) => {
  await page.goto("/ai");
  await expect(page.locator("#ai-instruments")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Instrument", exact: true }).fill("TCS");
  await page.getByRole("option", { name: /TCS.*INE467B01029/ }).click();
  await expect(page.getByRole("combobox", { name: "Instrument", exact: true })).toHaveValue("IN:XNSE:TCS");
});

test("9 paper selection does not render a giant datalist", async ({ page }) => {
  await page.goto("/paper");
  await expect(page.locator("#paper-instruments")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Instrument", exact: true }).fill("RELIANCE");
  await page.getByRole("option", { name: /RELIANCE.*INE002A01018/ }).click();
  await expect(page.getByRole("combobox", { name: "Instrument", exact: true })).toHaveValue("IN:XNSE:RELIANCE");
});

test("10 keeps a listed security visible when market data is unavailable", async ({ page }) => {
  await page.goto("/dashboard");
  await openTopSearch(page, "SMALLSME");
  await expect(page.getByRole("option", { name: /LISTED - DATA NOT AVAILABLE/ })).toBeVisible();
});

test("11 reports a failed latest sync while retaining last-good results", async ({ page }) => {
  await page.goto("/dashboard");
  await openTopSearch(page, "RELIANCE");
  await expect(page.getByTestId("security-master-status")).toContainText("LAST SYNC FAILED");
  await expect(page.getByRole("option", { name: /RELIANCE/ })).toBeVisible();
});

test("12 remains usable without horizontal overflow on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/dashboard");
  await openTopSearch(page, "RELIANCE");
  await expect(page.getByRole("option", { name: /RELIANCE/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
});
