import { describe, expect, it } from "vitest";
import { ResearchProposalSchema, type ResearchProposal } from "./proposal-contract";
import { extractJson, fingerprintPacket, verifyProposalSources, type EvidencePacket } from "./bridge";
import { pickModelId } from "@/lib/runtime/gateway";

/**
 * The bridge's trust boundary, under test.
 *
 * Everything here is the part of M5 that must hold when a model behaves badly: a fabricated
 * citation, an empty citation set, prose wrapped around the JSON, and evidence that changed
 * underneath an identical-sounding thesis. The model call itself is not mocked and not tested —
 * mocking a subprocess would only prove the mock works. The runtime proof is the recorded live
 * run (TEST_RESULTS), and these tests are what stop a bad reply from becoming trusted research.
 */

const PACKET: EvidencePacket = {
  instrumentId: "IN:XNSE:SBIN",
  symbol: "SBIN",
  name: "State Bank of India",
  exchange: "XNSE",
  currency: "INR",
  resolution: "D",
  barCount: 740,
  firstDate: "2023-08-10",
  lastDate: "2026-08-07",
  lastClose: 812.35,
  features: { last_close: 812.35, sma_20: 800.1, rsi_14: 58.2 },
  recentCloses: [800, 805, 812.35],
  citableSources: [
    "mp://security-master/IN:XNSE:SBIN",
    "mp://candles/IN:XNSE:SBIN/D?bars=740&from=2023-08-10&to=2026-08-07",
    "mp://features/IN:XNSE:SBIN/D?asOf=2026-08-07",
  ],
  dataLimitations: ["No web access."],
};

function proposalWithSources(sources: string[]): ResearchProposal {
  return ResearchProposalSchema.parse({
    instrumentId: "IN:XNSE:SBIN",
    thesis: "SBIN holding above its 20-day mean continues higher over the following two weeks.",
    rationale: "Close sits 1.5% above the supplied 20-day mean with RSI in the upper half of its range.",
    direction: "LONG",
    timeframe: "SWING",
    requiredFeatures: ["sma_20", "rsi_14"],
    entryConcept: "Enter on a close above sma_20.",
    exitConcept: "Exit on a close below sma_20; stop at 2 ATR.",
    catalysts: ["Trend persistence"],
    risks: ["Mean reversion"],
    sources,
    confidence: 0.45,
    missingEvidence: ["No fundamentals or news were supplied."],
  });
}

describe("source verification — retrieved is not verified", () => {
  it("verifies a proposal that cites only evidence it was actually given", () => {
    const result = verifyProposalSources(
      proposalWithSources([PACKET.citableSources[0], PACKET.citableSources[2]]),
      PACKET,
    );

    expect(result.status).toBe("SOURCE_VERIFIED");
    expect(result.verifiedSources).toHaveLength(2);
    expect(result.rejectedSources).toEqual([]);
  });

  it("rejects a fabricated citation and refuses to call the citation set verified", () => {
    // The failure mode a research bridge actually has: prose that reads like sourced research,
    // citing a filing nobody supplied and the platform cannot check.
    const result = verifyProposalSources(
      proposalWithSources([PACKET.citableSources[0], "https://www.nseindia.com/sbin-annual-report-2026.pdf"]),
      PACKET,
    );

    expect(result.status).toBe("CONFLICTED");
    expect(result.verifiedSources).toEqual([PACKET.citableSources[0]]);
    expect(result.rejectedSources).toEqual(["https://www.nseindia.com/sbin-annual-report-2026.pdf"]);
    expect(result.detail).toContain("cannot be trusted as a whole");
  });

  it("treats a proposal whose every citation is unsupplied as unsourced, not as partly right", () => {
    const result = verifyProposalSources(
      proposalWithSources(["https://example.com/analysis", "Bloomberg terminal"]),
      PACKET,
    );

    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.verifiedSources).toEqual([]);
  });

  it("treats an uncited proposal as insufficient however confident the prose is", () => {
    const result = verifyProposalSources(proposalWithSources([]), PACKET);

    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.detail).toContain("cites no sources at all");
  });
});

describe("evidence fingerprint", () => {
  it("is stable for the same packet", () => {
    expect(fingerprintPacket(PACKET)).toBe(fingerprintPacket({ ...PACKET }));
    expect(fingerprintPacket(PACKET)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when one bar changes, so identical prose over different evidence cannot collide", () => {
    const oneBarDifferent: EvidencePacket = { ...PACKET, recentCloses: [800, 805, 812.36] };

    expect(fingerprintPacket(oneBarDifferent)).not.toBe(fingerprintPacket(PACKET));
  });

  it("changes when a computed feature changes", () => {
    const differentFeature: EvidencePacket = {
      ...PACKET,
      features: { ...PACKET.features, rsi_14: 58.3 },
    };

    expect(fingerprintPacket(differentFeature)).not.toBe(fingerprintPacket(PACKET));
  });
});

describe("model reply extraction", () => {
  it("reads a bare JSON object", () => {
    expect(extractJson('{"direction":"LONG"}')).toEqual({ direction: "LONG" });
  });

  it("reads JSON out of a markdown fence", () => {
    expect(extractJson('```json\n{"direction":"SHORT"}\n```')).toEqual({ direction: "SHORT" });
  });

  it("reads JSON that arrived wrapped in prose", () => {
    expect(extractJson('Here is my proposal:\n{"direction":"NEUTRAL"}\nHope that helps.')).toEqual({
      direction: "NEUTRAL",
    });
  });

  it("throws rather than inventing a proposal when there is no JSON at all", () => {
    expect(() => extractJson("I was unable to complete this analysis.")).toThrow();
  });
});

describe("model attribution", () => {
  it("credits the model that produced the answer, not the one that did an internal step", () => {
    // A headless run delegates small steps to a cheaper model; recording that one as the author
    // of the research would misattribute the work.
    const model = pickModelId({
      modelUsage: {
        "claude-haiku-4-5-20251001": { outputTokens: 12 },
        "claude-sonnet-5": { outputTokens: 940 },
      },
    });

    expect(model).toBe("claude-sonnet-5");
  });

  it("reports unreported rather than guessing when the run names no model", () => {
    expect(pickModelId({})).toBe("unreported");
  });
});
