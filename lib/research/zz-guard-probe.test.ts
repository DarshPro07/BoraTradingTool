import { describe, it } from "vitest";
import { parseFixtures } from "./syntax/fixtures";
import {
  compileResearchProse as compileWithParse,
  verifySourceSpans,
  findParameterSpans,
  findFeatureMentions,
} from "./semantic-compiler";

const compile = (prose: string) => compileWithParse(prose, parseFixtures(prose));

const PROBES = [
  // band bounds that are periods
  "Enter when RSI-14 is between 20 and 50 days of range.",
  "Enter when the lookback is between 20 and 50 days and RSI-14 is above 55.",
  // quantifier route with a period unit
  "Enter when close is above 50 days.",
  "Enter when close is above 200 bars.",
  "Enter when close is above 20 sessions.",
  // period as an operand via a unit noun the parameter regex does not cover
  "Enter when close is above 50 candles.",
  // classic parameter leak the old extractor produced
  "Enter when the close is above the 20-day and 50-day SMAs.",
  "Enter when close is above the 20-day SMA of 20.",
  // dimension attacks
  "Enter when RSI-14 is above 2473.7.",
  "Enter when RSI-14 is above SMA20.",
  "Enter when rsi_14 crosses above the 20-day SMA.",
  // contradiction attacks
  "RSI must be above 60 and below 50.",
  "Enter when RSI-14 is above 60. Enter when RSI-14 is below 50.",
  "Enter when close is above SMA20 and close is below SMA20.",
  "Enter when RSI-14 is between 55 and 70 and RSI-14 is below 40.",
  // substring comparator noise
  "Enter when the underlying RSI-14 is above 55.",
  "Enter after the recovery when close is above SMA20.",
];

describe("guard probe", () => {
  for (const prose of PROBES) {
    it(`probe: ${prose}`, () => {
      const result = compile(prose);
      const lines = [
        `PROSE: ${prose}`,
        `  verdict: ${result.verdict}`,
        `  params: ${JSON.stringify(findParameterSpans(prose).map((s) => s.text))}`,
        `  mentions: ${JSON.stringify(findFeatureMentions(prose).map((m) => `${m.id}@${m.start}-${m.end}`))}`,
        `  clauses: ${JSON.stringify(result.clauses.map((c) => `${c.kind}:${c.text.trim()}`))}`,
        `  conditions: ${JSON.stringify(result.conditions.map((c) => `${c.scope}:${c.interpreted}`))}`,
        `  rejected: ${JSON.stringify(result.rejected.map((r) => r.code))}`,
        `  contradictions: ${JSON.stringify(result.contradictions.map((c) => c.explanation))}`,
        `  spanErrors: ${JSON.stringify(verifySourceSpans(result, prose))}`,
        `  scopes: ${JSON.stringify(result.scopes)}`,
      ];
      console.log(lines.join("\n"));
    });
  }
});
