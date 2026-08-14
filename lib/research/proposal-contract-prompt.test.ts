import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/lib/research/bridge";
import { ResearchProposalSchema } from "@/lib/research/proposal-contract";

/**
 * The producer must be told the contract it will be judged against.
 *
 * ## The defect this guards
 *
 * `ResearchProposalSchema` caps every array item at 300 characters. The system prompt never said
 * so. A complete 47-second, $0.06 research run for RELIANCE was therefore discarded whole:
 *
 *   refusal_code:    CONTRACT_VIOLATION
 *   refusal_message: risks[1] — Too big: expected string to have <=300 characters
 *
 * Nothing was wrong with the research. One risk sentence ran to 301 characters. Because it depends
 * on how verbosely the model happens to write, the same request succeeds sometimes and fails
 * others — which is what made it look like an intermittent hang rather than a contract defect.
 *
 * These tests fail against the unfixed prompt: it contained no length guidance at all, so every
 * assertion below was false.
 */
describe("research system prompt states the proposal contract", () => {
  it("tells the model the per-item limit that rejects whole responses", () => {
    // 300 is the cap on catalysts / risks / missingEvidence items, and the one actually hit.
    expect(SYSTEM_PROMPT).toMatch(/300/);
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/risks/);
    expect(
      SYSTEM_PROMPT.toLowerCase(),
      "the prompt must say a violation is fatal, not cosmetic",
    ).toMatch(/discard|reject/);
  });

  it("states every limit the schema actually enforces", () => {
    // Derived from the schema rather than hand-listed, so a future cap change that is not
    // reflected in the prompt fails here instead of in a discarded production run.
    // Behavioural discovery rather than schema introspection: zod's internals move between major
    // versions (`_def.shape()` existed in v3, not v4), and a drift guard that breaks on a library
    // upgrade would be deleted rather than fixed. Probing the schema with real values asks the
    // only question that matters — at what length does it start rejecting?
    const caps = new Set<number>();
    const base = {
      instrumentId: "IN:XNSE:RELIANCE",
      thesis: "t",
      rationale: "r",
      direction: "NEUTRAL" as const,
      timeframe: "SWING" as const,
      requiredFeatures: [],
      entryConcept: "e",
      exitConcept: "x",
      catalysts: [],
      risks: [],
      sources: [],
      confidence: 0.5,
      missingEvidence: [],
    };

    /** The largest length the field still accepts, found by testing the documented boundaries. */
    const capOf = (apply: (value: string) => Record<string, unknown>): number | null => {
      for (const candidate of [80, 300, 500, 1_000, 2_000, 4_000]) {
        const ok = ResearchProposalSchema.safeParse({ ...base, ...apply("x".repeat(candidate)) });
        const tooBig = ResearchProposalSchema.safeParse({
          ...base,
          ...apply("x".repeat(candidate + 1)),
        });
        if (ok.success && !tooBig.success) return candidate;
      }
      return null;
    };

    for (const cap of [
      capOf((v) => ({ thesis: v })),
      capOf((v) => ({ rationale: v })),
      capOf((v) => ({ entryConcept: v })),
      capOf((v) => ({ exitConcept: v })),
      capOf((v) => ({ risks: [v] })),
      capOf((v) => ({ catalysts: [v] })),
      capOf((v) => ({ missingEvidence: [v] })),
      capOf((v) => ({ requiredFeatures: [v] })),
      capOf((v) => ({ sources: [v] })),
    ]) {
      if (cap !== null) caps.add(cap);
    }

    expect(caps.size, "no length caps discovered — the introspection is broken").toBeGreaterThan(0);

    const missing = [...caps].filter((cap) => !SYSTEM_PROMPT.includes(String(cap)));
    expect(
      missing,
      `the schema enforces limits the prompt never states: ${missing.join(", ")}. ` +
        `A cap the producer is not told about discards its entire response for a formatting reason.`,
    ).toEqual([]);
  });

  it("still forbids the things that make a proposal untrustworthy", () => {
    // Guard against a future edit trimming the prompt down to the length rules.
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/citablesources/);
    expect(lower).toMatch(/missingevidence/);
    expect(lower).toMatch(/neutral/);
    expect(lower, "the no-fabricated-numbers rule must survive").toMatch(/must not compute/);
  });
});
