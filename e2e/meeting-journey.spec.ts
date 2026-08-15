import { expect, test, type Page } from "@playwright/test";

/**
 * P5 — the MEETING JOURNEY: the owner's demo script as one continuous, evidence-checked session.
 *
 * The claim under test is the one the meeting makes: a person starts from the Brain, selects NSE,
 * searches the official security master, inspects one stock, sees the honest research boundary,
 * creates and backtests a strategy, runs deterministic REPLAY, records a paper result, and returns
 * to Brain to see durable counts change. Every mutating leg is cross-checked through an API.
 */

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  const expectedRefusal = /Failed to load resource: the server responded with a status of 4\d\d/;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error" || expectedRefusal.test(message.text())) return;
    errors.push(message.text());
  });
  return errors;
}

interface Readiness {
  items: { area: string; status: string }[];
  summary: { ready: number };
}

async function brainCounts(page: Page): Promise<{ hypotheses: number; strategies: number; paperOrders: number }> {
  // Hypotheses from the API (the count the page renders comes from the same table); the strategy
  // registry has no JSON endpoint, so its count is parsed from the server-rendered panel — which
  // IS a database read, being a server component. The page/API cross-check happens in step 10.
  const body = await page.evaluate(async () => {
    const response = await fetch("/api/research/hypotheses");
    return (await response.json()) as { hypotheses?: unknown[] };
  });
  const knowledge = await page.getByTestId("brain-knowledge").innerText();
  const strategies = Number(/Strategies:\s*(\d+)/.exec(knowledge)?.[1] ?? Number.NaN);
  const paperOrders = Number(/Paper orders:\s*(\d+)/.exec(knowledge)?.[1] ?? Number.NaN);
  expect(Number.isFinite(strategies)).toBe(true);
  expect(Number.isFinite(paperOrders)).toBe(true);
  return { hypotheses: (body.hypotheses ?? []).length, strategies, paperOrders };
}

const RUN_STAMP = Date.now().toString(36);

