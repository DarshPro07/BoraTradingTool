import { expect, test, type Page } from "@playwright/test";
import { discoverRoutes } from "./lib/routes";

/**
 * Route Coverage Matrix — every user-facing route, DERIVED FROM THE FILESYSTEM.
 *
 * ## Why this file no longer carries a hand-written route list
 *
 * It used to. The list drifted, and the drift was invisible because every failure mode was
 * silenced:
 *
 *   - `/factory` was listed with `optional: true`. There is no `app/factory`. The real page is
 *     `app/edge-factory`, which was NOT in the list at all — so the suite tested a route that
 *     does not exist and skipped one that does.
 *   - `/forward` was listed and NOT optional. There is no `app/forward` either. It passed anyway,
 *     because the only status assertion was `toBeLessThan(500)` and a 404 is less than 500.
 *   - Console errors were collected and then reported with `console.warn`, which cannot fail a
 *     test. "All routes pass" meant "all routes returned bytes", not "all routes are clean".
 *
 * A hand-maintained inventory cannot detect a route it does not know about. So the inventory is
 * now read from `app/**​/page.tsx` at run time: adding a page automatically adds a test, and
 * deleting a page automatically deletes one. A route can never again be silently untested.
 *
 * ## What a passing test now means
 *
 *   1. The route responded 200. Not "under 500" — a 404 is a missing page, and this suite exists
 *      to catch missing pages.
 *   2. The page rendered non-empty content.
 *   3. Zero uncaught exceptions, zero console errors, and zero failed network requests, except
 *      for the narrow allowlist below — where every entry carries the reason it is benign.
 */

/**
 * Console/network noise that is genuinely not a product defect. Each entry states WHY.
 * Anything not listed here fails the test — that is the point of the file.
 */
const ALLOWED_NOISE: Array<{ match: RegExp; because: string }> = [
  {
    match: /favicon/i,
    because: "the browser requests /favicon.ico on every navigation; a miss is not a page defect",
  },
  {
    match: /Download the React DevTools/i,
    because: "React's development-build advertisement, printed as info-level noise, not an error",
  },
];

function isAllowedNoise(text: string): boolean {
  return ALLOWED_NOISE.some((entry) => entry.match.test(text));
}

const ROUTES = discoverRoutes();

/** Collects everything that should fail a page: exceptions, console errors, dead requests. */
function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];

  page.on("pageerror", (error) => {
    problems.push(`uncaught exception: ${error.message}`);
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isAllowedNoise(text)) return;
    problems.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (isAllowedNoise(url)) return;
    const failure = request.failure()?.errorText ?? "";
    // Next.js App Router prefetches the RSC payload (`?_rsc=`) for every <Link> in the viewport.
    // Whichever prefetches are still in flight when the page unmounts are aborted by the browser
    // — that is the prefetcher working as designed, not a broken request. Deliberately narrow:
    // ONLY net::ERR_ABORTED, and ONLY on an RSC prefetch. Any other failure on those URLs, and
    // every failure on any other URL, still fails the test. (The predecessor of this rule filtered
    // `net::ERR` across the board, which also hid genuine connection failures.)
    if (url.includes("_rsc=") && failure === "net::ERR_ABORTED") return;
    problems.push(`request failed: ${request.method()} ${url} — ${failure}`);
  });

  page.on("response", (response) => {
    // A page that renders while one of its own API calls 500s is not a working page.
    if (response.status() < 500) return;
    if (isAllowedNoise(response.url())) return;
    problems.push(`server error: ${response.status()} ${response.url()}`);
  });

  return problems;
}

test.describe("route inventory", () => {
  test("every page on disk is covered by this suite", async () => {
    // Guards the derivation itself: if `app/` is unreadable or the walk breaks, ROUTES silently
    // empties and every route test disappears without a single failure. That would be exactly the
    // false green this file was rewritten to remove.
    expect(ROUTES.length, "no routes discovered — the filesystem walk is broken").toBeGreaterThan(20);

    const patterns = ROUTES.map((route) => route.pattern);
    expect(patterns, "the application root must serve a page").toContain("/");
    expect(new Set(patterns).size, "duplicate route patterns discovered").toBe(patterns.length);

    console.log(`[route-inventory] ${ROUTES.length} routes discovered from app/:`);
    for (const route of ROUTES) console.log(`[route-inventory]   ${route.pattern}`);
  });
});

test.describe("all routes — render cleanly", () => {
  for (const route of ROUTES) {
    test(`${route.pattern} renders without errors`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
      const problems = collectPageProblems(page);

      const response = await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

      // 200, not "< 500". A 404 means the page is missing, which is the defect this catches.
      expect(response?.status(), `${route.pattern} did not return 200`).toBe(200);

      const bodyText = await page.locator("body").textContent();
      expect(bodyText?.trim().length ?? 0, `${route.pattern} rendered a blank body`).toBeGreaterThan(0);

      // Give late/lazy errors a chance to surface before judging the page.
      await page.waitForTimeout(1_000);

      expect(
        problems,
        `${route.pattern} produced ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`,
      ).toEqual([]);
    });
  }
});

test.describe("critical routes — deep verification", () => {
  test("/brain shows AUTO mode and lanes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    const problems = collectPageProblems(page);

    await page.goto("/brain", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("brain-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("brain-system")).toBeVisible();
    await expect(page.getByTestId("brain-lanes")).toBeVisible();

    expect(problems, `/brain problems:\n  - ${problems.join("\n  - ")}`).toEqual([]);
  });
});
