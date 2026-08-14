import { expect, test } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * Strategy progression truth (owner requirement 2026-08-14): a strategy either advances, or the
 * surface STATES what it is waiting on. The funnel counts the DERIVED stage machine — one source
 * with the per-row stages — and the typed `blockedOn` (computed every cycle, previously rendered
 * nowhere) is on the page.
 */

const RUN_STAMP = Date.now().toString(36);

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

test.describe("strategy progression states its path", () => {
  test("a draft strategy is counted by the ladder and shows its typed wait", async ({ page, request, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    await ensureLocalSession(request);

    // A guaranteed-stalled subject: authored through the real door, never rehearsed.
    const name = `progression_probe_${RUN_STAMP}_${testInfo.project.name.replace(/[^a-z0-9]/gi, "_")}`;
    const authored = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: {
        dsl: {
          name,
          universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
          entry: { all: [{ feature: "minutes_since_open", op: "gte", value: 15 }] },
          exit: { stopLossPct: 0.5, takeProfitPct: 1 },
          sizing: { maxPositionPct: 25 },
          costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
        },
        createdBy: "e2e",
      },
    });
    expect(authored.status()).toBe(201);

    await page.goto("/strategies", { waitUntil: "domcontentloaded" });

    // The funnel exists and speaks the LADDER's language — stage-machine rungs, not raw-table
    // proxies (the old REHEARSED bar was the rehearsal's own per-cycle cap, shown as a count).
    const funnel = page.getByTestId("validation-funnel");
    await expect(funnel).toBeVisible();
    await expect(funnel).toContainText("AUTHORED");
    await expect(funnel).toContainText("VALIDATED");
    await expect(funnel).toContainText("HOLDOUT");

    // The typed waiting summary — blockedOn, aggregated. With at least one never-rehearsed
    // draft on the registry, the funnel must say so.
    await expect(page.getByTestId("funnel-waiting")).toContainText(/Waiting — .*on rehearsal/);

    // And the row itself carries the wait beside its stage.
    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/draft/);
    await expect(row.getByTestId("stage-blocked-on")).toContainText(/waiting on rehearsal/i);
  });
});
