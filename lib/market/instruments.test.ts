import { describe, expect, it } from "vitest";
import { parseInstrument } from "./instruments";
import { searchInstruments } from "./catalog";

describe("parseInstrument", () => {
  it("normalizes US, NSE, and BSE identities", () => {
    expect(parseInstrument("us:xnas:aapl")).toMatchObject({
      id: "US:XNAS:AAPL",
      providerSymbol: "AAPL",
      currency: "USD",
    });
    expect(parseInstrument("RELIANCE.NS")).toMatchObject({
      id: "IN:XNSE:RELIANCE",
      providerSymbol: "RELIANCE.NS",
      currency: "INR",
    });
    expect(parseInstrument("IN:XBOM:500325")).toMatchObject({
      providerSymbol: "500325.BO",
      timezone: "Asia/Kolkata",
    });
  });

  it("retains explicit unknown canonical instruments without guessing an exchange", () => {
    expect(parseInstrument("US:XNYS:XYZ")).toMatchObject({ id: "US:XNYS:XYZ", name: "XYZ" });
    expect(() => parseInstrument("XYZ")).toThrow(/canonical instrument ID/i);
  });

  it.each([
    "../../../package",
    "RELIANCE.NS\nX",
    "US:XNSE:AAPL",
    "IN:XNAS:RELIANCE",
    "AAPL.L",
    "",
  ])("rejects invalid input %j", (value) => {
    expect(() => parseInstrument(value)).toThrowError(expect.objectContaining({ code: "INVALID_INSTRUMENT" }));
  });
});

describe("searchInstruments", () => {
  it("searches names and filters exchanges", () => {
    expect(searchInstruments("Reliance").map((item) => item.exchange)).toEqual(["XNSE", "XBOM"]);
    expect(searchInstruments("bank", "XNSE").every((item) => item.exchange === "XNSE")).toBe(true);
  });

  it("returns a bounded balanced catalog", () => {
    expect(searchInstruments("")).toHaveLength(25);
    expect(searchInstruments("", "XBOM").length).toBeGreaterThanOrEqual(10);
  });
});
