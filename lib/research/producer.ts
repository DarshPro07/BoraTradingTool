import { enqueue, type JobKind } from "./queue";
import { strategyCatalogSource } from "./strategy-catalog";
import type { IngestPayload } from "./ingest";

/**
 * The research queue's mouth.
 *
 * ## What was missing
 *
 * `runWorker` drains the queue correctly and `runLearningCycle` calls it every fifteen minutes.
 * But `enqueue` was reachable from exactly three places — the MCP server, one API route, and a
 * test — all of which require a human or an agent to act. The loop turned on schedule and had
 * nothing to turn on.
 *
 * This is the arrow that closes it: a scheduled pass that finds published work and puts it in
 * the queue, so the deterministic half of the system keeps learning while nobody is watching.
 *
 * ## Why the producer fetches, rather than queuing a URL
 *
 * `runJob` requires `title` and `content` on the payload and throws without them, and
 * `ingestSource` never invents claims from a bare link. So a job carrying only a URL fails three
 * times, exhausts its retries, and lands in failure memory as a permanent dead end — leaving the
 * queue busy and the system no better informed. Content is resolved here, before enqueueing, and
 * a source that cannot produce content is rejected rather than queued.
 */

export interface DiscoveredSource {
  /** Stable id from the upstream feed. Becomes the dedupe key, so it must not be a timestamp. */
  externalId: string;
  kind: JobKind;
  title: string;
  content: string;
  url: string;
  authors?: string[];
  license?: string;
}

export type SourceDiscovery = () => Promise<readonly DiscoveredSource[]>;

export interface ProduceResult {
  enqueued: number;
  /** Already seen on an earlier pass. Not an error — the dedupe key doing its job. */
  deduped: number;
  /** Discovered but unusable, e.g. no extractable content. */
  rejected: number;
  /** True only when discovery itself failed. Distinct from "the feed was empty". */
  failed: boolean;
  reason: string;
}

/** Per pass. Enough to keep the queue fed, small enough that one pass cannot flood it. */
export const DEFAULT_MAX_PER_PASS = 5;

/**
 * Every source, tried independently.
 *
 * Isolated per source on purpose: arXiv rate-limiting must not cost the catalogue its pass, and a
 * moved README must not stop new papers arriving. A combined source that threw on the first
 * failure would make the intake only as reliable as its least reliable feed.
 *
 * Ordered catalogue-first. The catalogue is a finite, curated set of published strategies with
 * reported results; arXiv is an unbounded firehose where most entries are not tradable ideas at
 * all. Under a per-pass cap, taking the curated set first spends the budget better.
 */
export function allSources(
  sources: readonly SourceDiscovery[] = [strategyCatalogSource(), arxivQuantFinance()],
): SourceDiscovery {
  return async () => {
    const found: DiscoveredSource[] = [];
    const failures: string[] = [];

    for (const source of sources) {
      try {
        found.push(...(await source()));
      } catch (caught) {
        failures.push(caught instanceof Error ? caught.message.split("\n")[0] : String(caught));
      }
    }

    // Only a total failure is a failure. Partial discovery is still discovery, and reporting it as
    // an outage would hide the sources that did work.
    if (found.length === 0 && failures.length > 0) {
      throw new Error(`every research source failed: ${failures.join("; ")}`);
    }
    return found;
  };
}

export interface ProduceOptions {
  discover?: SourceDiscovery;
  max?: number;
}

