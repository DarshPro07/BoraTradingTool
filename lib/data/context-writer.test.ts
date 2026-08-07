import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStockContextPath } from "./context-writer";

describe("resolveStockContextPath", () => {
  it("uses a stable hashed filename inside the context directory", () => {
    const root = path.resolve("C:/safe/context");
    const result = resolveStockContextPath("IN:XNSE:RELIANCE", root);
    expect(path.dirname(result)).toBe(root);
    expect(path.basename(result)).toMatch(/^stock-[a-f0-9]{32}\.json$/);
    expect(resolveStockContextPath("RELIANCE.NS", root)).toBe(result);
  });

  it.each(["../../../package", "AAPL/../../outside", "AAPL\nX"])("rejects %j", (value) => {
    expect(() => resolveStockContextPath(value, "C:/safe/context")).toThrow();
  });
});
