import { expect, test, type Page } from "@playwright/test";

/**
 * NSE market dashboard — the numbers must say where they came from.
 *
 * ## The defect this suite exists for
 *
 * The owner reported `/dashboard?market=NSE` showing many stocks near ₹1,000 with identical
 * percentage and absolute changes, and sector tiles carrying duplicated values. Traced to
 * `fixtureQuote` in `lib/market/service.ts`:
 *
 *   price      = TEST_PRICES[id] ?? 1_000     // three instruments are listed; every other NSE
 *                                             // security therefore renders at ₹1,000
 *   changePct  = 0.5                          // identical for every stock
 *   change     = price * 0.005                // identical ₹5.00 on every ₹1,000 stock
 *   volume     = 1_500_000                    // identical
 *   quality    = "LIVE"                       // ← the actual defect
 *
 * The sector tiles were not separately faked: `sectorBreadth()` averages those quotes, so
 * identical inputs produce identical tiles. Same for gainers/losers.
 *
 * Verified by experiment: with `MARKETPULSE_TEST_MODE=0` the same page renders real, varied prices
 * (₹2,445.70, ₹729.00, ₹1,323.90, ₹279.13 …). The data path was never broken. What was broken is
 * that fabricated numbers described themselves as LIVE and the page had no way to say otherwise —
 * its provenance line was a fixed sentence about Yahoo that stayed true-sounding regardless of
 * what actually served the page.
 *
 * So these tests assert PROVENANCE and DISCLOSURE, not prices. Asserting a specific market price
 * would be a test that fails every morning for the wrong reason.
 */

const NSE_DASHBOARD = "/dashboard?market=NSE";

const ALLOWED_NOISE: Array<{ match: RegExp; because: string }> = [
  { match: /favicon/i, because: "the browser requests /favicon.ico on every navigation" },
  { match: /Download the React DevTools/i, because: "React's development-build advertisement" },
];

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  const allowed = (text: string) => ALLOWED_NOISE.some((entry) => entry.match.test(text));
  page.on("pageerror", (error) => problems.push(`uncaught exception: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (allowed(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (allowed(url)) return;
    const failure = request.failure()?.errorText ?? "";
    // Aborted RSC prefetches are the Next.js prefetcher working as designed — narrow on purpose;
    // see the full reasoning on the same rule in e2e/all-routes.spec.ts.
    if (url.includes("_rsc=") && failure === "net::ERR_ABORTED") return;
    problems.push(`request failed: ${request.method()} ${url} — ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    if (allowed(response.url())) return;
    problems.push(`server error: ${response.status()} ${response.url()}`);
  });
  return problems;
}

test.describe("NSE market dashboard — provenance and honesty", () => {
  test("renders, and states what produced its numbers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    const problems = collectPageProblems(page);

    const response = await page.goto(NSE_DASHBOARD, { waitUntil: "domcontentloaded" });
    expect(response?.status(), "the NSE dashboard did not return 200").toBe(200);

    // The page must NAME its sources rather than carry a fixed sentence about a provider that may
    // not have served anything on this render.
    const summary = page.getByTestId("dashboard-source-summary");
    await expect(summary, "the dashboard does not state where its numbers came from").toBeVisible({
      timeout: 15_000,
    });
    const summaryText = ((await summary.textContent()) ?? "").trim();
    console.log(`[dashboard] sources: ${summaryText}`);

    // Either it served quotes and names a provider and a quality, or it truthfully says it served
    // none. A third option — numbers with no stated origin — is the defect.
    expect(
      summaryText,
      "the source summary names neither a provider/quality nor an absence of quotes",
    ).toMatch(/quality:|no quotes were served/i);

    expect(problems, `dashboard problems:\n  - ${problems.join("\n  - ")}`).toEqual([]);
  });

  test("fabricated quotes are declared, never presented as market data", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

    await page.goto(NSE_DASHBOARD, { waitUntil: "domcontentloaded" });
    const summary = page.getByTestId("dashboard-source-summary");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    const summaryText = ((await summary.textContent()) ?? "").trim();

    const servedFixtures = /TEST_FIXTURE|FIXTURE/.test(summaryText);
    const banner = page.getByTestId("dashboard-fixture-banner");

    if (servedFixtures) {
      // This is the assertion that would have caught the owner's report before they saw it.
      await expect(
        banner,
        "fixture quotes were served and the page did NOT warn that its numbers are invented",
      ).toBeVisible();
      const bannerText = ((await banner.textContent()) ?? "").toUpperCase();
      expect(bannerText).toContain("DEMO DATA");
      expect(bannerText, "the warning must say the figures are not market truth").toMatch(
        /NOT MARKET TRUTH/,
      );
      console.log(`[dashboard] FIXTURE MODE — banner shown: ${bannerText.slice(0, 90)}`);
    } else {
      // Real data must not carry a demo warning either — a permanent banner teaches people to
      // ignore it, which is how the next fixture leak goes unnoticed.
      await expect(
        banner,
        "no fixture quotes were served, yet the page claims DEMO DATA",
      ).toHaveCount(0);
      expect(
        summaryText,
        "real market data must never be reported with FIXTURE quality",
      ).not.toMatch(/FIXTURE/);
      console.log(`[dashboard] REAL DATA — no demo banner, sources: ${summaryText.slice(0, 90)}`);
    }
  });

  test("no quote may describe invented numbers as LIVE", async ({ request }) => {
    // The type-level fix is that `DataQuality` gained FIXTURE and `testProvenance` uses it. This
    // asserts the runtime behaviour that fix exists for, through the product's own API.
    const response = await request.get("/api/market/quote?instrumentId=IN:XNSE:RELIANCE");
    if (!response.ok()) {
      // A quote endpoint that refuses is honest; it is fabrication that is forbidden.
      console.log(`[dashboard] quote endpoint returned ${response.status()} — refusal is acceptable`);
      return;
    }
    const body = (await response.json()) as {
      provenance?: { provider?: string; quality?: string };
    };
    const provider = body.provenance?.provider;
    const quality = body.provenance?.quality;
    console.log(`[dashboard] RELIANCE quote provenance: provider=${provider} quality=${quality}`);

    if (provider === "TEST_FIXTURE") {
      expect(
        quality,
        "a TEST_FIXTURE quote claimed a market quality — this is the exact defect that put " +
          "fabricated ₹1,000 prices on the dashboard looking live",
      ).toBe("FIXTURE");
    }
  });
});

