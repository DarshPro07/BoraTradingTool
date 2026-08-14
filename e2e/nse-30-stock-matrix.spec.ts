import { expect, test, type Page } from "@playwright/test";

/**
 * NSE 30-Stock Acceptance Matrix — breadth across diverse NSE equities.
 *
 * Stops the one-stock delusion: the system must handle MANY instruments, not just RELIANCE.
 * Stratified across large / mid / smaller-cap and ~12 sectors.
 *
 * ## What this suite used to prove, and why that was not enough
 *
 * The threshold half was already honest — `>= 30` unique canonical XNSE securities, never lowered
 * to match availability, plus a check that all 30 acceptance symbols resolve from the catalogue.
 * That part is unchanged.
 *
 * The per-stock half was not. It asserted three things, and each could pass on a broken page:
 *
 *   - `expect(status).toBeLessThan(500)` — `/analyze/<unknown>` renders `TickerNotFound` with
 *     HTTP 200. A symbol the system cannot resolve at all therefore PASSED.
 *   - `expect(bodyText.length).toBeGreaterThan(0)` — satisfied by any error page.
 *   - console errors were collected and reported with `console.warn`, which cannot fail a test.
 *
 * So "30/30 passed" meant "30 pages returned bytes". Per the mission, breadth acceptance must
 * perform a meaningful interaction and reach a terminal outcome, and a truthful refusal is a pass
 * while a broken route is a failure. That is what it now does.
 *
 * ## Allowed terminal outcomes (all of them honest)
 *
 *   PROPOSAL READY   — the provider proposed and MarketPulse verified the citations
 *   NEEDS EVIDENCE   — insufficient evidence; the system says so instead of inventing a thesis
 *   FAILED + refusal — a *stated* refusal code (NO_STORED_DATA, PROVIDER_UNAVAILABLE, …)
 *
 * Not allowed: a hang with no terminal state, a blank page, an unresolved instrument, a bare
 * failure with no diagnostic code, a 5xx, or any uncaught console error.
 */

// Large cap (high liquidity)
const LARGE_CAP = [
  { symbol: "RELIANCE", name: "Reliance Industries" },
  { symbol: "TCS", name: "Tata Consultancy Services" },
  { symbol: "HDFCBANK", name: "HDFC Bank" },
  { symbol: "INFY", name: "Infosys" },
  { symbol: "ICICIBANK", name: "ICICI Bank" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever" },
  { symbol: "SBIN", name: "State Bank of India" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel" },
  { symbol: "ITC", name: "ITC" },
  { symbol: "LT", name: "Larsen & Toubro" },
];

// Mid cap (medium liquidity)
const MID_CAP = [
  { symbol: "TATAMOTORS", name: "Tata Motors" },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical" },
  { symbol: "TATASTEEL", name: "Tata Steel" },
  { symbol: "WIPRO", name: "Wipro" },
  { symbol: "ASIANPAINT", name: "Asian Paints" },
  { symbol: "MARUTI", name: "Maruti Suzuki" },
  { symbol: "TITAN", name: "Titan Company" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance" },
  { symbol: "HCLTECH", name: "HCL Technologies" },
  { symbol: "POWERGRID", name: "Power Grid Corporation" },
];

// Smaller / less followed (but valid NSE equities)
const SMALLER_CAP = [
  { symbol: "BECTORFOOD", name: "MRS Bectors Food" },
  { symbol: "JYOTHYLAB", name: "Jyothy Labs" },
  { symbol: "CHAMBLFERT", name: "Chambal Fertilizers" },
  { symbol: "GAIL", name: "GAIL India" },
  { symbol: "SIEMENS", name: "Siemens India" },
  { symbol: "AMBUJACEM", name: "Ambuja Cements" },
  { symbol: "BERGEPAINT", name: "Berger Paints" },
  { symbol: "DABUR", name: "Dabur India" },
  { symbol: "COLPAL", name: "Colgate Palmolive" },
  { symbol: "MCDOWELL-N", name: "United Spirits" },
];

const ALL_STOCKS = [...LARGE_CAP, ...MID_CAP, ...SMALLER_CAP];

/**
 * `ResearchThisStock` renders its state with underscores replaced by spaces
 * (`state.replace(/_/g, " ")`), so these are the strings actually on screen.
 */
const TERMINAL_STATES = ["PROPOSAL READY", "NEEDS EVIDENCE", "FAILED"] as const;
const IN_FLIGHT_STATES = ["IDLE", "RESEARCHING", "VERIFYING SOURCES"] as const;

/** Console/network noise that is genuinely not a product defect. Each entry states WHY. */
const ALLOWED_NOISE: Array<{ match: RegExp; because: string }> = [
  {
    match: /favicon/i,
    because: "the browser requests /favicon.ico on every navigation; a miss is not a page defect",
  },
  {
    match: /Download the React DevTools/i,
    because: "React's development-build advertisement, printed as noise rather than an error",
  },
];

function isAllowedNoise(text: string): boolean {
  return ALLOWED_NOISE.some((entry) => entry.match.test(text));
}

/** Everything that should fail a page: exceptions, console errors, dead requests, 5xx. */
function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`uncaught exception: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (isAllowedNoise(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (isAllowedNoise(url)) return;
    const failure = request.failure()?.errorText ?? "";
    // Aborted Next.js RSC prefetches are the prefetcher working as designed — see the same rule,
    // with its full reasoning, in e2e/all-routes.spec.ts.
    if (url.includes("_rsc=") && failure === "net::ERR_ABORTED") return;
    problems.push(`request failed: ${request.method()} ${url} — ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    if (isAllowedNoise(response.url())) return;
    problems.push(`server error: ${response.status()} ${response.url()}`);
  });
  return problems;
}

