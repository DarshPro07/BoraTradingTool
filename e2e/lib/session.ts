import type { APIRequestContext } from "@playwright/test";

/**
 * Local-session bootstrap for request-fixture mutations.
 *
 * The server's mutation gate (lib/security/request.ts) requires, in order: a loopback destination,
 * an exact same-origin Origin header, sane Fetch Metadata, a SameSite=Strict local session cookie
 * the server itself issues via GET /api/session, and the x-marketpulse-mutation: 1 header the
 * app's mutationFetch client always sends.
 *
 * In a browser, the root layout's SessionInitializer fetches /api/session on every page load, so
 * page-context and in-page fetches already carry the cookie. Playwright's `request` fixture is NOT
 * a browser fetch — it has its own cookie jar and has never loaded a page — so it must ask for a
 * session explicitly before the first mutation. GET /api/session answers with Set-Cookie, which
 * the fixture's jar records, and every later mutation from the same fixture carries it.
 */
export async function ensureLocalSession(request: APIRequestContext): Promise<void> {
  const res = await request.get("/api/session");
  if (res.status() !== 200) {
    throw new Error(`Local session bootstrap failed with HTTP ${res.status()}`);
  }
}

/** The mutation header set the server's boundary requires of every mutating request. */
export function mutationHeaders(baseURL: string) {
  return {
    "content-type": "application/json",
    origin: baseURL,
    "x-marketpulse-mutation": "1",
  };
}