test.describe("meeting journey — NSE, research, factory, replay, paper, brain", () => {
  test("what the person does provably changes what the system knows", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    // Research budget follows the measured model-latency tail (208s in master run 9): 300s wait
    // inside a 330s test.
    test.setTimeout(330_000);
    const pageErrors = collectPageErrors(page);

    let before = { hypotheses: 0, strategies: 0, paperOrders: 0 };

    await test.step("1. the Brain states system truth before anything is done", async () => {
      await page.goto("/brain", { waitUntil: "domcontentloaded" });
      // /brain is server-rendered — the browser makes no /api/readiness request — so the
      // contract is asserted against the API directly and the page against its own render.
      const readinessResponse = await page.request.get("/api/readiness");
      expect(readinessResponse.status()).toBe(200);
      const readiness = (await readinessResponse.json()) as Readiness;
      expect(readiness.items.length).toBeGreaterThan(5);

      await expect(page.getByTestId("brain-system")).toContainText(/PAPER ONLY/);
      await expect(page.getByTestId("brain-readiness")).toContainText(/Fixed by:/);
      before = await brainCounts(page);
    });

    await test.step("2. select NSE and search the official security master", async () => {
      await page.goto("/command", { waitUntil: "domcontentloaded" });
      const nse = page.getByRole("button", { name: "NSE", exact: true });
      await expect(nse).toBeEnabled({ timeout: 15_000 });
      await nse.click();
      await expect(nse).toHaveAttribute("aria-pressed", "true");

      const searchResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/market/instruments"
          && url.searchParams.get("q") === "State Bank of India"
          && url.searchParams.get("exchange") === "XNSE";
      });
      const search = page.getByLabel(/search instrument/i);
      await search.fill("State Bank of India");
      const response = await searchResponse;
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        instruments: { id: string; isin: string | null }[];
        securityMaster: { totalRows: number };
      };
      // >= 30 holds in BOTH environments: the TEST_MODE acceptance-universe fixture master (32
      // rows, real ISINs for the spec-pinned instruments) and a live NSE bootstrap (thousands).
      // The old `> 3000` was a live-bootstrap assumption that failed the whole meeting journey
      // under the deterministic fixture.
      expect(body.securityMaster.totalRows).toBeGreaterThanOrEqual(30);
      expect(body.instruments).toContainEqual(expect.objectContaining({ id: "IN:XNSE:SBIN", isin: "INE062A01020" }));

      await page.getByRole("option", { name: /SBIN.*INE062A01020/ }).click();
      await expect(search).toHaveValue("IN:XNSE:SBIN");
      const open = page.getByRole("search").getByRole("button", { name: "OPEN" });
      await expect(open).toBeEnabled({ timeout: 15_000 });
      const canonicalResolution = page.waitForResponse((candidate) => {
        const url = new URL(candidate.url());
        return url.pathname === "/api/market/instruments"
          && url.searchParams.get("q") === "IN:XNSE:SBIN"
          && candidate.request().method() === "GET";
      });
      await open.click();
      expect((await canonicalResolution).status()).toBe(200);
      await expect(page).toHaveURL(/\/analyze\/IN%3AXNSE%3ASBIN(?:\?market=NSE)?$/);
    });

    await test.step("3-4. inspect SBIN and exercise the honest research boundary", async () => {
      await expect(page.getByRole("main")).toContainText("₹");
      await page.getByTestId("research-stock-run").click();
      // Research is LIVE now (a real provider round-trip, ~60s), and the honest boundary depends
      // on the store: bars present → a verified proposal; absent → a stated refusal. The old
      // fixture-era assertions (instant PROPOSAL READY + "NOT INTEGRATION VERIFIED" banner +
      // disabled handoff) described a driver that no longer exists.
      await expect(page.getByTestId("research-stock-state")).toHaveText(
        /PROPOSAL READY|NEEDS EVIDENCE|FAILED/,
        { timeout: 300_000 },
      );
      await expect(page.getByTestId("research-stock-fixture-banner")).toHaveCount(0);
      const state = ((await page.getByTestId("research-stock-state").textContent()) ?? "").trim();
      if (state === "PROPOSAL READY") {
        await expect(page.getByTestId("research-stock-handoff")).toBeEnabled();
      } else if (state === "FAILED") {
        await expect(page.getByTestId("research-stock-refusal")).toBeVisible();
      }
    });

    await test.step("5. the factory turns prose into a strategy, visibly interpreted", async () => {
      await page.goto("/strategies", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("factory-flow")).toBeVisible();
      await page.getByTestId("hypothesis-title").fill(`SBIN meeting journey idea ${RUN_STAMP}`);
      await page
        .getByTestId("hypothesis-statement")
        .fill(
          "SBIN and other NSE liquid names gapping with gap >= 3% on relative volume >= 1.5 continue upward " +
            "intraday after realistic round-trip costs, because the opening imbalance persists.",
        );
      const triage = page.waitForResponse(
        (response) => response.url().includes("/api/research/hypotheses") && response.request().method() === "POST",
      );
      await page.getByTestId("hypothesis-submit").click();
      expect((await triage).status()).toBe(201);
      await expect(page.getByTestId("hypothesis-result")).toContainText("EXPRESSIBLE");
      await expect(page.getByTestId("hypothesis-result")).toContainText(/gap_pct gte 3/);
    });

    await test.step("6. the backtest answers with evidence or the named gap — never a blank", async () => {
      const backtest = page.waitForResponse((response) => response.url().includes("/api/strategy/trades"));
      await page.getByTestId("factory-backtest").click();
      const status = (await backtest).status();
      const result = page.getByTestId("factory-backtest-result");
      await expect(result).toBeVisible({ timeout: 60_000 });
      if (status === 200) {
        await expect(result).toContainText(/trade\(s\)|snapshot/i);
      } else {
        await expect(result).toContainText(/Nothing was invented/i);
      }
    });

    await test.step("7. a deterministic REPLAY validation, labelled by the server", async () => {
      await page.goto("/paper", { waitUntil: "domcontentloaded" });
      await page.getByTestId("forward-mode-replay").click();
      await page.getByTestId("forward-asof").fill("2026-08-03T10:00");
      const run = page.waitForResponse((response) => response.url().includes("/api/forward/run"));
      await page.getByTestId("forward-run").click();
      const runBody = (await (await run).json()) as { mode: string };
      expect(runBody.mode).toBe("REPLAY");
      await expect(page.getByTestId("forward-note")).toContainText("REPLAY — HISTORICAL EVIDENCE as of 2026-08-03");
    });

    await test.step("8-9. record a paper-only result, including a named refusal", async () => {
      await page.goto("/paper?market=NSE", { waitUntil: "domcontentloaded" });
      const input = page.getByRole("combobox", { name: "Instrument", exact: true });
      await input.fill("SBIN");
      await page.getByRole("option", { name: /SBIN.*INE062A01020/ }).click();
      await expect(input).toHaveValue("IN:XNSE:SBIN");

      const order = page.waitForResponse(
        (response) => response.url().includes("/api/paper/orders") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "PLACE BUY PAPER ORDER" }).click();
      const orderResponse = await order;
      expect([201, 422]).toContain(orderResponse.status());
      const orderBody = (await orderResponse.json()) as { order: { status: string; instrumentId: string } };
      expect(orderBody.order.instrumentId).toBe("IN:XNSE:SBIN");
      expect(["FILLED", "REJECTED", "OPEN"]).toContain(orderBody.order.status);

      const recorded = await page.request.get("/api/paper/orders");
      expect(recorded.status()).toBe(200);
      const rows = (await recorded.json()) as { instrumentId: string }[];
      expect(rows.some((row) => row.instrumentId === "IN:XNSE:SBIN")).toBe(true);
    });

    await test.step("10. the Brain now knows more, and the numbers prove it", async () => {
      await page.goto("/brain", { waitUntil: "domcontentloaded" });
      const after = await brainCounts(page);
      // The person's idea and its authored strategy are now system knowledge — a strictly
      // increased count read from the database, not a screenshot.
      expect(after.hypotheses).toBeGreaterThan(before.hypotheses);
      expect(after.strategies).toBeGreaterThan(before.strategies);
      expect(after.paperOrders).toBeGreaterThan(before.paperOrders);
      // Cross-check: the rendered hypothesis count and the API's are the same number.
      await expect(page.getByTestId("brain-knowledge")).toContainText(`Hypotheses: ${after.hypotheses}`);
    });

    expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