export async function produceResearchJobs(options: ProduceOptions = {}): Promise<ProduceResult> {
  const max = options.max ?? DEFAULT_MAX_PER_PASS;
  const discover = options.discover ?? allSources();

  let found: readonly DiscoveredSource[];
  try {
    found = await discover();
  } catch (caught) {
    // Refused, not thrown. One unreachable feed must not take down the cycle that calls this —
    // and `failed: true` keeps it distinguishable from a feed that simply had nothing new.
    const message = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
    return {
      enqueued: 0,
      deduped: 0,
      rejected: 0,
      failed: true,
      reason: `Research discovery could not reach its source: ${message}`,
    };
  }

  if (found.length === 0) {
    return {
      enqueued: 0,
      deduped: 0,
      rejected: 0,
      failed: false,
      reason: "The research feed was reachable and returned nothing new.",
    };
  }

  let enqueued = 0;
  let deduped = 0;
  let rejected = 0;
  let considered = 0;

  for (const item of found) {
    if (enqueued >= max) break;
    considered += 1;

    if (!item.title.trim() || !item.content.trim()) {
      // Rejected here rather than queued: `runJob` would throw on this payload, retry twice more,
      // and write a dead end into failure memory for a source that was never ingestible.
      rejected += 1;
      continue;
    }

    const payload: IngestPayload = {
      kind: sourceKindFor(item.kind),
      title: item.title.trim(),
      content: item.content.trim(),
      url: item.url,
      locator: item.externalId,
      license: item.license,
      authors: item.authors,
    };

    const result = enqueue({
      kind: item.kind,
      payload: payload as unknown as Record<string, unknown>,
      // The upstream id, so the same paper is never ingested twice however often it appears in
      // the feed. A timestamp here would defeat the whole mechanism.
      dedupeKey: `research:${item.externalId}`,
    });

    if (result.deduped) deduped += 1;
    else enqueued += 1;
  }

  const remaining = found.length - considered;
  const reason =
    `Discovered ${found.length} source(s): enqueued ${enqueued}, already seen ${deduped}` +
    (rejected ? `, rejected ${rejected} with no extractable content` : "") +
    (remaining > 0
      ? `. ${remaining} remain unexamined — the per-pass cap is ${max}, and they will be reconsidered next pass.`
      : ".");

  return { enqueued, deduped, rejected, failed: false, reason };
}

/** Maps a queue job kind onto the source kind `ingestSource` records. */
function sourceKindFor(kind: JobKind): IngestPayload["kind"] {
  switch (kind) {
    case "ingest_video":
      return "video" as IngestPayload["kind"];
    case "ingest_repository":
      return "repository" as IngestPayload["kind"];
    case "ingest_web":
      return "web" as IngestPayload["kind"];
    default:
      return "paper" as IngestPayload["kind"];
  }
}

/**
 * arXiv q-fin, the one high-signal source of published strategy research that is genuinely free
 * and has a documented API.
 *
 * Deliberately narrow. A broad web crawl would fill the queue with blog posts, and the whole
 * value of this loop is that what it ingests is worth the claims extracted from it. The abstract
 * is used as content: it is what arXiv serves without a PDF fetch, and `ingestSource` extracts
 * claims from text rather than inventing them, so a shorter honest input is better than a longer
 * scraped one.
 */
export function arxivQuantFinance(categories = ["q-fin.TR", "q-fin.PM", "q-fin.ST"], limit = 20): SourceDiscovery {
  return async () => {
    const query = categories.map((category) => `cat:${category}`).join("+OR+");
    const url =
      `http://export.arxiv.org/api/query?search_query=${query}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;

    const response = await fetch(url, { headers: { "User-Agent": "MarketPulse/1.0 (research intake)" } });
    if (!response.ok) throw new Error(`arXiv returned HTTP ${response.status}`);

    return parseArxivAtom(await response.text());
  };
}

/**
 * A deliberately small Atom reader rather than an XML dependency.
 *
 * arXiv's feed is machine-generated and regular, and the fields taken are the four that matter.
 * A malformed entry yields no source rather than a partial one — a paper with no id cannot be
 * deduped, and a source that cannot be deduped will be re-ingested on every pass forever.
 */
export function parseArxivAtom(xml: string): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];

  for (const entry of xml.split("<entry>").slice(1)) {
    const id = pick(entry, "id");
    const title = pick(entry, "title");
    const summary = pick(entry, "summary");
    if (!id || !title || !summary) continue;

    const version = id.split("/abs/")[1];
    if (!version) continue;

    sources.push({
      externalId: `arXiv:${version}`,
      kind: "ingest_paper",
      title: collapse(title),
      content: collapse(summary),
      url: id.trim(),
      authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((match) => collapse(match[1])),
      license: "arXiv (per-paper licence; check before redistribution)",
    });
  }

  return sources;
}

function pick(entry: string, tag: string): string | null {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
