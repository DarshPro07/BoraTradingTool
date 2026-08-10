import { expect, test } from "@playwright/test";

/**
 * The intraday contract, asserted against the running application.
 *
 * ## Why through the API rather than a screen
 *
 * Playwright runs against a fresh per-run database, so the intraday strategies authored into the
 * owner's registry do not exist here. Asserting on a screen would therefore test an empty state,
 * which says nothing about whether the square-off rule reached the compiler.
 *
 * The authoring route is the honest place to test it: it is the real door every strategy comes
 * through, and it exercises the schema, the compiler, the cost gate and the store together in the
 * running server. A unit test proves the rule; this proves the rule is *wired*.
 *
 * ## What this is really guarding
 *
 * Three defects, all of the same shape, were found building this capability — each one a layer
 * that knew a strategy's market and assumed that settled which bars to hand it, or which clock to
 * read. Every one of them compiled, passed its unit tests, and produced plausible numbers. The
 * assertions below are the ones that fail loudly if any of that regresses at the boundary.
 */

/** The mutation boundary: loopback, same origin, and an explicit CSRF header. */
function headers(baseURL: string) {
  return {
    "content-type": "application/json",
    origin: baseURL,
    "x-marketpulse-csrf": "1",
  };
}

const INTRADAY = {
  universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
  entry: {
    all: [
      { compare: ["close", "opening_range_high"], op: "gt" },
      { feature: "minutes_since_open", op: "gte", value: 15 },
    ],
  },
  exit: { stopLossPct: 0.5, takeProfitPct: 1 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
};

/**
 * A name nothing else will claim.
 *
 * `strategy_specs` is unique on (name, version) and the route answers a repeat with 409 by design —
 * a second version of a strategy carries its own trial history and is never minted by accident. The
 * desktop and mobile projects run this file against one server, so a fixed name would make the
 * second project's run fail on the first project's success.
 */
const RUN_STAMP = Date.now().toString(36);
const unique = (base: string, project: string) =>
  `e2e_${base}_${RUN_STAMP}_${project.replace(/[^a-z0-9]/gi, "_")}`;

test.describe("the intraday authoring contract", () => {
  test("accepts an opening-range strategy and states the square-off it cannot escape", async ({
    request,
    baseURL,
  }, testInfo) => {
    const response = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: { dsl: { ...INTRADAY, name: unique("orb", testInfo.project.name) }, createdBy: "e2e" },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();

    // The opening range is a real feature the engine derives, not a name the compiler tolerated.
    expect(body.features).toContain("opening_range_high");
    expect(body.features).toContain("minutes_since_open");

    // The deadline is stated on every intraday spec, including one that never mentions it — with
    // its provenance, because the number is a broker's documented rule, not this system's opinion.
    // 15:25 is Zerodha's non-CAS equity square-off, fetched from support.zerodha.com on
    // 2026-08-09; the old hardcoded 15:20 was an unsourced recollection.
    const warnings = body.warnings.join(" ");
    expect(warnings).toMatch(/whether or not this spec says so/i);
    expect(warnings).toMatch(/ZERODHA/);
    expect(warnings).toMatch(/15:25/);
    expect(warnings).toMatch(/fetched 2026-08-09/);
    // Scope limits travel with the number: the profile's assumptions are surfaced, not buried.
    expect(warnings).toMatch(/non-CAS/);
  });

  test("refuses a square-off that would outlast the broker's, rather than clamping it", async ({
    request,
    baseURL,
  }) => {
    // Clamping would let the stored specification claim 15:29 while the run behaved as 15:20 — a
    // spec describing something that never happened, which is the failure mode this whole
    // capability was built to remove.
    const response = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: {
        dsl: { ...INTRADAY, name: "e2e_late_squareoff", exit: { ...INTRADAY.exit, squareOffAt: "15:29" } },
        createdBy: "e2e",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/may only tighten/);
  });

  test("refuses an opening range on daily bars, which have no inside", async ({ request, baseURL }) => {
    // Undefined on every bar would mean the strategy never evaluates and reports zero trades —
    // which reads as a finding about the market rather than a broken specification.
    const response = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: {
        dsl: {
          ...INTRADAY,
          name: "e2e_orb_at_daily",
          universe: { market: "NSE", maxPositions: 4, resolution: "D" },
          costs: { commissionBps: 5, slippageBps: 7 },
        },
        createdBy: "e2e",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("SESSION_FEATURE_AT_DAILY");
  });

  test("still refuses an intraday strategy that declares no spread", async ({ request, baseURL }) => {
    // The pre-existing guard, re-asserted at the boundary: this deployment cannot measure a spread,
    // and at 5-minute resolution it is frequently larger than the edge.
    const response = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: {
        dsl: {
          ...INTRADAY,
          name: "e2e_no_spread",
          costs: { commissionBps: 5, slippageBps: 7 },
        },
        createdBy: "e2e",
      },
    });

    expect(response.status()).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/assumedSpreadBps/);
  });
});

test.describe("the guarded gauntlet", () => {
  test("never spends a trial without an explicit confirmation", async ({ request, baseURL }) => {
    // Briefly asserted 423 RESEARCH_FROZEN while the research-identity repair was in flight. The
    // freeze is lifted and the confirmation gate underneath it is load-bearing again: a trial
    // permanently raises the bar for the whole strategy family, so a caller that has not said it
    // understands the cost has almost certainly not intended to pay it.
    const response = await request.post("/api/strategy/gauntlet", {
      headers: headers(baseURL!),
      data: { specId: "stg_does_not_exist" },
    });

    expect(response.status()).toBe(428);
    const body = await response.json();
    expect(body.error).toBe("CONFIRMATION_REQUIRED");
    expect(body.message).toMatch(/permanently raises the bar/);
  });
});

test.describe("the learning page shows progress, not just activity", () => {
  test("renders the metrics panel with the execution assumptions strip", async ({ page }) => {
    // The two disciplines this panel exists for, asserted on a fresh database where they are most
    // likely to be violated: activity and progress are separate columns, and a quantity that
    // cannot be measured says so instead of showing a zero.
    await page.goto("/learning", { waitUntil: "domcontentloaded" });

    const body = page.locator("body");
    await expect(page.getByText("LEARNING PROGRESS").first()).toBeVisible();
    await expect(body).toContainText(/ACTIVITY/);
    await expect(body).toContainText(/rises whether or not anything is learned/i);
    await expect(body).toContainText(/PROGRESS/);

    // Evidence yield divides by trials spent. With zero trials the panel must say "unmeasured",
    // never "0" — a ratio over zero spending is not a measurement. Conditional because other
    // suites in this run may legitimately spend trials first (the 13b gauntlet e2e does), and
    // 0 forward observations over N>0 trials is then a real, measured zero.
    const pageText = (await body.innerText()).replace(/\s+/g, " ");
    if (/Selection trials spent\s*0\b/.test(pageText)) {
      await expect(body).toContainText(/n\/a/);
    } else {
      await expect(body).toContainText(/Selection trials spent/);
    }

    // The broker assumptions strip: the deadline every intraday number rests on, with provenance.
    await expect(body).toContainText("EXECUTION ASSUMPTIONS");
    await expect(body).toContainText(/ZERODHA/);
    await expect(body).toContainText(/15:25/);
    await expect(body).toContainText(/fetched 2026-08-09/);
  });
});
