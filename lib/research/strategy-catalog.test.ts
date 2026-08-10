import { describe, expect, it } from "vitest";
import { parseStrategyCatalog, strategyCatalogSource } from "./strategy-catalog";

/**
 * Parsing the strategy catalogue, and refusing to launder its numbers.
 *
 * The fixture below is copied verbatim from the raw README, including the tooling table that
 * follows the strategy tables — because the failure mode that matters is not "fails to parse", it
 * is "parses too much" and fills the research queue with backtesting libraries presented as
 * strategies.
 */

const README = `
# awesome-systematic-trading

## Backtesting and Live Trading

| Name | Description | Stars | Language |
|------|-------------|-------|----------|
| [vnpy](https://github.com/vnpy/vnpy) | Python-based framework | ![stars](x) | ![py](y) |

## Bonds, commodities, currencies, equities

| Title       | Sharpe Ratio | Volatility | Rebalancing | Implementation | Source |
|-------------|--------------|------------|-------------|----------------|--------|
| Time Series Momentum Effect | \`0.576\` | \`20.5%\` | \`Monthly\` | [QuantConnect](./static/strategies/tsm.py) | [Paper](https://example.org/tsm.pdf) |
| Short Term Reversal with Futures | \`-0.05\` | \`12.3%\` | \`Weekly\` | [QuantConnect](./static/strategies/str.py) | [Paper](https://example.org/str.html) |

## Equities

|  Title       | Sharpe Ratio | Volatility | Rebalancing | Implementation | Source |
|--------------|--------------|------------|-------------|----------------|--------|
| Asset Growth Effect | \`0.835\` | \`10.2%\` | \`Yearly\` | [QuantConnect](./static/strategies/age.py) | [Paper](https://example.org/age.pdf) |
| Missing Sharpe Strategy | \`\` | \`\` | \`Daily\` | [QuantConnect](./static/strategies/ms.py) | [Paper](https://example.org/ms.pdf) |

## Data Sources

| Name | Description | Stars | Language |
|------|-------------|-------|----------|
| [yfinance](https://github.com/ranaroussi/yfinance) | Yahoo downloader | ![stars](x) | ![py](y) |
`;

describe("reading only the strategy tables", () => {
  it("finds the strategies", () => {
    const strategies = parseStrategyCatalog(README);
    expect(strategies.map((s) => s.title)).toEqual([
      "Time Series Momentum Effect",
      "Short Term Reversal with Futures",
      "Asset Growth Effect",
      "Missing Sharpe Strategy",
    ]);
  });

  it("does not mistake a library table for a strategy table", () => {
    // The failure that matters: both are six-ish column markdown tables under a `##` heading.
    // A parser that took every table would queue backtesting frameworks as trading strategies.
    const titles = parseStrategyCatalog(README).map((s) => s.title);
    expect(titles).not.toContain("[vnpy](https://github.com/vnpy/vnpy)");
    expect(titles.some((t) => t.includes("yfinance"))).toBe(false);
  });

  it("carries the asset classes from the heading the row sat under", () => {
    const strategies = parseStrategyCatalog(README);
    expect(strategies[0].assetClasses).toEqual(["Bonds", "commodities", "currencies", "equities"]);
    expect(strategies[2].assetClasses).toEqual(["Equities"]);
  });
});

describe("the published numbers", () => {
  it("reads the reported Sharpe, including a negative one", () => {
    const strategies = parseStrategyCatalog(README);
    expect(strategies[0].sharpe).toBe(0.576);
    expect(strategies[1].sharpe).toBe(-0.05);
  });

  it("stores volatility as a fraction rather than the printed percentage", () => {
    expect(parseStrategyCatalog(README)[0].volatility).toBeCloseTo(0.205, 5);
  });

  it("leaves an absent Sharpe null rather than zero", () => {
    // Zero is a measurement. A missing cell is not, and a zero here would rank a strategy nobody
    // reported on alongside one that was measured and found worthless.
    const missing = parseStrategyCatalog(README).find((s) => s.title === "Missing Sharpe Strategy");
    expect(missing?.sharpe).toBeNull();
    expect(missing?.volatility).toBeNull();
  });

  it("resolves the relative implementation link to something fetchable", () => {
    expect(parseStrategyCatalog(README)[0].implementationUrl).toMatch(/^https:\/\/github\.com\//);
  });
});

describe("what reaches the research queue", () => {
  it("states that the Sharpe is the authors' figure, not a measurement", () => {
    // The whole point. `ingestSource` extracts claims from text, so the provenance has to be in
    // the text — a bare number would be indistinguishable from something this system measured.
    const discovered = strategyCatalogSource(async () => README);
    return discovered().then((sources) => {
      const tsm = sources.find((s) => s.title === "Time Series Momentum Effect");
      expect(tsm?.content).toContain("0.576");
      expect(tsm?.content).toMatch(/reported by the paper's authors/i);
      expect(tsm?.content).toMatch(/never as evidence that it works here/i);
    });
  });

  it("gives each strategy a stable id so a rerun does not requeue it", async () => {
    const discovered = strategyCatalogSource(async () => README);
    const first = await discovered();
    const second = await discovered();
    expect(first.map((s) => s.externalId)).toEqual(second.map((s) => s.externalId));
    expect(first[0].externalId).toContain("awesome-systematic-trading:");
  });

  it("skips a row with no source paper rather than queueing an unreadable reference", async () => {
    const withoutPaper = README.replace("[Paper](https://example.org/age.pdf)", "-");
    const sources = await strategyCatalogSource(async () => withoutPaper)();
    expect(sources.some((s) => s.title === "Asset Growth Effect")).toBe(false);
  });

  it("refuses rather than throwing when the catalogue is unreachable", async () => {
    // The producer converts a throw into a reported refusal; this asserts the source propagates
    // the failure rather than returning an empty list that would read as "nothing published".
    await expect(
      strategyCatalogSource(async () => {
        throw new Error("HTTP 503");
      })(),
    ).rejects.toThrow(/503/);
  });
});
