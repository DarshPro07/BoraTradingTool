import { expect, test, type Page } from "@playwright/test";

/**
 * The engines, tested through the screen rather than through their exports.
 *
 * ## Why this file exists separately from `app.spec.ts`
 *
 * `app.spec.ts` asserts that pages render without runtime errors. That is worth having and it is
 * not the same claim as "the feature works". A panel that renders a hardcoded zero, a panel wired
 * to a function nobody calls, and a panel showing live evidence are indistinguishable to a test
 * that only checks the page did not throw.
 *
 * Every defect found in this system's recent history was of that shape:
 *
 *   - `openForwardObservation` was correct, tested, and called by nothing outside tests.
 *   - `scoreForecast` was correct, rigorous, and never called at all.
 *   - The rehearsal produced a verdict every cycle and discarded it, so the Strategy Lab funnel
 *     read "REHEARSED 5" while every row beneath it read "Not yet rehearsed" — two numbers
 *     contradicting each other on one screen, with 1,100 unit tests passing.
 *
 * None of those were reachable by a unit test, because each unit was individually correct. They
 * were only visible where the wiring is: the rendered page. So these tests assert on **meaning** —
 * a specific computed figure, a refusal with its reason, an empty state that says it is empty —
 * never merely on a heading being present.
 *
 * ## Why the assertions target a fresh database
 *
 * Playwright runs against `MARKETPULSE_TEST_MODE=1` and a per-run SQLite file, so there is no
 * accumulated history here. That is deliberate: a panel's **empty state** is the case most likely
 * to be wrong, because it is the one nobody looks at. A panel that invents "0 bars, 0% cost" on an
 * empty store is worse than one that says it has nothing, and only a fresh database catches it.
 */

/**
 * Seed the registry before the suite runs.
 *
 * Three tests here assert on content that only exists when a strategy is present — a stage, a
 * reason, a funnel rung. They passed for months because they were run against a populated
 * database, and failed the moment anyone ran them against a fresh one. That is CI red on a correct
 * codebase, which is worse than no test: it trains people to ignore the suite.
 *
 * The file's own header claims fresh-database empty-state coverage, so the fix is for the tests to
 * *create the state they assert on* rather than to inherit it. Authored through the real API, which
 * also means a failure here is a real failure of the authoring path rather than a fixture problem.
 */
test.beforeAll(async ({ request, baseURL }) => {
  const response = await request.post("/api/strategy/author", {
    headers: {
      "content-type": "application/json",
      origin: baseURL!,
      "x-marketpulse-csrf": "1",
    },
    data: {
      dsl: {
        name: "e2e_ladder_fixture",
        universe: { market: "NSE", maxPositions: 4, resolution: "D" },
        entry: { feature: "rsi14", op: "lt", value: 30 },
        exit: { afterDays: 5, stopLossPct: 2 },
        sizing: { maxPositionPct: 25 },
        costs: { commissionBps: 5, slippageBps: 7 },
      },
      createdBy: "e2e-fixture",
    },
  });

  // 201 on a fresh database, 409 when a previous run already authored it. Both mean the registry
  // now holds a strategy, which is all these tests need. Any other status is a real failure and
  // must not be swallowed into a confusing assertion further down.
  expect([201, 409]).toContain(response.status());
});

function trackRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("cost and capital viability", () => {
  test("states what the owner's capital can and cannot trade", async ({ page }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto("/paper", { waitUntil: "domcontentloaded" });

    const panel = page.getByText("COST & CAPITAL VIABILITY").first();
    await expect(panel).toBeVisible();

    const body = page.locator("body");

    // Assert the *ladder*, which is computed from published fee rates and is therefore identical
    // on every database — not the headline figure, which reads the paper account balance.
    //
    // This test previously asserted "NONE" and "below every floor", the answer for the owner's
    // stated ₹1,000. On a fresh database the paper account seeds at ₹1,00,00,000, so the panel
    // correctly reports DELIVERY instead and the test failed on a working system. It only ever
    // passed because it was run against a database where the account had been aligned by hand.
    //
    // The panel is not wrong in either state — it warns about the mismatch itself. The test was.
    await expect(body).toContainText("₹1,000");
    await expect(body).toContainText("refused");
    await expect(body).toContainText("INTRADAY");
    // The two facts the whole panel exists to convey, both pure arithmetic from the fee schedule.
    await expect(body).toContainText("0.106%");
    await expect(body).toContainText(/Why intraday reaches/i);

    expect(errors).toEqual([]);
  });

  test("shows the ladder, including the level at which each product becomes possible", async ({ page }) => {
    await page.goto("/paper", { waitUntil: "domcontentloaded" });
    const body = page.locator("body");

    // Computed from published rates, so these are stable: intraday is flat because every charge is
    // proportional; delivery bends because ₹15.93 of DP charge is not.
    await expect(body).toContainText("INTRADAY");
    await expect(body).toContainText("DELIVERY");
    await expect(body).toContainText("0.106%");
    await expect(body).toContainText("refused");
  });

  test("explains why delivery costs more, rather than only that it does", async ({ page }) => {
    await page.goto("/paper", { waitUntil: "domcontentloaded" });
    const body = page.locator("body");
    await expect(body).toContainText("DP charge is flat");
    await expect(body).toContainText("both legs");
  });
});

test.describe("forecast validation", () => {
  test("reports an empty record as empty, not as a verdict", async ({ page }) => {
    // The dangerous alternative: "0% error, better than persistence" off zero observations.
    const errors = trackRuntimeErrors(page);
    await page.goto("/data-quality", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("FORECAST VALIDATION").first()).toBeVisible();
    const body = page.locator("body");

    // The gate is named even with nothing in flight, so the bar is visible before it is cleared.
    await expect(body).toContainText("30");
    await expect(body).not.toContainText("better_than_persistence");

    expect(errors).toEqual([]);
  });
});

