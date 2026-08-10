import { expect, test, type Page } from "@playwright/test";

/**
 * P3 — the Strategy Factory as ONE flow (desktop only).
 *
 * What is under test is the JOURNEY, not the engines behind it (each engine has its own suite):
 * an idea typed in prose advances through interpretation → backtest → validate as connected,
 * visible steps; a fresh database's missing bars surface as a stated step outcome rather than a
 * dead end; and the discovery entrance shows the autonomous side from the durable run log.
 * Every step asserts on the real network response, per the mission's acceptance rules.
 */

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const RUN_STAMP = Date.now().toString(36);

test.describe("strategy factory — one guided flow", () => {
  test("an idea walks the rail: interpretation, free backtest, gated validation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(120_000);
    const pageErrors = collectPageErrors(page);

    await page.goto("/strategies", { waitUntil: "domcontentloaded" });
    const flow = page.getByTestId("factory-flow");
    await expect(flow).toBeVisible();

    // Entrance A is the default and the composer (the professor path's precondition) is live.
    await expect(page.getByTestId("factory-mode-build")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("hypothesis-composer")).toBeVisible();
    await expect(page.getByTestId("factory-step-1")).toContainText(/idea/i);

    // Step 1: a real, expressible idea through the embedded composer.
    await page.getByTestId("hypothesis-title").fill(`Factory flow gap idea ${RUN_STAMP}`);
    await page
      .getByTestId("hypothesis-statement")
      .fill(
        "NSE liquid names gapping with gap >= 3% on relative volume >= 1.5 continue upward " +
          "intraday after realistic round-trip costs, because the opening imbalance persists.",
      );
    const triage = page.waitForResponse((response) => response.url().includes("/api/research/hypotheses") && response.request().method() === "POST");
    await page.getByTestId("hypothesis-submit").click();
    expect((await triage).status()).toBe(201);

    // Step 2: the interpretation renders and the rail advances to the backtest step.
    await expect(page.getByTestId("hypothesis-result")).toContainText("EXPRESSIBLE");
    await expect(page.getByTestId("factory-backtest-step")).toBeVisible();

    // Step 3: the backtest runs against the real route; both honest outcomes are acceptable and
    // both must be STATED — trades with provenance, or the named refusal with the remedy.
    const backtestResponse = page.waitForResponse((response) => response.url().includes("/api/strategy/trades"));
    await page.getByTestId("factory-backtest").click();
    const backtestStatus = (await backtestResponse).status();
    const result = page.getByTestId("factory-backtest-result");
    await expect(result).toBeVisible({ timeout: 60_000 });

    if (backtestStatus === 200) {
      await expect(result).toContainText(/trade\(s\)|snapshot/i);
      // Steps 4-5 unlock only from a completed backtest.
      await expect(page.getByTestId("factory-validate")).toBeVisible();
      await expect(page.getByTestId("factory-validate").getByTestId("run-gauntlet")).toBeVisible();
      await expect(page.getByTestId("factory-forward")).toContainText(/REPLAY/);
    } else {
      // Fresh database: the canonical store holds no intraday bars. The flow must say exactly
      // that and must NOT unlock a validation that could only refuse.
      await expect(result).toContainText(/NO_DATA|SNAPSHOT|INSUFFICIENT|no bars|holds no/i);
      await expect(result).toContainText(/Nothing was invented/i);
      await expect(page.getByTestId("factory-validate")).toHaveCount(0);
    }

    expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("the discovery entrance shows the autonomous side from the durable log", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

    await page.goto("/strategies", { waitUntil: "domcontentloaded" });
    const cycles = page.waitForResponse((response) => response.url().includes("/api/cycles"));
    await page.getByTestId("factory-mode-discover").click();
    expect((await cycles).status()).toBe(200);

    const discover = page.getByTestId("factory-discover");
    await expect(discover).toBeVisible();
    // The counts are real numbers from the same log the terminal reads — including the idea the
    // previous test recorded (authored) on this shared database.
    await expect(page.getByTestId("factory-discover-counts")).toContainText(/Held ideas: \d+/);
    await expect(page.getByTestId("factory-discover-counts")).toContainText(/Authored strategies: \d+/);
    await expect(discover.getByTestId("run-cycle")).toBeVisible();
    // Either state of the world is stated, never blank: runs exist, or none has run yet.
    await expect(discover).toContainText(/Last cycle|No autonomous cycle has run/);
  });
});
