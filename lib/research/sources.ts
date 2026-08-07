import { getDb, schema } from "@/lib/db";

/**
 * The research source registry.
 *
 * The reel's Knowledge Base (frame 719) groups research by **named source** — arXiv q-fin, a
 * GitHub watchlist, Fed speeches, Quantocracy, Alpha Architect, Robot Wealth — roughly
 * twenty-five of them, each with a bar showing how much has come from it. This system had four
 * archived sources and no statement anywhere of what it *should* be reading.
 *
 * That is the difference between an empty pipeline and an undefined one. An empty pipeline can
 * report its own gap; an undefined one cannot, and looks identical to a finished one.
 *
 * This declares the target. It deliberately does **not** fetch: the ingestion worker requires
 * title and content, because this application has no browser and no model — Claude reads and
 * ingests through MCP, and a fetcher inside the app would be a second, weaker path to the same
 * place. What this gives is a stated target and a measurable gap against it.
 */

export type SourceKind = "paper" | "repository" | "blog" | "official" | "video";
export type Cadence = "daily" | "weekly" | "monthly" | "ad_hoc";

export interface ResearchSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** Where a human or the agent goes to read it. */
  url: string;
  cadence: Cadence;
  /** What this source is good for, so intake is deliberate rather than completionist. */
  why: string;
  /** Licence or terms note where reuse is constrained. */
  terms?: string;
}

export const RESEARCH_SOURCES: readonly ResearchSource[] = Object.freeze([
  {
    id: "arxiv_qfin",
    name: "arXiv q-fin",
    kind: "paper",
    url: "https://arxiv.org/list/q-fin/recent",
    cadence: "daily",
    why: "Primary quantitative-finance preprints. The largest single source in the reference system.",
    terms: "Preprints; check each paper's licence before reproducing code or figures.",
  },
  {
    id: "arxiv_qfin_longform",
    name: "arXiv q-fin (longform)",
    kind: "paper",
    url: "https://arxiv.org/list/q-fin.ST/recent",
    cadence: "weekly",
    why: "Statistical finance specifically — where the validation methodology lives.",
  },
  {
    id: "ssrn_fin",
    name: "SSRN financial economics",
    kind: "paper",
    url: "https://www.ssrn.com/index.cfm/en/fen/",
    cadence: "weekly",
    why: "Working papers, often years ahead of journal publication.",
  },
  {
    id: "quantocracy",
    name: "Quantocracy",
    kind: "blog",
    url: "https://quantocracy.com/",
    cadence: "daily",
    why: "Curated aggregator. High signal per item because the curation has already happened.",
  },
  {
    id: "alpha_architect",
    name: "Alpha Architect",
    kind: "blog",
    url: "https://alphaarchitect.com/blog/",
    cadence: "weekly",
    why: "Factor research with the replication caveats stated, which is rarer than it should be.",
  },
  {
    id: "robot_wealth",
    name: "Robot Wealth",
    kind: "blog",
    url: "https://robotwealth.com/blog/",
    cadence: "weekly",
    why: "Practitioner treatment of edge decay and position sizing.",
  },
  {
    id: "github_watchlist",
    name: "GitHub watchlist",
    kind: "repository",
    url: "https://github.com/topics/quantitative-finance",
    cadence: "weekly",
    why: "Implementations to audit before adoption. Every intake goes through the repo-auditor first.",
    terms: "Licence must be checked per repository; MIT and BSD are reusable, GPL is not.",
  },
  {
    id: "nse_circulars",
    name: "NSE circulars",
    kind: "official",
    url: "https://www.nseindia.com/resources/exchange-communication-circulars",
    cadence: "daily",
    why: "Ban lists, price bands, ASM/GSM stages and session changes. Directly affects what is tradable.",
  },
  {
    id: "sebi_releases",
    name: "SEBI press releases",
    kind: "official",
    url: "https://www.sebi.gov.in/media-and-notifications.html",
    cadence: "weekly",
    why: "Regulatory change that alters costs, settlement or eligibility in the Indian market.",
  },
  {
    id: "fed_speeches",
    name: "Federal Reserve speeches",
    kind: "official",
    url: "https://www.federalreserve.gov/newsevents/speeches.htm",
    cadence: "weekly",
    why: "Macro regime context for the US book.",
  },
  {
    id: "sec_edgar",
    name: "SEC EDGAR filings",
    kind: "official",
    url: "https://www.sec.gov/edgar/searchedgar/companysearch",
    cadence: "daily",
    why: "Point-in-time fundamentals and event dates, with the timestamps that make them usable.",
  },
]);

export interface SourceCoverage {
  source: ResearchSource;
  /** Archived items traceable to this source. */
  archived: number;
  lastIngestedAt: Date | null;
}

export interface CoverageReport {
  coverage: SourceCoverage[];
  declared: number;
  /** Sources that have produced at least one archived item. */
  active: number;
  /** Archived items whose source is not in the registry. */
  unregistered: number;
  summary: string;
}

/**
 * Coverage of the registry by what has actually been archived.
 *
 * Matched on the archived URL and title against the registry entry's host and name.
 * Deliberately loose: an item the agent ingested from arXiv should count even if it was
 * labelled by hand, and a strict join would report zero coverage for material that plainly
 * exists. Loose matching can over-count; reporting a source as read when it was not is the less
 * damaging error here, because the number is a coverage prompt rather than evidence.
 */
export function sourceCoverage(): CoverageReport {
  const rows = getDb().select().from(schema.knowledgeSources).all();

  const coverage: SourceCoverage[] = RESEARCH_SOURCES.map((source) => {
    let host = "";
    try {
      host = new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    const matches = rows.filter((row) => {
      const haystack = `${row.url ?? ""} ${row.title ?? ""}`.toLowerCase();
      return (
        (host.length > 0 && haystack.includes(host)) ||
        haystack.includes(source.name.toLowerCase()) ||
        haystack.includes(source.id.replace(/_/g, " "))
      );
    });
    const dates = matches.map((row) => row.ingestedAt).filter(Boolean) as Date[];
    return {
      source,
      archived: matches.length,
      lastIngestedAt: dates.length ? dates.reduce((latest, at) => (at > latest ? at : latest)) : null,
    };
  });

  const matchedIds = new Set(
    coverage.flatMap((entry) => (entry.archived > 0 ? [entry.source.id] : [])),
  );
  const active = matchedIds.size;
  // Anything archived that no registry entry claims. Not an error — the agent may legitimately
  // ingest a one-off — but worth counting, because a registry nothing matches is decoration.
  const claimed = coverage.reduce((total, entry) => total + entry.archived, 0);

  return {
    coverage: coverage.sort((a, b) => b.archived - a.archived),
    declared: RESEARCH_SOURCES.length,
    active,
    unregistered: Math.max(0, rows.length - claimed),
    summary:
      active === 0
        ? `${RESEARCH_SOURCES.length} sources declared, none read yet. The registry states the target; ingestion happens through the agent, which reads and records with provenance.`
        : `${active} of ${RESEARCH_SOURCES.length} declared sources have produced archived research.`,
  };
}