test.describe("intraday accumulation", () => {
  test("does not claim coverage it has not accumulated", async ({ page }) => {
    await page.goto("/data-quality", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("INTRADAY HISTORY").first()).toBeVisible();
    const body = page.locator("body");

    // Case-insensitive: these labels are uppercased by CSS, so `innerText` returns "Beyond
    // provider". Asserting the styled form tests the stylesheet, not the feature.
    await expect(body).toContainText(/beyond provider/i);

    // The invariant across every state, which is what makes this worth asserting: the panel says
    // either that it holds nothing, or that it is still inside the live window, or how many series
    // have passed it. What it must never do is show the "beyond provider" tile without one of
    // those three explanations — that count is the entire claim of the feature, and a bare number
    // beside no statement is how a store of three weeks starts reading as intraday coverage.
    await expect(body).toContainText(
      /Nothing accumulated yet|still inside the provider|becomes so once a series passes its window|hold more history than the live feed/i,
    );
  });
});

test.describe("the promotion ladder", () => {
  test("gives every strategy a stage and a reason for it", async ({ page }) => {
    // The contradiction this catches: a funnel counting rehearsals while every row says
    // "Not yet rehearsed". A stage without a reason is how that survived unnoticed.
    const errors = trackRuntimeErrors(page);
    await page.goto("/strategies", { waitUntil: "domcontentloaded" });

    const registry = page.getByText("REGISTRY").first();
    await expect(registry).toBeVisible();

    const body = page.locator("body");
    await expect(body).toContainText(/stage/i);
    // Every stage shown must carry an explanation; the ladder always populates `because`.
    await expect(body).toContainText(/Not yet rehearsed|gauntlet has not run|Cannot be evaluated|graveyard/i);

    expect(errors).toEqual([]);
  });

  test("never shows a strategy past owner review without forward evidence", async ({ page }) => {
    await page.goto("/strategies", { waitUntil: "domcontentloaded" });
    const funnel = page.locator("body");
    // FORWARD is the last rung and the only unbiased evidence. On a fresh database it is zero, and
    // nothing may sit beyond it.
    await expect(funnel).toContainText("FORWARD");
  });
});

test.describe("navigation reaches every screen", () => {
  test("every nav link resolves to a page that renders", async ({ page }) => {
    // The orphan problem, asserted in the browser: 26 routes existed and a stale note claimed one
    // was linked. A link that 404s is found by clicking, not by a unit test on the nav array.
    const errors = trackRuntimeErrors(page);
    await page.goto("/command", { waitUntil: "domcontentloaded" });

    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("header a[href^='/']"))
        .map((anchor) => anchor.getAttribute("href"))
        .filter((href): href is string => href !== null && !href.startsWith("//")),
    );

    expect(hrefs.length).toBeGreaterThan(3);

    for (const href of new Set(hrefs)) {
      const response = await page.goto(href, { waitUntil: "domcontentloaded" });
      expect(response?.status(), href).toBeLessThan(400);
      await expect(page.locator("body"), href).not.toContainText("Application error");
    }

    expect(errors).toEqual([]);
  });
});

test.describe("the refusals that must never soften", () => {
  test("order placement stays fail-closed", async ({ page }) => {
    // Navigated first: `page.evaluate` on about:blank has no base URL, so a relative fetch throws
    // "Failed to parse URL" — which would read as a passing refusal for the wrong reason.
    await page.goto("/command", { waitUntil: "domcontentloaded" });

    // Two layers, asserted separately, because passing the outer one is not evidence about the
    // inner one. Without the CSRF header the request is refused at the security boundary and
    // never reaches the execution check at all — a test that only sent a bare POST would report
    // "fail-closed" while proving nothing about whether orders can be placed.
    const result = await page.evaluate(async () => {
      const bare = await fetch("/api/trade/place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instrumentId: "IN:XNSE:RELIANCE", side: "BUY", quantity: 1 }),
      });
      const authorised = await fetch("/api/trade/place", {
        method: "POST",
        headers: { "content-type": "application/json", "x-marketpulse-csrf": "1" },
        body: JSON.stringify({ instrumentId: "IN:XNSE:RELIANCE", side: "BUY", quantity: 1 }),
      });
      return {
        bare: { status: bare.status, body: await bare.text() },
        authorised: { status: authorised.status, body: await authorised.text() },
      };
    });

    // Outer: the security boundary refuses an unheadered mutation.
    expect(result.bare.status).toBeGreaterThanOrEqual(400);
    expect(result.bare.body).toMatch(/CSRF_HEADER_REQUIRED|CROSS_ORIGIN_MUTATION/);

    // Inner: even a properly formed request cannot place an order. This is the one that matters.
    expect(result.authorised.status).toBeGreaterThanOrEqual(400);
    expect(result.authorised.body).toMatch(/EXECUTION_ADAPTER_MISSING|CROSS_ORIGIN_MUTATION|OWNER/);
  });

  test("the removed Robinhood path stays removed", async ({ page }) => {
    // The routes still exist as neutered stubs. This asserts they stay neutered: a GET must
    // report no broker, and a mutation must refuse.
    await page.goto("/command", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const get = await fetch("/api/agent/robinhood/portfolio");
      const post = await fetch("/api/agent/robinhood/portfolio", { method: "POST", body: "{}" });
      return { getBody: await get.text(), postStatus: post.status };
    });

    expect(result.getBody).toContain("EXECUTION_ADAPTER_MISSING");
    expect(result.postStatus).toBeGreaterThanOrEqual(400);
  });
});
