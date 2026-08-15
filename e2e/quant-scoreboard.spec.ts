import { expect, test, type Page } from "@playwright/test";

/**
 * The Quant Scoreboard on /brain (owner directive 2026-08-15): the primary question rendered
 * from the ledgers. On a fresh database every count is an HONEST ZERO with its basis stated and
 * ratios shown as "—" — the empty state is a truthful reading, not a blank or a crash. The
 * numbers themselves are pinned by lib/dashboard/quant-scoreboard.test.ts; this spec proves the
 * live page renders the model without console errors, fabricated placeholders, or NaN.
 */

const ALLOWED_NOISE: RegExp[] = [/favicon/i, /Download the React DevTools/i];
const isAllowedNoise = (text: string) => ALLOWED_NOISE.some((entry) => entry.test(text));

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`uncaught exception: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error" || isAllowedNoise(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && !isAllowedNoise(response.url())) {
      problems.push(`server error: ${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

test.describe("the quant scoreboard — /brain answers the primary question from the ledgers", () => {
  test("renders the full funnel with numeric counts, typed rejections, and the paper NET line", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    const problems = collectPageProblems(page);

    await page.goto("/brain", { waitUntil: "domcontentloaded", timeout: 30_000 });
    const panel = page.getByTestId("brain-quant-scoreboard");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The question itself is on the page — the scoreboard says what it is scoring.
    await expect(panel).toContainText("repeatable NET positive NSE edge");

    // All 12 funnel stages render, each with a numeric count (never NaN/undefined/blank).
    const funnelRows = page.locator("[data-testid^='quant-funnel-']");
    await expect(funnelRows).toHaveCount(12);
    for (const key of ["universe", "researched", "hypotheses", "families", "versions", "rehearsed", "validated", "holdout", "forward_enrolled", "forward_resolved", "paper", "net_positive"]) {
      const row = page.getByTestId(`quant-funnel-${key}`);
      await expect(row, `funnel stage ${key} missing`).toBeVisible();
      await expect(row.locator("span").last()).toHaveText(/^\d+$/);
    }

    // Typed rejections: either grouped rows or the stated empty — never a silent blank.
    const rejections = page.getByTestId("quant-rejections");
    await expect(rejections).toBeVisible();
    const rejectionText = (await rejections.textContent()) ?? "";
    expect(
      // No \b anchors: textContent concatenates adjacent nodes ("STAGEcost_stress10"), and a
      // word boundary never occurs between two word characters.
      /none recorded yet/.test(rejectionText) || /(cost_stress|walk_forward|parameter_stability|replay|monte_carlo|no_trade_comparison|causality|sealed_holdout)/.test(rejectionText),
      `rejections section is neither grouped kinds nor the stated empty:\n${rejectionText}`,
    ).toBe(true);
    await expect(rejections).toContainText("graveyard");

    // The NET identity is on the page: gross − fees = net, with expectancy/cost-share or "—".
    const paper = page.getByTestId("quant-paper-net");
    await expect(paper).toContainText("gross ₹");
    await expect(paper).toContainText("fees ₹");
    await expect(paper).toContainText("net ₹");
    await expect(paper).toContainText(/expectancy\/trade (—|₹-?\d)/);

    // Survivors: rows with DSR/PBO, or the honest none.
    const survivorsEmpty = page.getByTestId("quant-survivors-empty");
    const survivorRows = page.getByTestId("quant-survivor-row");
    expect((await survivorsEmpty.count()) > 0 || (await survivorRows.count()) > 0).toBe(true);

    // v2 — the family comparison: a table of rows, or the stated "no registered families yet".
    const familyBlock = page.getByTestId("quant-family-comparison");
    await expect(familyBlock).toBeVisible();
    const familyRowCount = await page.getByTestId("quant-family-row").count();
    if (familyRowCount === 0) {
      await expect(familyBlock).toContainText("no registered families yet");
    } else {
      // Each row carries every column — the candidate pool (C/R/G) plus the evidence columns;
      // paper net and max DD are either ₹/% figures or "—".
      const firstRow = page.getByTestId("quant-family-row").first();
      await expect(firstRow.locator("td")).toHaveCount(9);
      const rowText = (await firstRow.textContent()) ?? "";
      expect(rowText).toMatch(/\d+\/\d+\/\d+/);
      expect(rowText).toMatch(/₹-?\d|—/);
    }

    // Data coverage (owner 2026-08-16): the eligible universe measured, reasons typed, SME
    // segregated. Present on every database state — zeros are an honest reading.
    const coverage = page.getByTestId("brain-data-coverage");
    await expect(coverage).toBeVisible();
    await expect(coverage).toContainText("TRADABLE RESEARCH UNIVERSE");
    await expect(page.getByTestId("coverage-research-ready")).toContainText(/\d+ · \d+(\.\d+)?%/);
    const reasons = page.getByTestId("coverage-missing-reasons");
    await expect(reasons).toBeVisible();
    const reasonsText = (await reasons.textContent()) ?? "";
    expect(
      /NO_HISTORY|INSUFFICIENT_BARS|INGEST_/.test(reasonsText) || /nothing missing/.test(reasonsText),
      `missing-reason block is neither typed reasons nor the stated empty:\n${reasonsText}`,
    ).toBe(true);
    await expect(coverage).toContainText("SME");

    // The trial-switch metric: one row per pinned family, each with its own requirement.
    const familyReady = page.getByTestId("coverage-family-readiness");
    await expect(familyReady).toBeVisible();
    await expect(page.getByTestId("coverage-family-row")).toHaveCount(5);
    const firstFamilyRow = page.getByTestId("coverage-family-row").first();
    await expect(firstFamilyRow.locator("td")).toHaveCount(6);
    // The requirement column states bars (and sessions for intraday families), never a bare number.
    await expect(familyReady).toContainText(/\d+d( \+ \d+×5m)?/);

    // The pre-registered activation gate states its decision and its blockers.
    const activation = page.getByTestId("trial-activation");
    await expect(activation).toBeVisible();
    await expect(activation).toContainText("PRE-REGISTERED GATE");
    await expect(page.getByTestId("trial-activation-state")).toContainText(/^(ON|OFF) · criteria (not )?satisfied$/);
    await expect(activation).toContainText(/criteria pinned [0-9a-f]{16}/);

    // Fetch integrity is always stated — registered ledger, empty ledger, or unregistered.
    const fetchHealth = page.getByTestId("coverage-fetch-health");
    await expect(fetchHealth).toBeVisible();
    await expect(fetchHealth).toContainText(/ledger not registered|no fetches recorded yet|COMPLETE|PARTIAL|EMPTY|SESSION_GAPS/);
    await expect(coverage).toContainText("historical backfill + live accumulation");

    // v2 — the diagnosis block: threshold-met readings, or the stated silence. Never absent.
    const diagnosis = page.getByTestId("quant-diagnosis");
    await expect(diagnosis).toBeVisible();
    await expect(diagnosis).toContainText(/no diagnosis yet|→/);

    // Nothing on the page may claim a number that is not a number.
    const panelText = (await panel.textContent()) ?? "";
    expect(panelText).not.toMatch(/NaN|undefined|Infinity/);

    expect(problems, `page problems:\n  - ${problems.join("\n  - ")}`).toEqual([]);
  });
});
