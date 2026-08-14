import { expect, test } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * P2 — LIVE / REPLAY validation surface (mission P2; desktop only).
 *
 * The rule under test is labelling, not signal generation: a pass run "as of" a stated instant
 * must come back labelled REPLAY — HISTORICAL EVIDENCE with that instant, attested by the
 * server's own response — and a replay result must never read as live. The spec deliberately
 * needs no seeded challengers: a 0-signal replay on a fresh database is an honest, labelled
 * answer, and the labelling path is identical.
 */

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

test.describe("LIVE / REPLAY — the mode is explicit and every result is labelled", () => {
  test("replay demands an instant, labels its result, and never reads as live", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

    await page.goto("/paper", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("forward-panel");
    await expect(panel).toBeVisible();

    // Both modes exist, LIVE is the default, and the run button says so.
    const live = page.getByTestId("forward-mode-live");
    const replay = page.getByTestId("forward-mode-replay");
    await expect(live).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("forward-run")).toHaveText(/run shadow pass/i);

    // REPLAY without an instant cannot run — "as of now" would be live wearing a costume.
    await replay.click();
    await expect(replay).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("forward-asof")).toBeVisible();
    await expect(page.getByTestId("forward-run")).toBeDisabled();
    await expect(page.getByTestId("forward-run")).toHaveText(/run replay pass/i);

    // With an instant, the pass runs and the result carries the server-attested label.
    await page.getByTestId("forward-asof").fill("2026-08-03T10:00");
    await expect(page.getByTestId("forward-run")).toBeEnabled();
    await page.getByTestId("forward-run").click();

    const note = page.getByTestId("forward-note");
    await expect(note).toContainText("REPLAY — HISTORICAL EVIDENCE as of 2026-08-03");
    await expect(note).not.toContainText(/LIVE/);

    // Back in LIVE, the same action labels itself as the wall clock.
    await live.click();
    await expect(page.getByTestId("forward-run")).toHaveText(/run shadow pass/i);
    await page.getByTestId("forward-run").click();
    await expect(note).toContainText("LIVE (wall clock");
    await expect(note).not.toContainText(/REPLAY/);
  });

  test("the API itself attests the mode and the instant that ran", async ({ request, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

    await ensureLocalSession(request);

    const asOf = "2026-08-03T04:30:00.000Z";
    const replayed = await request.post("/api/forward/run", { headers: headers(baseURL!), data: { asOf } });
    expect(replayed.status()).toBe(200);
    const replayBody = (await replayed.json()) as { mode: string; evaluatedAsOf: string };
    expect(replayBody.mode).toBe("REPLAY");
    expect(replayBody.evaluatedAsOf).toBe(asOf);

    const liveRun = await request.post("/api/forward/run", { headers: headers(baseURL!), data: {} });
    expect(liveRun.status()).toBe(200);
    const liveBody = (await liveRun.json()) as { mode: string; evaluatedAsOf: string };
    expect(liveBody.mode).toBe("LIVE");
    // The wall-clock instant is attested too, and it is recent rather than echoed from nowhere.
    expect(Math.abs(Date.now() - new Date(liveBody.evaluatedAsOf).getTime())).toBeLessThan(60_000);
  });
});
