import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_ROUTES, NAV_SECTIONS, UTILITY_LINKS } from "./nav";

/**
 * Every screen is reachable from the navigation.
 *
 * `nav.test.ts` checks that the nav is well-formed — two workspaces, distinct routes, no bare
 * words. It cannot catch the failure that actually happened: a page existing in `app/` that no
 * link points at. Twenty-six routes shipped and the owner's report was that the UI "is not in
 * proper flow", which is what a directory of unreachable screens feels like from the outside.
 *
 * A well-formed nav that omits a page passes every test in that file. This one walks the
 * filesystem instead of the nav, so a page added tomorrow without a link fails here rather than
 * being discovered by someone typing a URL they happened to remember.
 */

const APP_DIR = path.join(process.cwd(), "app");

/**
 * Routes that are deliberately not in the nav, each with the reason.
 *
 * An allowlist rather than a pattern: "it looked like an exception" is how the orphans appeared
 * in the first place. Adding to this list should feel like a decision.
 */
const INTENTIONALLY_UNLINKED: Record<string, string> = {
  "/": "Redirects to /dashboard. Linking a redirect would put two entries on one destination.",
  "/analyze/[ticker]": "Reached by searching an instrument, and covered by the /analyze prefix.",
};

function routesOnDisk(directory = APP_DIR, prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "page.tsx") routes.push(prefix === "" ? "/" : prefix);
    if (!entry.isDirectory()) continue;
    // Route groups and private folders are not URL segments.
    if (entry.name.startsWith("_") || entry.name.startsWith("(")) continue;
    if (entry.name === "api") continue;
    routes.push(...routesOnDisk(path.join(directory, entry.name), `${prefix}/${entry.name}`));
  }
  return routes;
}

const linked = new Set<string>([
  ...NAV_SECTIONS.flatMap((section) => [section.href, ...section.children.map((child) => child.href)]),
  ...UTILITY_LINKS.map((link) => link.href),
]);

/**
 * Legacy routes are reachable without being linked, and that is the design: a tab the owner
 * already has open must not 404, but its content now lives in the workspace view that absorbed
 * it, so linking both would put two entries on one destination.
 *
 * They count as reachable here. What they must not be is a dead end — see the assertion below.
 */
const reachable = new Set<string>([...linked, ...Object.keys(LEGACY_ROUTES)]);

describe("no screen is orphaned", () => {
  const routes = routesOnDisk();

  it("finds the pages it is meant to be checking", () => {
    // Guards the guard. A walker that silently returns nothing would make every assertion below
    // vacuously true, which is worse than no test at all.
    expect(routes.length).toBeGreaterThan(20);
  });

  it("links every page, or records why it does not", () => {
    const orphans = routes.filter(
      (route) => !reachable.has(route) && !(route in INTENTIONALLY_UNLINKED),
    );
    expect(orphans, `unreachable from the nav: ${orphans.join(", ")}`).toEqual([]);
  });

  it("never leaves a legacy route pointing somewhere unlinked", () => {
    // The failure mode a legacy map invites: a route is absorbed into a view, the view is later
    // renamed or dropped, and the old URL now resolves to a workspace with nothing to show. The
    // owner arrives on a page that renders and highlights a tab that is not there.
    const dangling = Object.entries(LEGACY_ROUTES).filter(([, target]) => !linked.has(target));
    expect(
      dangling.map(([from, to]) => `${from} → ${to}`),
      "legacy routes whose destination is not in the nav",
    ).toEqual([]);
  });

  it("keeps a page on disk for every legacy route, so an old tab does not 404", () => {
    const missing = Object.keys(LEGACY_ROUTES).filter((route) => !routes.includes(route));
    expect(missing, `legacy routes with no page to serve them: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the exemption list honest — every exemption still exists on disk", () => {
    // An exemption for a deleted page is a comment pretending to be a rule, and it would silently
    // cover a future page that happened to take the same route.
    const stale = Object.keys(INTENTIONALLY_UNLINKED).filter((route) => !routes.includes(route));
    expect(stale, `exempted but no longer on disk: ${stale.join(", ")}`).toEqual([]);
  });

  it("points every nav link at a page that exists", () => {
    // The opposite failure: a link to a route that was renamed or removed, which is a 404 the
    // owner finds by clicking.
    const dangling = [...linked].filter(
      (href) => !routes.includes(href) && !routes.some((route) => route.startsWith(`${href}/`)),
    );
    expect(dangling, `nav links with no page: ${dangling.join(", ")}`).toEqual([]);
  });
});
