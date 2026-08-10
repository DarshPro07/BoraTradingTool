import { expect, test, type Page } from "@playwright/test";

/**
 * U3/U4 — the Research-this-stock surface, now driven by the real M5 bridge (desktop only).
 *
 * What is under test is HONESTY OF STATUS. The surface has two legitimate outcomes and this spec
 * accepts either, because which one occurs depends on what the store actually holds — but it
 * holds each to its own invariant, so "something rendered" can never pass:
 *
 *   REFUSAL   the store has no bars for this instrument, or no provider is installed. A named
 *             code and a reason must render. Nothing that looks like a proposal may appear.
 *   ENVELOPE  a provider ran. The hand-off is enabled if and ONLY if MarketPulse assigned
 *             SOURCE_VERIFIED, and an unverified result must carry its warning banner.
 *
 * The SOURCE_VERIFIED path is deliberately NOT forced here. Calling a real model inside the suite
 * would make it slow, nondeterministic and chargeable per run. That path is proven instead by the
 * recorded live run in TEST_RESULTS (SBIN, claude-sonnet-5, 3/3 citations verified) and by the
 * unit tests in lib/research/bridge.test.ts, which cover the rejection cases a happy-path e2e
 * could never reach.
 */

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("research this stock — real bridge, honestly labelled", () => {
  test("the session runs against the real endpoint and every outcome states what it is", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    const pageErrors = collectPageErrors(page);

    await page.goto("/analyze/IN%3AXNSE%3ARELIANCE", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("research-stock");
    await expect(panel).toBeVisible();

    // The opening state depends on the ledger, so asserting IDLE unconditionally would assert a
    // falsehood the moment persistence works. The honest invariant: the panel is IDLE when
    // nothing is stored, and shows a labelled restored run when something is.
    const restoredOnLoad = page.getByTestId("research-stock-restored");
    const stateLabel = page.getByTestId("research-stock-state");
    await expect(restoredOnLoad.or(stateLabel).first()).toBeVisible({ timeout: 30_000 });
    if (await restoredOnLoad.isVisible()) {
      await expect(stateLabel).toHaveText(/PROPOSAL READY|NEEDS EVIDENCE/);
    } else {
      await expect(stateLabel).toHaveText(/IDLE/);
    }

    // The button no longer advertises fixture mode, because there is no longer a fixture driver.
    const runButton = page.getByTestId("research-stock-run");
    await expect(runButton).toContainText(/research this stock/i);

    // The request must actually leave the browser — a surface that resolves locally is the exact
    // failure this bridge exists to end.
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/research/stock"), { timeout: 300_000 }),
      runButton.click(),
    ]);
    expect(response.status()).toBe(200);

    const refusal = page.getByTestId("research-stock-refusal");
    const proposal = page.getByTestId("research-stock-proposal");
    await expect(refusal.or(proposal).first()).toBeVisible({ timeout: 300_000 });

    if (await refusal.isVisible()) {
      // A refusal names its cause and offers no proposal to mistake for research.
      await expect(page.getByTestId("research-stock-state")).toHaveText(/FAILED/);
      await expect(refusal).toContainText(/NO_STORED_DATA|PROVIDER_UNAVAILABLE|ADAPTER_MISSING|AGENT_FAILED|AGENT_TIMEOUT|CONTRACT_VIOLATION|UNPARSEABLE_RESULT|BUDGET_EXHAUSTED/);
      await expect(proposal).toHaveCount(0);
    } else {
      // A real envelope: the hand-off gate must follow MarketPulse's verification, not the
      // provider's confidence.
      const status = await page.getByTestId("research-stock-status").textContent();
      const handoff = page.getByTestId("research-stock-handoff");
      await expect(proposal).toContainText(/never strategy confidence/i);

      if (status?.includes("SOURCE_VERIFIED")) {
        await expect(page.getByTestId("research-stock-verified-banner")).toBeVisible();
        await expect(handoff).toBeEnabled();
      } else {
        await expect(page.getByTestId("research-stock-unverified-banner")).toBeVisible();
        await expect(handoff).toBeDisabled();
        await expect(proposal).toContainText(/never become a\s+hypothesis/i);
      }

      // Golden Journey step 25: reload, evidence persists. A run costs real quota and real
      // minutes — a surface that forgets it on refresh teaches the owner the system has no
      // memory. The restored copy comes from the agent-run ledger, re-validated through the
      // contract on the way out.
      const thesisBefore = await page.getByTestId("research-stock-thesis").textContent();
      await page.reload({ waitUntil: "domcontentloaded" });

      const restored = page.getByTestId("research-stock-restored");
      await expect(restored).toBeVisible({ timeout: 30_000 });
      await expect(restored).toContainText(/agent-run ledger/i);
      await expect(page.getByTestId("research-stock-status")).toHaveText(String(status));
      // The same research, not merely something with the same shape.
      await expect(page.getByTestId("research-stock-thesis")).toHaveText(String(thesisBefore));
    }

    expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
