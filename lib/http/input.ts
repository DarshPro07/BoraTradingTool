const DEFAULT_MAX_BYTES = 64 * 1024;

export type JsonReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

function problem(status: number, code: string, message: string): JsonReadResult {
  return { ok: false, response: Response.json({ error: code, message }, { status }) };
}

export async function readJsonObject(
  request: Request,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<JsonReadResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return problem(415, "JSON_REQUIRED", "Content-Type must be application/json.");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return problem(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.");
    }
    if (parsedLength > maxBytes) {
      return problem(413, "BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
    }
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return problem(413, "BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return problem(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return problem(400, "JSON_OBJECT_REQUIRED", "Request body must be a JSON object.");
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && allowed.includes(value as T[number])
    ? (value as T[number])
    : null;
}

export function readFiniteNumber(
  value: unknown,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (options.integer && !Number.isSafeInteger(value)) return null;
  if (options.min !== undefined && value < options.min) return null;
  if (options.max !== undefined && value > options.max) return null;
  return value;
}

export function readBoundedString(
  value: unknown,
  options: { min?: number; max: number; pattern?: RegExp; trim?: boolean },
): string | null {
  if (typeof value !== "string") return null;
  const result = options.trim === false ? value : value.trim();
  if (result.length < (options.min ?? 0) || result.length > options.max) return null;
  if (/[\0\r\n]/.test(result)) return null;
  if (options.pattern && !options.pattern.test(result)) return null;
  return result;
}
