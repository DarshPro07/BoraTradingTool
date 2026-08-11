import { it } from "vitest";
import { clauseSlicesOf, compileResearchProse } from "./semantic-compiler";
import { SpaCyDependencyResolver, type SyntaxParse } from "./syntax/resolver";

const resolver = SpaCyDependencyResolver.fromEnv();

async function compile(prose: string) {
  const parses: Record<string, SyntaxParse> = {};
  for (const slice of clauseSlicesOf(prose)) {
    if (!parses[slice]) parses[slice] = await resolver.parse(slice);
  }
  return compileResearchProse(prose, parses);
}

const CASES = [
  // Historic misattachment: the RSI band must not land on a price SMA.
  "Enter when RSI-14 is between 50 and 70 and the close is above the 20-day and 50-day SMAs.",
  // Two PRICE subjects in one sentence; a trailing bound must not silently inherit the wrong one.
  "Enter when the close is above SMA20 and the 50-day SMA is above 2400, and below 2600.",
  // Order swap: same tree content, different word order. Positional rules change their answer.
  "Enter when RSI-14 is above 55 and the close is above SMA20.",
  "Enter when the close is above SMA20 and RSI-14 is above 55.",
  // Genuinely ambiguous trailing bound with no coordination anchor.
  "Enter when the close is above SMA20. Below 30.",
  // Two numbers in one clause, one belonging to a different quantity.
  "Screen for gap above 3 percent across 2 names.",
];

it(
  "probe",
  async () => {
    const lines: string[] = [];
    for (const prose of CASES) {
      const r = await compile(prose);
      lines.push(
        `\nPROSE: ${prose}\n  verdict: ${r.verdict}\n  conditions: ${JSON.stringify(
          r.conditions.map((c) => `${c.scope}:${c.interpreted}`),
        )}\n  rejected: ${JSON.stringify(r.rejected.map((x) => `${x.code} | ${x.sourceText}`))}`,
      );
    }
    (await import("node:fs")).writeFileSync(
      "C:/Users/marke/AppData/Local/Temp/claude/E--BoraTradingTool/e873d830-f970-4bd7-ba9b-17b6094c6bb2/scratchpad/probe.txt",
      lines.join("\n"),
      "utf8",
    );
    await resolver.dispose();
  },
  600_000,
);