function encodeInstrument(symbol: string): string {
  return `IN%3AXNSE%3A${symbol}`;
}

test.describe("NSE 30-stock breadth matrix", () => {
  test("catalog contains at least 30 unique canonical NSE instruments", async ({ request }) => {
    const response = await request.get("/api/market/instruments");
    expect(response.ok()).toBe(true);
    const data = await response.json();
    const instruments = data.instruments ?? data ?? [];
    console.log(`[matrix] Catalog has ${instruments.length} instruments`);
    // P0 FINAL PROOF: the acceptance threshold is 30 and is NEVER lowered to match availability.
    // The catalog without a query is a listing (not a truncated search), so this must see every
    // pinned instrument.
    const canonicalXnse = instruments.filter(
      (item: { market?: string; exchange?: string }) =>
        item.market === "IN" && item.exchange === "XNSE",
    );
    const uniqueSymbols = new Set(canonicalXnse.map((item: { symbol: string }) => item.symbol));
    console.log(`[matrix] Canonical XNSE instruments: ${uniqueSymbols.size}`);
    expect(uniqueSymbols.size).toBeGreaterThanOrEqual(30);
    // The listing pre-deduplicates master/catalog overlaps by id, but defenses stay cheap:
    // duplicates would mean the same security counted twice toward the threshold.
    expect(canonicalXnse.length).toBe(uniqueSymbols.size);
    // Every security in the pinned 30-security acceptance universe must be resolvable from the
    // canonical listing — the matrix and the catalog must not drift apart.
    const acceptanceSymbols = ALL_STOCKS.map((stock) => stock.symbol);
    expect(acceptanceSymbols.length).toBe(30);
    expect(new Set(acceptanceSymbols).size, "the acceptance universe contains a duplicate").toBe(30);
    for (const symbol of acceptanceSymbols) {
      expect(uniqueSymbols.has(symbol), `acceptance security ${symbol} missing from catalog`).toBe(true);
    }
  });

  for (const stock of ALL_STOCKS) {
    test(`${stock.symbol} — resolves, researches, and reaches a terminal outcome`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
      // A refusal resolves in milliseconds; a real provider round-trip is the slow case. The
      // budget covers the slow case without hiding a hang — a hang still fails, just later.
      test.setTimeout(120_000);
      const problems = collectPageProblems(page);

      const response = await page.goto(`/analyze/${encodeInstrument(stock.symbol)}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      // 200, not "< 500": the not-found surface is a 200 and must not read as success.
      expect(response?.status(), `${stock.symbol} did not return 200`).toBe(200);

      // The instrument must actually RESOLVE. Without this, an unknown symbol renders
      // TickerNotFound at HTTP 200 and counts as a pass.
      await expect(
        page.getByTestId("ticker-not-found"),
        `${stock.symbol} did not resolve — the analyze page fell through to TickerNotFound`,
      ).toHaveCount(0);

      // The research control must be present and reachable — a missing control is a dead surface.
      const control = page.getByTestId("research-stock");
      await expect(control, `${stock.symbol} has no research control`).toBeVisible({ timeout: 15_000 });

      const stateLabel = page.getByTestId("research-stock-state");
      await expect(stateLabel).toBeVisible();
      expect(
        [...TERMINAL_STATES, ...IN_FLIGHT_STATES],
        `${stock.symbol} opened in an unknown research state`,
      ).toContain(((await stateLabel.textContent()) ?? "").trim());

      // --- The meaningful interaction: actually run the research. -------------------------------
      await page.getByTestId("research-stock-run").click();

      // Wait for a TERMINAL state. A run that never settles is a defect, not a slow test.
      await expect
        .poll(async () => ((await stateLabel.textContent()) ?? "").trim(), {
          timeout: 90_000,
          message: `${stock.symbol} never reached a terminal research state`,
        })
        .toMatch(/^(PROPOSAL READY|NEEDS EVIDENCE|FAILED)$/);

      const finalState = ((await stateLabel.textContent()) ?? "").trim();

      // A failure must be DIAGNOSED, never bare. "Failed to fetch" with no code is exactly the
      // outcome the mission forbids.
      if (finalState === "FAILED") {
        const refusal = page.getByTestId("research-stock-refusal");
        await expect(
          refusal,
          `${stock.symbol} FAILED without a stated refusal — a bare failure gives the user nothing`,
        ).toBeVisible();
        const text = ((await refusal.textContent()) ?? "").trim();
        expect(text.length, `${stock.symbol} refusal is empty`).toBeGreaterThan(0);
        // The component renders `CODE — message`; the code must be present and non-empty.
        expect(text, `${stock.symbol} refusal has no code`).toMatch(/^[A-Z0-9_]+\s+—/);
      }

      // A verified proposal must actually render its thesis, not just flip a label.
      if (finalState === "PROPOSAL READY") {
        await expect(page.getByTestId("research-stock-proposal")).toBeVisible();
      }

      // The log records WHY, not just WHAT. A run of 30 identical terminal states is a product
      // signal (one shared cause), and a bare "FAILED ×30" cannot tell that from 30 independent
      // refusals — so the reason travels with the outcome into the run log.
      const reason = (await page.getByTestId("research-stock-refusal").textContent().catch(() => null))
        ?.trim()
        .replace(/\s+/g, " ");
      console.log(`[matrix] ${stock.symbol} → ${finalState}${reason ? ` :: ${reason}` : ""}`);

      expect(
        problems,
        `${stock.symbol} produced ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`,
      ).toEqual([]);
    });
  }
});

test.describe("NSE identity verification — no BSE contamination", () => {
  test("analyze page shows NSE identity for an NSE instrument", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    await page.goto(`/analyze/${encodeInstrument("RELIANCE")}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("ticker-not-found")).toHaveCount(0);
    const pageText = (await page.locator("body").textContent()) ?? "";
    // `.BO` is the BSE suffix. An NSE instrument page must never carry it.
    expect(pageText).not.toContain(".BO");
    expect(pageText, "the analyze page does not name the instrument it is showing").toContain("RELIANCE");
  });

  test("instrument search resolves a symbol to its canonical NSE identity", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    await page.goto("/", { waitUntil: "domcontentloaded" });

    /**
     * This test previously wrapped its whole body in `if (searchBox.isVisible())` and
     * `if (count > 0)`, so it asserted NOTHING and passed unconditionally. Removing the guards
     * exposed that it had never located the control at all: it looked for
     * `getByTestId("instrument-search")`, but `TopNav` passes `id="instrument-search"` to
     * `InstrumentCombobox`, which spreads it onto a `role="combobox"` input. The testid never
     * existed, and neither did the `search-result` testid it expected for results.
     *
     * The component's ARIA semantics are correct and complete (combobox + listbox + options), so
     * the fix is to locate it the way a user and a screen reader do, rather than bolt redundant
     * testids onto working markup.
     *
     * The exchange assertion changed for the same reason — it was asserting something the product
     * never rendered. An option shows `series ?? exchange` and `isin ?? id`, so a listed NSE
     * equity displays its series ("EQ") and ISIN; the literal text "NSE" is not on screen.
     * Selecting the result and checking where it lands is both honest and stronger: it proves the
     * symbol resolves to a canonical `IN:XNSE:` identity through the real UI path.
     */
    const searchInput = page.getByRole("combobox", { name: /search instrument/i });
    await expect(searchInput, "the application chrome has no instrument search").toBeVisible({
      timeout: 15_000,
    });

    await searchInput.fill("RELIANCE");

    // Scoped to the results listbox on purpose: the same dropdown also renders a native <select>
    // series filter whose `<option>ALL</option>` matches an unscoped `getByRole("option")`, and
    // that filter option is the one `.first()` resolves to.
    const options = page
      .getByRole("listbox", { name: /search instrument results/i })
      .getByRole("option");
    await expect
      .poll(async () => options.count(), {
        timeout: 15_000,
        message: "searching RELIANCE returned no instrument options",
      })
      .toBeGreaterThan(0);

    const firstOption = options.first();
    await expect(firstOption).toContainText("RELIANCE");
    // No BSE contamination in the result itself.
    await expect(firstOption).not.toContainText(".BO");
    await expect(firstOption).not.toContainText("XBOM");

    // The real user path is two steps, and the test follows it rather than assuming one:
    // `selectInstrument` only fills the field with the canonical id and closes the listbox
    // (InstrumentCombobox:123); navigation happens on form submit, where TopNav's `handleSearch`
    // resolves the value and calls `router.push`. Asserting on the click alone reported a product
    // defect that was really a wrong assumption about the interaction.
    await firstOption.click();
    await searchInput.press("Enter");

    await expect(page, "opening RELIANCE did not land on its canonical NSE analyze page").toHaveURL(
      /IN(%3A|:)XNSE(%3A|:)RELIANCE/,
      { timeout: 20_000 },
    );
    // The destination must be a resolved instrument, not the not-found surface at HTTP 200.
    await expect(page.getByTestId("ticker-not-found")).toHaveCount(0);
  });
});
