import { describe, expect, it } from "vitest";
import { readBoundedString, readEnum, readFiniteNumber, readJsonObject } from "./input";

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/api/test", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("readJsonObject", () => {
  it("reads a JSON object", async () => {
    const result = await readJsonObject(jsonRequest('{"ticker":"AAPL"}'));
    expect(result.ok && result.value).toEqual({ ticker: "AAPL" });
  });

  it.each(["null", "[]", '"text"', "3"])("rejects non-object JSON %s", async (body) => {
    const result = await readJsonObject(jsonRequest(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("rejects malformed JSON and non-JSON content", async () => {
    const malformed = await readJsonObject(jsonRequest("{"));
    expect(malformed.ok).toBe(false);
    const text = await readJsonObject(
      new Request("http://127.0.0.1/api/test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.response.status).toBe(415);
  });

  it("rejects declared and actual oversized bodies", async () => {
    const declared = await readJsonObject(jsonRequest("{}", { "content-length": "999" }), 10);
    expect(declared.ok).toBe(false);
    if (!declared.ok) expect(declared.response.status).toBe(413);

    const actual = await readJsonObject(jsonRequest(JSON.stringify({ value: "x".repeat(20) })), 10);
    expect(actual.ok).toBe(false);
    if (!actual.ok) expect(actual.response.status).toBe(413);
  });
});

describe("strict input helpers", () => {
  it("accepts only listed enum values", () => {
    expect(readEnum("BUY", ["BUY", "SELL"] as const)).toBe("BUY");
    expect(readEnum("buy", ["BUY", "SELL"] as const)).toBeNull();
  });

  it("rejects non-finite and out-of-range numbers", () => {
    expect(readFiniteNumber(3, { min: 1, max: 5, integer: true })).toBe(3);
    expect(readFiniteNumber(Number.NaN)).toBeNull();
    expect(readFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readFiniteNumber(1.5, { integer: true })).toBeNull();
  });

  it("rejects control characters and invalid strings", () => {
    expect(readBoundedString(" AAPL ", { min: 1, max: 10, pattern: /^[A-Z]+$/ })).toBe("AAPL");
    expect(readBoundedString("AAPL\nX", { max: 20 })).toBeNull();
    expect(readBoundedString("", { min: 1, max: 20 })).toBeNull();
  });
});
