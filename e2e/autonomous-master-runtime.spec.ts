import { expect, test } from "@playwright/test";

/**
 * Task 1 acceptance: the one button, driven as a person drives it.
 *
 * This is the test that decides whether Task 1 is real. Unit tests prove the bookkeeping; only this
 * proves that a human can open `/brain`, press Start once, and walk away — which is the entire
 * product contract.
 *
 * Deliberately NOT a screenshot pass. Every assertion is on user-visible state reached by clicking,
 * reloading and waiting, and the durable side is checked through the product's own status endpoint
 * rather than by reading the database behind the UI's back.
 *
 * Server restart (property 5) is exercised in the unit suite, where the process can actually be
 * killed; here the observable half is asserted — a reload finds the SAME run, never a second one.
 */

/**
 * A mutation must look like it came from the app: same loopback origin plus the CSRF header.
 * Playwright's `request` fixture is not a browser fetch, so it sends no Origin of its own and the
 * server correctly refuses it — the guard is doing its job, and the test must speak its language.
 */
const ORIGIN = process.env.MARKETPULSE_E2E_BASE_URL?.trim() || "http://127.0.0.1:3100";
const MUTATION = {
  headers: { "x-marketpulse-csrf": "1", "content-type": "application/json", origin: ORIGIN },
};

test.describe("autonomous master runtime", () => {
  test.beforeEach(async ({ request }) => {
    // Start from a stopped machine so "already running" from an earlier spec cannot make this pass.
    await request.post("/api/system/stop", { ...MUTATION, data: { reason: "test setup" } }).catch(() => undefined);
  });

  test.afterEach(async ({ request }) => {
    await request.post("/api/system/stop", { ...MUTATION, data: { reason: "test teardown" } }).catch(() => undefined);
  });

  test("press Start once and the machine runs itself", async ({ page, request }) => {
    await page.goto("/brain");

    const control = page.getByTestId("autonomous-control");
    await expect(control).toBeVisible();

    const start = page.getByTestId("start-marketpulse");
    await expect(start).toBeEnabled();
    // Before the press, the product must say plainly that nothing is running.
    await expect(page.getByTestId("system-status")).toHaveText(/NEVER STARTED|STOPPED|CRASHED/);

    await start.click();

    // Assert the ABSENCE of a refusal first. The control reports its own failures in an alert, and
    // checking only the status left "the button did nothing" and "the request was rejected for a
    // stated reason" looking identical — which cost real diagnosis time when the CSRF header was
    // missing from the fetch.
    //
    // Scoped to the control: the page chrome carries a permanent `role="alert"` live region for
    // instrument search, so an unscoped count is never zero and the assertion would only ever
    // report the wrong thing.
    await expect(control.getByRole("alert")).toHaveCount(0);

    // Web-first assertion: the status becomes live rather than the test sleeping and hoping.
    await expect(page.getByTestId("system-status")).toHaveText(/STARTING|RUNNING|DEGRADED/, {
      timeout: 30_000,
    });
    await expect(start).toBeDisabled();
    await expect(page.getByTestId("stop-marketpulse")).toBeVisible();

    // The run is durable, not a client-side flag.
    const status = await (await request.get("/api/system/status")).json();
    expect(status.running).toBe(true);
    expect(status.run.id).toMatch(/^arun_/);
    expect(status.run.governanceCeiling).toBeTruthy();
  });

  test("a second press returns the same run — never a second machine", async ({ page, request }) => {
    await page.goto("/brain");
    await page.getByTestId("start-marketpulse").click();
    await expect(page.getByTestId("system-status")).toHaveText(/STARTING|RUNNING|DEGRADED/, {
      timeout: 30_000,
    });

    const first = await (await request.get("/api/system/status")).json();

    // The button disables itself, so the real double-press risk is two tabs or two API calls
    // arriving together. Fire them concurrently — that is the race the storage layer must lose.
    const [a, b] = await Promise.all([
      request.post("/api/system/start", { ...MUTATION, data: { runtimeProfile: "SUBSCRIPTION_FIRST" } }),
      request.post("/api/system/start", { ...MUTATION, data: { runtimeProfile: "SUBSCRIPTION_FIRST" } }),
    ]);

    const runA = (await a.json()).run;
    const runB = (await b.json()).run;
    expect(runA.id).toBe(first.run.id);
    expect(runB.id).toBe(first.run.id);

    const after = await (await request.get("/api/system/status")).json();
    expect(after.run.id).toBe(first.run.id);
  });

  test("a reload finds the same run still running", async ({ page, request }) => {
    await page.goto("/brain");
    await page.getByTestId("start-marketpulse").click();
    await expect(page.getByTestId("system-status")).toHaveText(/STARTING|RUNNING|DEGRADED/, {
      timeout: 30_000,
    });
    const before = await (await request.get("/api/system/status")).json();

    await page.reload();

    await expect(page.getByTestId("system-status")).toHaveText(/STARTING|RUNNING|DEGRADED/, {
      timeout: 30_000,
    });
    const after = await (await request.get("/api/system/status")).json();
    expect(after.run.id, "a reload must not start a second machine").toBe(before.run.id);
  });

  test("Stop ends the run, and the product says so", async ({ page, request }) => {
    await page.goto("/brain");
    await page.getByTestId("start-marketpulse").click();
    await expect(page.getByTestId("stop-marketpulse")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("stop-marketpulse").click();

    await expect(page.getByTestId("system-status")).toHaveText(/STOPPED/, { timeout: 30_000 });
    await expect(page.getByTestId("start-marketpulse")).toBeEnabled();

    const status = await (await request.get("/api/system/status")).json();
    expect(status.running).toBe(false);
    // "Stopped a moment ago" and "never started" are different states and must stay distinguishable.
    expect(status.last?.status).toBe("STOPPED");
  });

  test("the console reports real state, not placeholders", async ({ page }) => {
    await page.goto("/brain");
    await page.getByTestId("start-marketpulse").click();
    await expect(page.getByTestId("system-status")).toHaveText(/STARTING|RUNNING|DEGRADED/, {
      timeout: 30_000,
    });

    const control = page.getByTestId("autonomous-control");
    await expect(control).toContainText(/MARKET MODE/);
    await expect(control).toContainText(/CEILING/);
    await expect(control).toContainText(/QUEUE/);

    // The market mode must be a real calendar reading, never a hardcoded word.
    await expect(control).toContainText(/PRE_MARKET|MARKET_OPEN|POST_MARKET|OFF_HOURS|BOOTSTRAP/);
    await expect(page.getByTestId("next-action")).toContainText(/NEXT ACTION/);
  });

  test("no unexplained console errors while the machine runs", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
    });

    await page.goto("/brain");
    await page.getByTestId("start-marketpulse").click();
    await expect(page.getByTestId("system-status")).toHaveText(/STARTING|RUNNING|DEGRADED/, {
      timeout: 30_000,
    });
    // Long enough to cover at least one status poll, so a broken poll cannot hide.
    await expect(page.getByTestId("autonomous-control")).toContainText(/TICKS/);

    expect(problems, problems.join("\n")).toHaveLength(0);
  });
});