test.describe("data-mode badge — every page states what this server serves", () => {
  // The dashboard banner alone was not enough: /analyze, /scanner and every other market surface
  // read the same fixtures. A warning on one page teaches nobody about the next one, and the
  // owner's confusion came precisely from a market screen that looked normal.
  for (const route of ["/dashboard?market=NSE", "/analyze/IN%3AXNSE%3ARELIANCE", "/scanner"]) {
    test(`${route} carries an accurate data-mode badge`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

      await page.goto(route, { waitUntil: "domcontentloaded" });
      const badge = page.getByTestId("mode-badge");
      await expect(badge, "no data-mode badge in the chrome").toBeVisible({ timeout: 15_000 });

      const mode = await badge.getAttribute("data-data-mode");
      expect(["FIXTURE", "REAL"], `unknown data mode: ${mode}`).toContain(mode);

      const text = ((await badge.textContent()) ?? "").toUpperCase();
      if (mode === "FIXTURE") {
        expect(text, "a fixture server must say DEMO DATA in the chrome").toContain("DEMO DATA");
      } else {
        expect(text, "a real-data server must not claim DEMO DATA").not.toContain("DEMO");
      }
      console.log(`[badge] ${route} -> ${mode} (${text.trim()})`);
    });
  }

  test("the badge agrees with the quotes actually served", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");

    // The badge reads an env flag; the summary reads real provenance. If they ever disagree, one
    // of them is lying and the reader has no way to tell which.
    await page.goto(NSE_DASHBOARD, { waitUntil: "domcontentloaded" });
    const mode = await page.getByTestId("mode-badge").getAttribute("data-data-mode");
    const summary = ((await page.getByTestId("dashboard-source-summary").textContent()) ?? "").trim();

    if (/FIXTURE/.test(summary)) {
      expect(mode, `quotes are fixtures but the badge says ${mode}`).toBe("FIXTURE");
    } else if (/quality:/.test(summary)) {
      expect(mode, `quotes came from a real provider but the badge says ${mode}`).toBe("REAL");
    }
    console.log(`[badge] agreement check: badge=${mode} summary="${summary.slice(0, 80)}"`);
  });
});

test.describe("hard-coded market data detection", () => {
  test("the fixture path is the only source of invented quotes, and it is gated", async () => {
    // §33: a static check against the production market-data definitions, narrowly scoped. It does
    // not ban numeric constants generally — `1000` is a legitimate number in most files.
    const fs = await import("node:fs");
    const source = fs.readFileSync("lib/market/service.ts", "utf8");

    // Every fixture entry point must sit behind the test-mode gate.
    const fixtureCallSites = [...source.matchAll(/return fixture(Quote|Candles)\(/g)];
    expect(fixtureCallSites.length, "fixture entry points not found — has service.ts moved?")
      .toBeGreaterThan(0);

    for (const match of fixtureCallSites) {
      const line = source.slice(0, match.index).split("\n").length;
      const context = source.split("\n")[line - 1];
      expect(
        context,
        `fixture returned at line ${line} without a MARKETPULSE_TEST_MODE guard on the same line: ${context}`,
      ).toMatch(/MARKETPULSE_TEST_MODE/);
    }

    // And the fixture must not stamp itself with a market quality.
    const provenanceBlock = source.slice(
      source.indexOf("function testProvenance"),
      source.indexOf("function fixtureQuote"),
    );
    expect(
      provenanceBlock,
      "testProvenance claims a market quality for invented data",
    ).toMatch(/quality:\s*"FIXTURE"/);
  });
});
