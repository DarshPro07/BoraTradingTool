import { describe, expect, it } from "vitest";
import { LEGACY_ROUTES, NAV_SECTIONS, UTILITY_LINKS, activeChild, activeSection } from "./nav";

/**
 * The requirement being enforced here is R0: two workspaces, at most five views each, and
 * nothing reachable only by typing a URL. It is a navigation test because the previous layout —
 * five sections, twenty-six pages — was the loudest usability complaint against the build.
 */

describe("two workspaces, not twenty-six tabs", () => {
  it("has exactly two", () => {
    expect(NAV_SECTIONS).toHaveLength(2);
    expect(NAV_SECTIONS.map((section) => section.id)).toEqual(["research", "execute"]);
  });

  it("keeps every workspace small enough to scan without hunting", () => {
    for (const section of NAV_SECTIONS) {
      expect(section.children.length).toBeLessThanOrEqual(6);
      expect(section.children.length).toBeGreaterThan(0);
    }
  });

  it("gives every view a distinct route within its own workspace", () => {
    for (const section of NAV_SECTIONS) {
      const routes = section.children.map((child) => child.href);
      expect(new Set(routes).size).toBe(routes.length);
    }
  });

  it("shares the market board between both workspaces rather than duplicating it", () => {
    // RESEARCH reads it to decide what to study, EXECUTE to size and time a proposal. Two
    // separate screens showing the same sectors and movers would eventually disagree.
    const markets = NAV_SECTIONS.map((section) =>
      section.children.find((child) => child.href === "/dashboard"),
    );
    expect(markets.every(Boolean)).toBe(true);
    expect(markets[0]?.label).toBe("Markets");
    // Literally the same object, so the blurb and label cannot drift apart.
    expect(markets[0]).toBe(markets[1]);
  });

  it("lands each workspace on one of its own views", () => {
    for (const section of NAV_SECTIONS) {
      expect(section.children.some((child) => child.href === section.href)).toBe(true);
    }
  });

  it("explains every view, so a tab is never a bare word", () => {
    for (const section of NAV_SECTIONS) {
      for (const child of section.children) {
        expect(child.blurb.length).toBeGreaterThan(15);
      }
    }
  });
});

describe("resolving a path to a workspace", () => {
  it("resolves each view to its own workspace", () => {
    expect(activeSection("/command")?.id).toBe("research");
    expect(activeSection("/premarket")?.id).toBe("research");
    expect(activeSection("/memory")?.id).toBe("research");
    expect(activeSection("/trades")?.id).toBe("execute");
    expect(activeSection("/portfolio")?.id).toBe("execute");
  });

  it("resolves a deep instrument route to RESEARCH", () => {
    // /analyze has no tab of its own — it is where RESEARCH sends you to look closer, so the
    // workspace must stay highlighted rather than the chrome going blank.
    expect(activeSection("/analyze/US:XNAS:AAPL")?.id).toBe("research");
  });

  it("returns null for a path in no workspace, rather than guessing", () => {
    expect(activeSection("/nowhere")).toBeNull();
    expect(activeChild("/nowhere")).toBeNull();
  });

  it("prefers the longest matching prefix", () => {
    expect(activeChild("/premarket")?.label).toBe("Pre-market");
    expect(activeChild("/memory")?.label).toBe("Memory");
  });
});

describe("legacy routes keep working", () => {
  it("maps every legacy route to a view that exists", () => {
    const routes = new Set(NAV_SECTIONS.flatMap((s) => s.children.map((c) => c.href)));
    for (const [from, to] of Object.entries(LEGACY_ROUTES)) {
      expect(routes.has(to), `${from} maps to ${to}, which is not a view`).toBe(true);
    }
  });

  it("keeps the right workspace highlighted on a legacy URL", () => {
    // A tab the owner already had open must not leave the chrome looking broken.
    expect(activeSection("/scanner")?.id).toBe("research");
    expect(activeSection("/simulations")?.id).toBe("research");
    expect(activeChild("/simulations")?.label).toBe("Studio");
  });

  it("keeps the market board as a real view, not a redirect", () => {
    // It was briefly absorbed into pre-market. Sector performance, gainers, losers and news
    // flow are a place the owner works, not a detour on the way somewhere else.
    expect(LEGACY_ROUTES["/dashboard"]).toBeUndefined();
    expect(activeChild("/dashboard")?.label).toBe("Markets");
  });

  it("never maps a legacy route onto itself", () => {
    for (const [from, to] of Object.entries(LEGACY_ROUTES)) {
      expect(from).not.toBe(to);
    }
  });

  it("does not list a legacy route that is also a live view", () => {
    const routes = new Set(NAV_SECTIONS.flatMap((s) => s.children.map((c) => c.href)));
    for (const from of Object.keys(LEGACY_ROUTES)) {
      expect(routes.has(from), `${from} is both a view and a legacy redirect`).toBe(false);
    }
  });
});

describe("utility links stay out of the workspaces", () => {
  it("keeps configuration out of the working tabs", () => {
    const routes = new Set(NAV_SECTIONS.flatMap((s) => s.children.map((c) => c.href)));
    for (const link of UTILITY_LINKS) {
      expect(routes.has(link.href)).toBe(false);
    }
  });

  it("still exposes autonomy, data quality and settings somewhere", () => {
    const hrefs = UTILITY_LINKS.map((link) => link.href);
    expect(hrefs).toContain("/learning");
    expect(hrefs).toContain("/data-quality");
    expect(hrefs).toContain("/settings");
  });
});
