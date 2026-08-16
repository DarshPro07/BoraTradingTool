/**
 * Which strategy specs count as production research, and which are residue.
 *
 * ## The measurement that forced this
 *
 * 2026-08-16: **14 of 22 strategy specs in the production database were Playwright artifacts** —
 * `e2e_ladder_fixture`, `e2e_orb_…`, `ledger_gap_screen_…_desktop_chromium`,
 * `probe_authored_null_…` — written by actors `e2e`, `e2e-fixture` and `http-20124`. They inflated
 * the funnel's denominator and spent the rehearsal rotation's ten-slot budget on fixtures.
 *
 * The write path is now closed (`e2e/lib/server-provenance.ts` refuses an unproven external
 * target), but a guard against future writes does not repair the records already there.
 *
 * ## Classify, do not delete
 *
 * Deleting them would destroy audit history to make a number look better, which is the wrong
 * trade in a system whose whole claim is that its evidence is honest. They stay, they are
 * labelled, and the production scoreboard stops counting them.
 *
 * Classification is DERIVED rather than stored, deliberately: a new fixture written tomorrow is
 * classified correctly without anyone remembering to set a flag, and the rule is one testable
 * function instead of a column that drifts.
 *
 * ## The second kind of residue
 *
 * `sma_cross_20_50` is a US-market strategy whose `would_pass` verdict is dated 2026-08-09 and
 * cannot be reproduced: the canonical store holds **no US daily bars at all** (1,974 `IN:` tickers
 * and nothing else). The cycle preserves the verdict on purpose — `if (outcome.dataMissing)
 * continue` exists so a provider rate-limiting for ten seconds cannot destroy a real result — but
 * that test is by reason TYPE, never duration, so a permanent absence reads as a transient outage
 * forever.
 *
 * MarketPulse's product boundary is India/NSE. A US strategy is not waiting for data; it is
 * outside the system's scope. That is `UNSUPPORTED_MARKET`, resolution owner PERMANENT, and its
 * stale verdict must not contribute to an Indian campaign's readiness.
 */

export type SpecOrigin =
  /** Authored for the research programme. The only origin the scoreboard counts. */
  | "PRODUCTION_RESEARCH"
  /** Written by a browser test. Kept for audit, excluded from research. */
  | "E2E_FIXTURE"
  /** A market this deployment does not serve. Not blocked — out of scope. */
  | "UNSUPPORTED_MARKET";

export interface EligibilityVerdict {
  origin: SpecOrigin;
  /** May this spec's verdict contribute to campaign readiness? */
  researchEligible: boolean;
  /** Who could change this, in the vocabulary the activation gate already uses. */
  resolutionOwner: "AUTO" | "OWNER" | "PERMANENT" | null;
  reason: string;
}

/**
 * Markets this deployment actually holds canonical data for.
 *
 * NSE and BSE. The US entry in the DSL's market enum is a language capability, not a product
 * boundary — and a strategy written against a market with no ingestion path is permanently
 * un-evaluable rather than temporarily starved.
 */
export const SUPPORTED_MARKETS: ReadonlySet<string> = new Set(["NSE", "BSE", "IN"]);

/** Actors whose writes are test residue by construction. */
const FIXTURE_ACTORS: ReadonlySet<string> = new Set(["e2e", "e2e-fixture"]);

/**
 * `http-<port>` is the app's own HTTP client acting for a browser session. Every spec carrying it
 * in this store was written by a Playwright run, and no production authoring path uses it — the
 * real ones say `owner`, `claude_code`, `scheduler`, or a named agent.
 */
const FIXTURE_ACTOR_PREFIXES: readonly string[] = ["http-"];

/** Names only a test generates: the Playwright project name, or the `e2e_` prefix. */
const FIXTURE_NAME_PATTERN = /(^e2e_)|desktop_chromium|_mspo[a-z0-9]{4,}/i;

export interface ClassifiableSpec {
  name: string;
  createdBy: string;
  /** The DSL's declared market, when it could be parsed. Null when it could not. */
  market: string | null;
}

export function classifySpec(spec: ClassifiableSpec): EligibilityVerdict {
  const actor = spec.createdBy.trim();

  if (FIXTURE_ACTORS.has(actor) || FIXTURE_ACTOR_PREFIXES.some((prefix) => actor.startsWith(prefix))) {
    return {
      origin: "E2E_FIXTURE",
      researchEligible: false,
      resolutionOwner: null,
      reason: `written by test actor "${actor}"; kept for audit, excluded from research`,
    };
  }
  if (FIXTURE_NAME_PATTERN.test(spec.name)) {
    return {
      origin: "E2E_FIXTURE",
      researchEligible: false,
      resolutionOwner: null,
      reason: `name "${spec.name}" carries a browser-test marker; kept for audit, excluded from research`,
    };
  }
  if (spec.market !== null && !SUPPORTED_MARKETS.has(spec.market)) {
    return {
      origin: "UNSUPPORTED_MARKET",
      researchEligible: false,
      resolutionOwner: "PERMANENT",
      reason:
        `declares market ${spec.market}, which this deployment holds no canonical data for. ` +
        "Not awaiting data — out of scope, so no verdict of its can support an NSE campaign.",
    };
  }
  return {
    origin: "PRODUCTION_RESEARCH",
    researchEligible: true,
    resolutionOwner: null,
    reason: "authored for the research programme",
  };
}

/** The declared market of a spec's DSL, or null when the JSON cannot be read. */
export function marketOfDsl(dslJson: string): string | null {
  try {
    const parsed = JSON.parse(dslJson) as { universe?: { market?: unknown } };
    const market = parsed.universe?.market;
    return typeof market === "string" ? market : null;
  } catch {
    return null;
  }
}
