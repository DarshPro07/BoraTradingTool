import type { DiscoveredSource, SourceDiscovery } from "./producer";

/**
 * The `awesome-systematic-trading` strategy catalogue, as a research source.
 *
 * ## What it actually contains
 *
 * A first pass over the rendered page reported "no standardised metadata — descriptive references
 * rather than a quantitative dataset". That was wrong, and the raw markdown says so plainly: every
 * strategy row carries a title, a **published Sharpe ratio**, a volatility, a rebalancing
 * frequency, a reference implementation and a source paper, grouped under asset-class headings.
 *
 * ```
 * | Title | Sharpe Ratio | Volatility | Rebalancing | Implementation | Source |
 * | Asset Growth Effect | `0.835` | `10.2%` | `Yearly` | [QuantConnect](...) | [Paper](...) |
 * ```
 *
 * Worth recording how that error happened: the summary came from a model reading the *rendered*
 * page, and the tables did not survive the summarisation. The parser below is written against
 * bytes fetched from `raw.githubusercontent.com` for the same reason the NSE data sources were
 * probed before use — a README is a claim about a thing, not the thing.
 *
 * ## Why the Sharpe ratios must never be treated as evidence
 *
 * Every figure here is **reported by the paper's authors**, over their chosen window, on their
 * chosen universe, under their chosen cost assumptions — which for a US-centric academic paper is
 * usually a few basis points, against the ~24 bps this owner actually pays, before the ₹500
 * position floor and the 25% concentration cap.
 *
 * A published Sharpe of 0.835 is therefore a *reason to look*, never a reason to skip the gauntlet.
 * It is carried in the ingested text as an explicit claim by a named source, so the epistemic
 * status attaches to it, and no downstream reader can mistake it for something this system
 * measured. `lib/strategy/cost-gate.ts` will still refuse anything priced for a market the owner
 * cannot reach.
 */

export const CATALOG_URL =
  "https://raw.githubusercontent.com/paperswithbacktest/awesome-systematic-trading/main/README.md";

export interface CatalogStrategy {
  title: string;
  /** Asset classes from the section heading the row appeared under. */
  assetClasses: string[];
  /** Author-reported. Null when the cell was absent or unparseable — never defaulted to zero. */
  sharpe: number | null;
  /** Author-reported annualised volatility, as a fraction. */
  volatility: number | null;
  rebalancing: string | null;
  paperUrl: string | null;
  implementationUrl: string | null;
}

/** Headings whose tables list strategies. Everything else in the file is tooling and books. */
const ASSET_CLASS_HEADINGS =
  /^##\s+(bonds|commodities|currencies|equities|cryptos|reits)[\w\s,]*$/i;

/** Sections that also use tables but list libraries, books or videos rather than strategies. */
const TOOLING_HEADINGS =
  /^##\s+(backtesting|trading bots|analytics|broker apis|data sources|data science|databases|graph computation|machine learning|timeseries analysis|visualization|beginner|biography|coding|crypto|general|high frequency trading|videos|blogs|courses)/i;

function cell(value: string): string {
  return value.replace(/`/g, "").trim();
}

/** `[label](url)` → url. Relative implementation links are resolved against the repository. */
function link(value: string): string | null {
  const match = value.match(/\]\(([^)]+)\)/);
  if (!match) return null;
  const url = match[1].trim();
  if (url.startsWith("./") || url.startsWith("/")) {
    return `https://github.com/paperswithbacktest/awesome-systematic-trading/blob/main/${url.replace(/^\.?\//, "")}`;
  }
  return url;
}

function numberOrNull(value: string): number | null {
  const cleaned = cell(value).replace(/[%,]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses the catalogue out of the raw README.
 *
 * Deliberately strict about which tables it reads: the file contains many tables, and most list
 * libraries. A parser that took every table would fill the research queue with backtesting
 * frameworks presented as strategies.
 */
export function parseStrategyCatalog(markdown: string): CatalogStrategy[] {
  const strategies: CatalogStrategy[] = [];
  let assetClasses: string[] | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (line.startsWith("## ")) {
      if (ASSET_CLASS_HEADINGS.test(line) && !TOOLING_HEADINGS.test(line)) {
        assetClasses = line
          .replace(/^##\s+/, "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
      } else {
        // Any other top-level heading ends the strategy region. Without this a strategy table's
        // asset class would leak into the tooling tables that follow it.
        assetClasses = null;
      }
      continue;
    }

    if (!assetClasses || !line.startsWith("|")) continue;

    const columns = line.split("|").slice(1, -1);
    if (columns.length < 6) continue;

    const title = cell(columns[0]);
    // Header and separator rows share the table's shape and must not become strategies.
    if (!title || /^-+$/.test(title) || /^title$/i.test(title)) continue;

    strategies.push({
      title,
      assetClasses,
      sharpe: numberOrNull(columns[1]),
      volatility: (() => {
        const value = numberOrNull(columns[2]);
        // Published as a percentage; stored as a fraction so it is comparable with everything else.
        return value === null ? null : value / 100;
      })(),
      rebalancing: cell(columns[3]) || null,
      implementationUrl: link(columns[4]),
      paperUrl: link(columns[5]),
    });
  }

  return strategies;
}

/**
 * Turns catalogue rows into research-queue sources.
 *
 * The ingested text states, in words, that the Sharpe is the authors' own figure. `ingestSource`
 * extracts claims from text rather than inventing them, so phrasing the provenance into the
 * content is what makes the resulting claim honest — there is no separate field that would carry
 * it, and a bare number would be indistinguishable from a measurement this system made.
 */
export function strategyCatalogSource(
  fetchMarkdown: () => Promise<string> = defaultFetch,
): SourceDiscovery {
  return async () => {
    const strategies = parseStrategyCatalog(await fetchMarkdown());

    return strategies
      .filter((strategy) => strategy.paperUrl !== null)
      .map<DiscoveredSource>((strategy) => ({
        // Stable across runs — the title is the row's identity in the catalogue, so re-running
        // never re-queues a strategy already ingested.
        externalId: `awesome-systematic-trading:${strategy.title}`,
        kind: "ingest_paper",
        title: strategy.title,
        content:
          `${strategy.title} — a published systematic strategy catalogued under ` +
          `${strategy.assetClasses.join(", ")}. ` +
          (strategy.sharpe === null
            ? "The catalogue reports no Sharpe ratio for it. "
            : `The authors report a Sharpe ratio of ${strategy.sharpe}` +
              (strategy.volatility === null
                ? ". "
                : ` at ${(strategy.volatility * 100).toFixed(1)}% annualised volatility. `)) +
          (strategy.rebalancing ? `Rebalancing is ${strategy.rebalancing.toLowerCase()}. ` : "") +
          "This figure is reported by the paper's authors over their own window, universe and cost " +
          "assumptions — it is not a measurement made by this system, and academic cost assumptions " +
          "are typically far below what this owner pays. Treat it as a reason to test the idea, " +
          "never as evidence that it works here.",
        // Non-null by the filter above; a strategy with no readable source is skipped rather than
        // queued as an unverifiable reference.
        url: strategy.paperUrl as string,
        authors: [],
        license: "Catalogue is MIT; each source paper carries its own terms.",
      }));
  };
}

async function defaultFetch(): Promise<string> {
  const response = await fetch(CATALOG_URL, {
    headers: { "User-Agent": "MarketPulse/1.0 (research intake)" },
  });
  if (!response.ok) throw new Error(`Strategy catalogue returned HTTP ${response.status}`);
  return response.text();
}
