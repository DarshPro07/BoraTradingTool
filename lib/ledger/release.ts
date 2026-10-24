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
 */
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
}

export interface Release {
  id: number;
  assets: Asset[];
}

export const epochOf = (name: string): number | null => {
  const match = /^ledger-(\d+)\.bin$/.exec(name);
  return match ? Number(match[1]) : null;
};

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

export async function getStateRelease(gh: GitHub): Promise<Release | null> {
  const response = await call(gh, "GET", `/repos/${gh.repo}/releases/tags/${STATE_TAG}`);
  return response.status === 404 ? null : json<Release>(response, `reading the ${STATE_TAG} release`);
}

export async function ensureStateRelease(gh: GitHub): Promise<Release> {
  const found = await getStateRelease(gh);
  if (found) return found;
  const body = JSON.stringify({
    tag_name: STATE_TAG,
    name: "Ledger state (sealed)",
    body: "The cloud clock's paper-ledger state (docs/plans/cloud-clock). AES-256-GCM: unreadable without LEDGER_KEY. Not a software release.",
    prerelease: true,
  });
  return json<Release>(await call(gh, "POST", `/repos/${gh.repo}/releases`, body, { "Content-Type": "application/json" }), `creating the ${STATE_TAG} release`);
}

export function latestStateAsset(release: Release | null): { asset: Asset; epoch: number } | null {
  let best: { asset: Asset; epoch: number } | null = null;
  for (const asset of release?.assets ?? []) {
    const epoch = epochOf(asset.name);
    if (epoch !== null && (!best || epoch > best.epoch)) best = { asset, epoch };
  }
  return best;
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
  const older = release.assets
    .filter((asset) => (epochOf(asset.name) ?? Infinity) < epoch)
    .sort((a, b) => epochOf(b.name)! - epochOf(a.name)!);
  // Tracked before any delete, so a failed delete can never lose the bundle just uploaded.
  release.assets = [uploaded, ...older];
  // Only after the new bundle is up: keep it and the newest older one. A delete that fails is
  // retried at the next save, which still sees the asset.
  for (const stale of older.slice(1)) {
    try {
      const response = await call(gh, "DELETE", `/repos/${gh.repo}/releases/assets/${stale.id}`);
      if (response.ok || response.status === 404) release.assets = release.assets.filter((asset) => asset.id !== stale.id);
    } catch {
      /* kept in the list: the next save tries again */
    }
  }
}
