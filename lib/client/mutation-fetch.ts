export function mutationFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-marketpulse-csrf", "1");
  return fetch(input, { ...init, headers });
}
