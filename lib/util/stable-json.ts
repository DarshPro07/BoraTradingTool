/**
 * Deterministic JSON serialisation for content hashing.
 *
 * Keys are sorted so object order cannot change a hash, and keys whose value is
 * `undefined` are omitted — matching `JSON.stringify` semantics and ensuring an
 * explicitly-undefined optional field hashes the same as an absent one. Without that,
 * two semantically identical strategies would produce different hashes and be treated
 * as separate specs.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
