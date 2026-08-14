/**
 * Every state-changing request from the browser goes through here.
 *
 * Defense-in-depth local security:
 *   - x-marketpulse-mutation header (proves it's our fetch client)
 *   - SameSite=Strict session cookie (proves same browser, same site)
 *   - credentials: same-origin (cookie sent only to same origin)
 *
 * The server verifies: loopback + origin + Fetch Metadata + session + mutation header.
 * Zero human friction — the server auto-issues the session on startup.
 */
import { MUTATION_HEADER, MUTATION_HEADER_VALUE } from "@/lib/security/request";

export function mutationFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(MUTATION_HEADER, MUTATION_HEADER_VALUE);

  // Only when there is a body, and never overriding an explicit choice.
  if (init.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(input, { credentials: "same-origin", ...init, headers });
}
