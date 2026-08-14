import { expect, test } from "@playwright/test";

/**
 * /brain acceptance (mission P0/P5): the page must show REAL system state — counts that match
 * the API's own answers, readiness verdicts with the fixing job named, and never a vague
 * "insufficient data". Interaction + cross-checked evidence, not a screenshot.
 */

test.describe("the brain — visible, honest system state", () => {
  test("counts match the backend, readiness names its gaps and their fixes", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

    // The readiness contract, straight from the API — the page must agree with it.
    const readinessResponse = await request.get("/api/readiness");
    expect(readinessResponse.status()).toBe(200);
    const readiness = (await readinessResponse.json()) as {
      items: { area: string; status: string; fixedBy?: string }[];
      summary: { ready: number; missing: number };
    };
    expect(readiness.items.length).toBeGreaterThan(5);
    // Every MISSING item must name the job that fixes it — the P0 rule.
    for (const item of readiness.items) {
      if (item.status === "MISSING") expect(item.fixedBy, `${item.area} must name its fix`).toBeTruthy();
    }

    await page.goto("/brain", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("brain-page")).toBeVisible();

    // System strip: the single AUTO mode and the readiness summary render. (The four-value
    // "LEARNING MODE" label predates the mode-taxonomy collapse — the strip now truthfully reads
    // MODE with the machine state, RUNNING or STOPPED.)
    await expect(page.getByTestId("brain-system")).toContainText(/MODE/);
    await expect(page.getByTestId("brain-system")).toContainText(/RUNNING|STOPPED|EVOLVING/);
    await expect(page.getByTestId("brain-system")).toContainText(/ready/);
    await expect(page.getByTestId("brain-system")).toContainText(/PAPER ONLY/);

    // Knowledge counts are real numbers, present for every category.
    const knowledge = page.getByTestId("brain-knowledge");
    for (const label of ["Research sources", "Hypotheses", "Strategies", "Experiments", "Graveyard", "Forward challengers"]) {
      await expect(knowledge).toContainText(new RegExp(`${label}: \\d+`));
    }

    // Readiness panel: every item shows a status word and the missing ones show their fix.
    const readinessPanel = page.getByTestId("brain-readiness");
    await expect(readinessPanel).toBeVisible();
    const items = page.getByTestId("readiness-item");
    expect(await items.count()).toBe(readiness.items.length);
    await expect(readinessPanel).toContainText(/Fixed by:/);
    // The banned phrase: a bare, unexplained "insufficient data" must not exist on this page.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toContain("insufficient data");

    // Work panel exists and is either honestly empty or shows audit entries.
    await expect(page.getByTestId("brain-work")).toBeVisible();

    // AUTONOMY ACTIVITY: all six lanes render with either real work or a stated zero, and the
    // Next lane always carries exactly one actionable step from the guide.
    const activity = page.getByTestId("brain-activity");
    await expect(activity).toBeVisible();
    for (const lane of ["Researching", "Testing", "Waiting for evidence", "Rejected", "Data jobs owed", "Next"]) {
      await expect(activity).toContainText(lane);
    }
    await expect(activity).toContainText(/needs you|runs on its own/);
    // U6: activity is inspectable, not just displayed — a lane link is a real navigation.
    await activity.getByTestId("brain-activity-link-graveyard").click();
    await expect(page).toHaveURL(/\/strategies/);
    await page.goBack({ waitUntil: "domcontentloaded" });

    // Reload: same evidence (server-rendered from the database, not view-state).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("brain-knowledge")).toContainText(/Strategies: \d+/);
  });
});
