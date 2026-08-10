import { describe, expect, it } from "vitest";
import {
  FIXTURE_ENVELOPE,
  FIXTURE_PROPOSAL,
  RESEARCH_SESSION_STATES,
  ResearchProposalEnvelopeSchema,
  ResearchProposalSchema,
} from "./proposal-contract";

/**
 * P4A contract tests — written BEFORE any research-provider instance exists, so the bridge is
 * held to a schema with teeth rather than to whatever shape first arrives. The doctrine under
 * test: the provider proposes, MarketPulse verifies — a proposal that tries to carry a verdict
 * must not parse.
 */

describe("ResearchProposal schema", () => {
  it("accepts the fixture and every declared field", () => {
    const parsed = ResearchProposalSchema.parse(FIXTURE_PROPOSAL);
    expect(parsed.instrumentId).toBe("IN:XNSE:SBIN");
    expect(parsed.direction).toBe("LONG");
    expect(parsed.missingEvidence.length).toBeGreaterThan(0);
  });

  it("refuses a proposal that smuggles a verdict or performance claim", () => {
    // .strict() is the enforcement: the schema cannot express profitability, so any attempt to
    // attach one is a parse failure, not a field to be ignored.
    for (const smuggled of [
      { profitable: true },
      { backtestSharpe: 2.1 },
      { verdict: "EXPRESSIBLE" },
      { expectedReturn: 0.12 },
      { guaranteedReturn: 0.5 },
      { promotionStatus: "READY" },
    ]) {
      expect(ResearchProposalSchema.safeParse({ ...FIXTURE_PROPOSAL, ...smuggled }).success).toBe(false);
    }
  });

  it("requires the epistemic essentials: thesis, direction, confidence bounds", () => {
    expect(ResearchProposalSchema.safeParse({ ...FIXTURE_PROPOSAL, thesis: "" }).success).toBe(false);
    expect(ResearchProposalSchema.safeParse({ ...FIXTURE_PROPOSAL, confidence: 1.2 }).success).toBe(false);
    expect(
      ResearchProposalSchema.safeParse({ ...FIXTURE_PROPOSAL, direction: "UP" as never }).success,
    ).toBe(false);
  });

  it("defaults absence-of-evidence fields to empty arrays rather than undefined", () => {
    const minimal = ResearchProposalSchema.parse({
      instrumentId: "IN:XNSE:TCS",
      thesis: "A minimally stated but complete idea for contract purposes.",
      rationale: "Rationale present as the contract requires.",
      direction: "NEUTRAL",
      timeframe: "SWING",
      entryConcept: "Concept only.",
      exitConcept: "Concept only.",
      confidence: 0.1,
    });
    expect(minimal.requiredFeatures).toEqual([]);
    expect(minimal.missingEvidence).toEqual([]);
  });
});

describe("session states", () => {
  it("carries the owner's exact lifecycle", () => {
    expect(RESEARCH_SESSION_STATES).toEqual([
      "IDLE",
      "RESEARCHING",
      "VERIFYING_SOURCES",
      "PROPOSAL_READY",
      "NEEDS_EVIDENCE",
      "FAILED",
    ]);
  });
});

describe("ResearchProposalEnvelope", () => {
  it("accepts the fixture envelope with its unverified status and fixture provenance", () => {
    const parsed = ResearchProposalEnvelopeSchema.parse(FIXTURE_ENVELOPE);
    expect(parsed.researchRun.provider).toBe("fixture");
    expect(parsed.status).toBe("UNVERIFIED");
    expect(parsed.proposal.instrumentId).toBe("IN:XNSE:SBIN");
  });

  it("refuses an envelope whose producer invents a verification status", () => {
    expect(
      ResearchProposalEnvelopeSchema.safeParse({ ...FIXTURE_ENVELOPE, status: "PROFITABLE" }).success,
    ).toBe(false);
    expect(
      ResearchProposalEnvelopeSchema.safeParse({ ...FIXTURE_ENVELOPE, status: "VERIFIED_BY_PROVIDER" }).success,
    ).toBe(false);
  });

  it("keeps the inner proposal held to the same strict contract", () => {
    expect(
      ResearchProposalEnvelopeSchema.safeParse({
        ...FIXTURE_ENVELOPE,
        proposal: { ...FIXTURE_PROPOSAL, profitable: true },
      }).success,
    ).toBe(false);
  });

  it("requires run provenance — an envelope with no runId or provider cannot parse", () => {
    const { runId: _unused, ...withoutRunId } = FIXTURE_ENVELOPE.researchRun;
    expect(
      ResearchProposalEnvelopeSchema.safeParse({ ...FIXTURE_ENVELOPE, researchRun: withoutRunId }).success,
    ).toBe(false);
  });

  it("requires the input-evidence fingerprint, and the fixture's matches its stated recipe", async () => {
    // Same prose over different evidence must never read as the same research result — the
    // fingerprint is required, well-formed, and the fixture constant is recomputed here so it
    // cannot drift from the recipe its comment claims.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          instrumentId: "IN:XNSE:SBIN",
          marketSnapshotId: null,
          note: "fixture packet - no market evidence supplied",
        }),
      )
      .digest("hex");
    expect(FIXTURE_ENVELOPE.inputEvidenceFingerprint).toBe(expected);

    const { inputEvidenceFingerprint: _dropped, ...withoutFingerprint } = FIXTURE_ENVELOPE;
    expect(ResearchProposalEnvelopeSchema.safeParse(withoutFingerprint).success).toBe(false);
    expect(
      ResearchProposalEnvelopeSchema.safeParse({ ...FIXTURE_ENVELOPE, inputEvidenceFingerprint: "not-a-hash" }).success,
    ).toBe(false);
  });
});
