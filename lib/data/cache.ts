// Process-wide TTL cache with single-flight and bounded stale-on-error. This decouples
// how often clients poll from how often we hit the upstream data providers: however many
// browser tabs refresh, each cache key is fetched from Yahoo/Finnhub at most once per TTL
// window. Single-flight collapses concurrent misses into one request (no stampede).
//
// Three bounds keep an unattended process honest:
//   - entries are capped, so an unbounded key space cannot grow memory until OOM;
//   - stale-on-error has a ceiling, so a provider that has been down for hours stops being
//     answered with yesterday's price as though it were current;
//   - upstream calls have a deadline, so a request that never settles cannot pin a key
//     forever and block every future caller of it.

interface Entry<T> {
  value: T;
  expires: number;
  storedAt: number;
}

export interface CacheOptions {
  /**
   * How long past expiry a value may still be served when the upstream call fails.
   * Beyond this the error propagates — a quote old enough to mislead is worse than none.
   */
  maxStaleMs?: number;
  /** Abort tracking of an upstream call that has not settled, freeing the key. */
  deadlineMs?: number;
}

/** Roughly a few MB of quotes/candles; well under any realistic provider key space. */
const MAX_ENTRIES = 500;
const DEFAULT_DEADLINE_MS = 60_000;
/** Default ceiling: ten refresh windows without a successful fetch. */
const DEFAULT_STALE_MULTIPLE = 10;

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

class CacheDeadlineError extends Error {
  constructor(key: string, ms: number) {
    super(`Upstream call for "${key}" exceeded ${ms}ms.`);
    this.name = "CacheDeadlineError";
  }
}

/** Moves a key to the most-recent position and evicts the oldest once over capacity. */
function touch(key: string, entry: Entry<unknown>): void {
  store.delete(key);
  store.set(key, entry);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  const maxStaleMs = options.maxStaleMs ?? ttlMs * DEFAULT_STALE_MULTIPLE;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;

  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) {
    touch(key, hit);
    return hit.value;
  }

  // Coalesce concurrent misses for the same key into a single upstream call.
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = (async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CacheDeadlineError(key, deadlineMs)), deadlineMs);
        timer.unref?.();
      });
      const value = await Promise.race([fn(), deadline]);
      const entry: Entry<T> = { value, expires: Date.now() + ttlMs, storedAt: Date.now() };
      touch(key, entry);
      return value;
    } catch (err) {
      // Serve stale on error (e.g. the provider rate-limited us) rather than blank — but
      // only while it is recent enough to still describe the market.
      if (hit && Date.now() - hit.storedAt <= maxStaleMs) return hit.value;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Test seam. Not used in application code. */
export function clearCacheForTests(): void {
  store.clear();
  inflight.clear();
}

/** Observability: current key count, for the data-quality surface. */
export function cacheSize(): number {
  return store.size;
}

// Bucket a unix-seconds timestamp to a TTL window so time-based args (e.g. candle
// from/to computed from Date.now() each render) produce a STABLE cache key within
// the window — otherwise the key changes every render and never hits.
export function timeBucket(unixSeconds: number, ttlMs: number): number {
  const w = Math.max(1, Math.floor(ttlMs / 1000));
  return Math.floor(unixSeconds / w);
}
