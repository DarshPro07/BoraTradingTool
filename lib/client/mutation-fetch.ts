/**
 * Every state-changing request from the browser goes through here.
 *
 * It exists for the CSRF header, which `requireMutationAccess` demands on same-origin mutations.
 * It now also sets `Content-Type` when there is a body, because omitting it was a silent trap:
 * `readJsonObject` rejects an unlabelled body with `Content-Type must be application/json`, and
 * the caller sees a refusal that describes the transport rather than anything they did.
 *
 * The owner sign-in on `/learning` failed this way — it posted a perfectly valid token and was
 * told the content type was wrong, which made the whole learning-mode control look broken. Two
 * call sites had the same omission, which is the signal that the default was in the wrong place.
 */
export function mutationFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-marketpulse-csrf", "1");

  // Only when there is a body, and never overriding an explicit choice — a caller sending
  // FormData or a blob has a different content type and must keep it.
  if (init.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Explicit rather than relied upon: the owner session is a cookie, and a control that dropped it
  // would fail owner-gated routes with a 401 that looks like a permissions bug rather than a
  // transport one.
  return fetch(input, { credentials: "same-origin", ...init, headers });
}
