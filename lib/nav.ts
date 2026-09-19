/**
 * Two workspaces. Not five sections of twenty-six pages.
 *
 * The product answers exactly two questions, and every screen belongs to one of them:
 *
 *   RESEARCH — "what is the system finding out while I am not here?"
 *   EXECUTE  — "what should I place right now, and what would it cost me if I am wrong?"
 *
 * Scalping is a mode of both, never a third workspace: in RESEARCH it is a strategy family
 * under test, in EXECUTE it is a proposal with a tighter time budget.
 *
 * Utility screens (settings, data quality, autonomy mode) are deliberately absent from the
 * workspace tabs. They are reached from the persistent chrome, because they are things you
 * configure once, not places you work.
 */

export interface NavChild {
  href: string;
  label: string;
  blurb: string;
}

export interface NavSection {
  id: string;
  href: string;
  label: string;
  question: string;
  children: NavChild[];
}

/**
 * The market board — indices, sector performance, gainers and losers, news flow.
 *
 * Deliberately the same view in both workspaces rather than two copies. RESEARCH reads it to
 * decide what to study; EXECUTE reads it to size and time a proposal. Splitting it would mean
 * two screens that must be kept in agreement about the same numbers, and they would drift.
 */
const MARKETS: NavChild = {
  href: "/dashboard",
  label: "Markets",
  blurb: "Indices, sector performance, gainers and losers, news flow",
};

export const NAV_SECTIONS: readonly NavSection[] = Object.freeze([
  {
    id: "research",
    href: "/command",
    label: "RESEARCH",
    question: "What is it finding out while I am away?",
    children: [
      { href: "/command", label: "Command", blurb: "What the system did, and what needs you" },
      MARKETS,
      { href: "/premarket", label: "Pre-market", blurb: "India and USA session phases, overnight gaps" },
      { href: "/strategies", label: "Studio", blurb: "Author, compile, rehearse and simulate a strategy" },
      { href: "/memory", label: "Memory", blurb: "Provenance graph, lessons, graveyard" },
      { href: "/paper", label: "Paper", blurb: "Equity, positions, loss ledger, risk posture" },
    ],
  },
  {
    id: "execute",
    href: "/trades",
    label: "EXECUTE",
    question: "What should I place, and what does it cost me if I am wrong?",
    children: [
      { href: "/trades", label: "Proposals", blurb: "Fully specified tickets awaiting your confirmation" },
      MARKETS,
      { href: "/fund", label: "Fund", blurb: "Autonomous paper fund: mandates, decisions, trust gates" },
      { href: "/portfolio", label: "Risk", blurb: "Exposure, ceilings, gate decisions" },
      { href: "/audit", label: "Audit", blurb: "Every governed decision, allowed and denied" },
    ],
  },
]);

/**
 * Screens that exist but are not workspaces. Reached from the chrome.
 *
 * `/learning` is here rather than in RESEARCH on purpose: the autonomy strip at the top of every
 * page links to it, so the mode is always one click away from wherever the owner is, instead of
 * being a tab they have to remember to visit.
 */
export const UTILITY_LINKS: readonly NavChild[] = Object.freeze([
  // Chrome rather than a workspace tab for the same reason /learning is: the brain is the
  // one-glance answer to "what is it doing and what is missing", wanted from every page —
  // and RESEARCH is already at its six-view scan limit.
  { href: "/brain", label: "Brain", blurb: "What the system knows, does, and still lacks" },
  { href: "/learning", label: "Autonomy", blurb: "RUN lanes and cycle evidence" },
  { href: "/data-quality", label: "Data", blurb: "Freshness and provenance per resource" },
  { href: "/settings", label: "Settings", blurb: "Providers, keys, and paper policy" },
]);

/**
 * Routes that predate the two-workspace layout.
 *
 * They keep working — a tab the owner already has open must not 404 — and each resolves to the
 * workspace view that absorbed it. Consulted by `activeSection` so the correct workspace stays
 * highlighted when someone arrives on a legacy URL.
 */
export const LEGACY_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  "/scanner": "/premarket",
  "/news": "/premarket",
  "/watchlist": "/premarket",
  "/experiments": "/strategies",
  "/simulations": "/strategies",
  "/edge-factory": "/strategies",
  "/library": "/memory",
  "/research": "/memory",
  "/analyst": "/memory",
  "/ai": "/memory",
  "/system": "/command",
  "/jobs": "/command",
});

const ALL_CHILDREN = NAV_SECTIONS.flatMap((section) =>
  section.children.map((child) => ({ section, child })),
);

/** Longest-prefix match, so deep routes such as /analyze/US:XNAS:AAPL resolve to a workspace. */
export function activeSection(pathname: string): NavSection | null {
  let best: NavSection | null = null;
  let bestLength = -1;

  for (const { section, child } of ALL_CHILDREN) {
    if ((pathname === child.href || pathname.startsWith(`${child.href}/`)) && child.href.length > bestLength) {
      best = section;
      bestLength = child.href.length;
    }
  }
  if (best) return best;

  // A legacy URL still belongs to whichever workspace absorbed it.
  const absorbed = LEGACY_ROUTES[pathname];
  if (absorbed) {
    return NAV_SECTIONS.find((section) => section.children.some((child) => child.href === absorbed)) ?? null;
  }

  // Instrument research has no tab of its own; it is where RESEARCH sends you to look closer.
  if (pathname.startsWith("/analyze")) {
    return NAV_SECTIONS.find((section) => section.id === "research") ?? null;
  }
  return null;
}

export function activeChild(pathname: string): NavChild | null {
  let best: NavChild | null = null;
  let bestLength = -1;
  for (const { child } of ALL_CHILDREN) {
    if ((pathname === child.href || pathname.startsWith(`${child.href}/`)) && child.href.length > bestLength) {
      best = child;
      bestLength = child.href.length;
    }
  }
  if (best) return best;

  const absorbed = LEGACY_ROUTES[pathname];
  return absorbed ? (ALL_CHILDREN.find(({ child }) => child.href === absorbed)?.child ?? null) : null;
}
