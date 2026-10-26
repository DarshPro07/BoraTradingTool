/**
 * Where the cloud clock's sealed state lives: assets of one GitHub release, tag `ledger-state`, on
 * the public repository (docs/plans/cloud-clock).
 *
 * Release assets, not workflow artifacts or caches. On a public repository anyone can download an
 * artifact, anyone who can open a pull request can read a cache, and a cache is evicted after 7 days
 * unused. Only sealed bundles are uploaded here, so the public sees ciphertext, a size and a time.
 *
 * A save uploads `ledger-<epoch>.bin` before deleting older ones, so a failed upload never leaves the
 * release empty, and the newest older bundle is kept as a fallback.
 *
 * Once a day a second, dated copy (`ledger-day-<IST day>.bin`, label `sha256:<hex>`) is uploaded and
 * never pruned: the rolling bundles can only ever show the latest state, the dated ones are history.
 */
import { createHash } from "node:crypto";

export const STATE_TAG = "ledger-state";
export const DEFAULT_REPO = "DarshPro07/BoraTradingTool";

export interface GitHub {
  repo: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface Asset {
  id: number;
  name: string;
  url: string;
  size: number;
  /** GitHub's upload state: "uploaded" once complete. */
  state?: string;
  /** Set at upload: `sha256:<hex>` on a day snapshot. */
  label?: string | null;
}

export interface Release {
  id: number;
  assets: Asset[];
}

export const epochOf = (name: string): number | null => {
  const match = /^ledger-(\d+)\.bin$/.exec(name);
  return match ? Number(match[1]) : null;
};

export const daySnapshotName = (day: string) => `ledger-day-${day}.bin`;

/** An upload that never finished (a client-side timeout) is never restored, kept or counted. */
export const finished = (asset: Asset) => asset.state === undefined || asset.state === "uploaded";

/**
 * One request, 30 s unless given longer. Reads and deletes are retried on a network error, a 429 or
 * a 5xx (three attempts); an upload is not, because a retried POST could leave a duplicate asset,
 * and a timeout is not, because on a slow link a retry starts again from zero.
 * A failed upload is retried by the next save under a new epoch.
 */
async function call(gh: GitHub, method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}, timeoutMs = 30_000): Promise<Response> {
  const attempts = method === "POST" ? 1 : 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await (gh.fetch ?? fetch)(url.startsWith("https://") ? url : `https://api.github.com${url}`, {
        method,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "marketpulse-clock",
          ...(gh.token ? { Authorization: `Bearer ${gh.token}` } : {}),
          ...headers,
        },
      });
      if (attempt < attempts && (response.status === 429 || response.status >= 500)) throw new Error(`GitHub ${response.status}`);
      return response;
    } catch (caught) {
      if (attempt >= attempts || (caught as { name?: unknown } | null)?.name === "TimeoutError") throw caught;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

async function json<T>(response: Response, doing: string): Promise<T> {
  if (!response.ok) throw new Error(`GitHub ${response.status} ${doing}`);
  return (await response.json()) as T;
}

/**
 * The dated day snapshots live in a release of their own: they accumulate, and the listing restore
 * reads must stay small and complete (review 2026-10-26).
 */
export const DAYS_TAG = "ledger-days";

export async function getStateRelease(gh: GitHub, tag = STATE_TAG): Promise<Release | null> {
  const response = await call(gh, "GET", `/repos/${gh.repo}/releases/tags/${tag}`);
  return response.status === 404 ? null : json<Release>(response, `reading the ${tag} release`);
}

export async function ensureStateRelease(gh: GitHub, tag = STATE_TAG): Promise<Release> {
  const found = await getStateRelease(gh, tag);
  if (found) return found;
  const body = JSON.stringify({
    tag_name: tag,
    name: tag === DAYS_TAG ? "Ledger day snapshots (sealed)" : "Ledger state (sealed)",
    body: "The cloud clock's paper-ledger state (docs/plans/cloud-clock). AES-256-GCM: unreadable without LEDGER_KEY. Not a software release.",
    prerelease: true,
  });
  return json<Release>(await call(gh, "POST", `/repos/${gh.repo}/releases`, body, { "Content-Type": "application/json" }), `creating the ${tag} release`);
}

export function latestStateAsset(release: Release | null): { asset: Asset; epoch: number } | null {
  let best: { asset: Asset; epoch: number } | null = null;
  for (const asset of release?.assets ?? []) {
    const epoch = epochOf(asset.name);
    // An upload that never finished would fail every restore after it.
    if (!finished(asset)) continue;
    if (epoch !== null && (!best || epoch > best.epoch)) best = { asset, epoch };
  }
  return best;
}

/** A seed is resumed only this soon after its cutover. */
const SEED_MAX_AGE_MS = 24 * 3_600_000;

/**
 * Where a run resumes from. The seed only when nothing newer is published: right after a cutover.
 * A day-old seed with no published ledger means the release was deleted or emptied, and resuming from
 * it would silently roll the ledger back to the cutover (review 2026-10-24), so that throws.
 */
export function restoreSource(seedEpoch: number | null, publishedEpoch: number | null, now: number): "seed" | "release" {
  if (seedEpoch !== null && (publishedEpoch === null || seedEpoch > publishedEpoch)) {
    if (publishedEpoch === null && now - seedEpoch > SEED_MAX_AGE_MS) {
      throw new Error(`the ${STATE_TAG} release holds no ledger, and the seed is from ${new Date(seedEpoch).toISOString()}: was the release deleted? Resuming would roll the ledger back; cut over again on purpose`);
    }
    return "seed";
  }
  if (publishedEpoch !== null) return "release";
  // Never an empty ledger: that would silently restart every record the owner's trust rests on.
  throw new Error("no ledger: run `node scripts/ledger.mjs cutover` on the laptop first");
}

/** Clock runs queued or running on GitHub: a promote must wait until there are none. */
export async function activeClockRuns(gh: GitHub): Promise<{ id: number; status: string }[]> {
  const runs = await json<{ workflow_runs: { id: number; status: string }[] }>(
    await call(gh, "GET", `/repos/${gh.repo}/actions/workflows/clock.yml/runs?per_page=20`),
    "listing the Clock runs",
  );
  return runs.workflow_runs.filter((run) => run.status !== "completed").map(({ id, status }) => ({ id, status }));
}

// The laptop has fetched release assets at 2.4 KB/s (2026-10-24): about 6 min for a 906 KB ledger.
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export async function downloadAsset(gh: GitHub, asset: Asset): Promise<Buffer> {
  const response = await call(gh, "GET", asset.url, undefined, { Accept: "application/octet-stream" }, DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`GitHub ${response.status} downloading ${asset.name}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadState(gh: GitHub, release: Release, epoch: number, sealed: Buffer): Promise<void> {
  const url = `https://uploads.github.com/repos/${gh.repo}/releases/${release.id}/assets?name=ledger-${epoch}.bin`;
  const uploaded = await json<Asset>(await call(gh, "POST", url, new Uint8Array(sealed), { "Content-Type": "application/octet-stream" }), "uploading the ledger");
  // Only rolling bundles are pruned; a day snapshot or anything else stays in the list and on GitHub.
  const rolling = (asset: Asset) => epochOf(asset.name) !== null;
  const older = release.assets
    .filter((asset) => rolling(asset) && epochOf(asset.name)! < epoch)
    .sort((a, b) => epochOf(b.name)! - epochOf(a.name)!);
  // The fallback kept beside the new bundle is the newest FINISHED older one.
  const keep = older.find(finished);
  const stales = older.filter((asset) => asset !== keep);
  // Tracked before any delete, so a failed delete can never lose the bundle just uploaded.
  release.assets = [uploaded, ...(keep ? [keep] : []), ...stales, ...release.assets.filter((asset) => !rolling(asset))];
  // Only after the new bundle is up. A delete that fails is retried at the next save, which still
  // sees the asset.
  for (const stale of stales) {
    try {
      const response = await call(gh, "DELETE", `/repos/${gh.repo}/releases/assets/${stale.id}`);
      if (response.ok || response.status === 404) release.assets = release.assets.filter((asset) => asset.id !== stale.id);
    } catch {
      /* kept in the list: the next save tries again */
    }
  }
}

/**
 * Queues the next Clock run. A workflow's own GITHUB_TOKEN may trigger workflow_dispatch (GitHub's
 * one exception to "a token's events start no runs"), so a session never waits on a late cron.
 */
export async function dispatchClock(gh: GitHub, chain: number, fromRun: string): Promise<void> {
  const body = JSON.stringify({ ref: "main", inputs: { chain: String(chain), from_run: fromRun } });
  // Unlike an upload, safe to retry: a duplicate dispatch only replaces the pending run.
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await call(gh, "POST", `/repos/${gh.repo}/actions/workflows/clock.yml/dispatches`, body, { "Content-Type": "application/json" });
      if (response.ok) return; // 204, or 200 when GitHub returns the run's details
      throw new Error(`GitHub ${response.status} queuing the next Clock run`);
    } catch (caught) {
      if (attempt >= 3) throw caught;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

/** One dated, hashed copy per IST day. False (no request) when that day's snapshot is already there. */
export async function uploadDaySnapshot(gh: GitHub, release: Release, day: string, sealed: Buffer): Promise<boolean> {
  const name = daySnapshotName(day);
  const existing = release.assets.find((asset) => asset.name === name);
  if (existing && finished(existing)) return false;
  // An aborted upload left an unfinished asset of this name, and GitHub refuses a second one: retake.
  if (existing) {
    const response = await call(gh, "DELETE", `/repos/${gh.repo}/releases/assets/${existing.id}`);
    if (!response.ok && response.status !== 404) throw new Error(`GitHub ${response.status} deleting the unfinished day snapshot`);
    release.assets = release.assets.filter((asset) => asset !== existing);
  }
  const label = encodeURIComponent(`sha256:${createHash("sha256").update(sealed).digest("hex")}`);
  const url = `https://uploads.github.com/repos/${gh.repo}/releases/${release.id}/assets?name=${name}&label=${label}`;
  release.assets.push(await json<Asset>(await call(gh, "POST", url, new Uint8Array(sealed), { "Content-Type": "application/octet-stream" }), "uploading the day snapshot"));
  return true;
}
