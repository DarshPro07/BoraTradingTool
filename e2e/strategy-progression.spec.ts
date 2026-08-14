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

/**
 * The sealed-holdout surface: seal a real window over ingested history, watch the confirm gate
 * refuse a bare authorization, authorize, and see the panel state the whole story. The
 * EVALUATION itself is deliberately not driven here — it spends a family's one look and is
 * proven by lib/strategy/holdout-evaluator.test.ts; this journey proves the owner-facing
 * apparatus: definition, states, confirm gate, and the panel's truth.
 */
test.describe("sealed holdout — the apparatus is visible and gated", () => {
  test("seal → 428 without confirm → authorize → panel states it", async ({ page, request, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    await ensureLocalSession(request);

    // Real history to seal (fixture master serves 260 daily bars per instrument in TEST_MODE).
    // Two instruments: one alone leaves the default trailing window ~52 bars, below the 60-bar
    // daily floor — and the seal REFUSED it (WINDOW_TOO_THIN), which is the apparatus working.
    for (const instrumentId of ["IN:XNSE:RELIANCE", "IN:XNSE:TCS"]) {
      const ingest = await request.post("/api/market/ingest", {
        headers: headers(baseURL!),
        data: { instrumentId },
      });
      expect(ingest.ok()).toBe(true);
    }

    const sealed = await request.post("/api/strategy/holdout", {
      headers: headers(baseURL!),
      data: { market: "NSE", resolution: "D" },
    });
    // 201 on the first project pass; 409 ACTIVE_SEAL_EXISTS if a prior pass on this shared DB
    // already sealed — both are the apparatus telling the truth. Recover the live seal either way.
    expect([201, 409]).toContain(sealed.status());
    const listing = await request.get("/api/strategy/holdout");
    expect(listing.ok()).toBe(true);
    const seals = ((await listing.json()) as { seals: { id: string; state: string; barCount: number }[] }).seals;
    const live = seals.find((seal) => seal.state === "SEALED" || seal.state === "AUTHORIZED_FOR_EVALUATION");
    expect(live, "a live seal must exist after sealing").toBeDefined();
    expect(live!.barCount).toBeGreaterThan(0);

    // The confirm gate: a bare authorization is refused with 428 and the seal is untouched.
    if (live!.state === "SEALED") {
      const bare = await request.post("/api/strategy/holdout/authorize", {
        headers: headers(baseURL!),
        data: { holdoutId: live!.id },
      });
      expect(bare.status()).toBe(428);

      const confirmed = await request.post("/api/strategy/holdout/authorize", {
        headers: headers(baseURL!),
        data: { holdoutId: live!.id, confirm: true },
      });
      expect(confirmed.ok()).toBe(true);
      expect(((await confirmed.json()) as { seal: { state: string } }).seal.state).toBe("AUTHORIZED_FOR_EVALUATION");
    }

    // The panel states the seal and its one next act.
    await page.goto("/strategies", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("holdout-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("holdout-seal-state").first()).toContainText(/AUTHORIZED FOR EVALUATION|SEALED/);
    await expect(panel).toContainText(/pinned rule/i);
    await expect(panel).toContainText(/holdout_decision \{specId, confirmed:true\}|Authorize \(confirm\)/);
  });
});
