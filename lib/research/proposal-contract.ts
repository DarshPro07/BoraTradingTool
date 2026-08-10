import { z } from "zod";

/**
 * P4A — the research-provider ↔ MarketPulse contract (owner spec, 2026-08-10; MISSION.md).
 *
 * MarketPulse consumes research from an **external research provider** — an interchangeable
 * agentic researcher that runs as its own service and is reached over HTTP/MCP. The internal
 * codename for the currently-evaluated provider is **Scout**. Nothing here is coupled to a
 * particular vendor: any provider that returns a valid envelope satisfies this contract, and
 * swapping providers is a configuration change, not a rewrite.
 *
 * STATUS: IMPLEMENTED_AGAINST_CONTRACT / NOT_INTEGRATION_VERIFIED. No provider instance has
 * produced one of these yet — the engine lane's M4/M5 items do that. This module exists so the
 * UI lane can build the Research-this-stock surface against a typed, validated contract instead
 * of an imagined one, and so the bridge, when it lands, is held to a schema that already has
 * tests.
 *
 * Division of authority, verbatim doctrine: **the provider proposes. MarketPulse verifies.** A
 * proposal carries a thesis and its claimed evidence; it carries NO verdict, NO backtest
 * numbers, and NO profitability claim — those only exist after MarketPulse's own
 * triage/authoring/validation, which this schema deliberately cannot express.
 */

const Text = (max: number) => z.string().trim().min(1).max(max);

export const ResearchProposalSchema = z
  .object({
    instrumentId: Text(64),
    thesis: Text(2_000),
    rationale: Text(4_000),
    direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
    timeframe: z.enum(["INTRADAY", "SWING", "POSITIONAL"]),
    requiredFeatures: z.array(Text(80)).max(20).default([]),
    entryConcept: Text(1_000),
    exitConcept: Text(1_000),
    catalysts: z.array(Text(300)).max(10).default([]),
    risks: z.array(Text(300)).max(10).default([]),
    /** Provenance of the claims — URLs or MarketPulse source ids. Empty means unsourced. */
    sources: z.array(Text(500)).max(20).default([]),
    confidence: z.number().min(0).max(1),
    /** What the researcher could NOT establish. Absence of gaps must be stated, not implied. */
    missingEvidence: z.array(Text(300)).max(10).default([]),
  })
  .strict();

export type ResearchProposal = z.infer<typeof ResearchProposalSchema>;

/**
 * The verification envelope (owner amendment, 2026-08-10 18:33). The proposal inside is the
 * unchanged contract above; the envelope is what stops "a provider generated it → therefore it
 * is research truth": provenance of the run, the evidence actually retrieved and verified, and a
 * verification status MarketPulse assigns — never the producer. `confidence` inside the proposal
 * is MODEL confidence; nothing in this envelope can promote it into strategy confidence.
 */
export const PROPOSAL_VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "SOURCE_VERIFIED",
  "CONFLICTED",
  "INSUFFICIENT_EVIDENCE",
] as const;

export const ResearchProposalEnvelopeSchema = z
  .object({
    proposal: ResearchProposalSchema,
    researchRun: z
      .object({
        provider: Text(60),
        model: Text(120),
        modelVersion: Text(120).optional(),
        startedAt: z.string().datetime(),
        completedAt: z.string().datetime(),
        tokens: z.number().int().min(0).nullable(),
        cost: z.number().min(0).nullable(),
        /**
         * The currency `cost` is denominated in, as the PROVIDER reported it. Required whenever a
         * cost is present: Claude Code reports USD while an Indian provider would report INR, and
         * a bare number rendered under a hardcoded symbol is a fabricated conversion.
         */
        costCurrency: z.enum(["USD", "INR"]).nullable().default(null),
        runId: Text(120),
      })
      .strict(),
    evidence: z
      .object({
        instrumentId: Text(64),
        /** The bounded MarketPulse evidence snapshot the researcher was shown, when one was. */
        marketSnapshotId: Text(120).nullable(),
        /** v7 §15: the LIST of what was retrieved, not a bare count — a count hides what. */
        retrievedSources: z.array(Text(500)).max(50).default([]),
        verifiedSources: z.array(Text(500)).max(50).default([]),
        rejectedSources: z.array(Text(500)).max(50).default([]),
      })
      .strict(),
    /** Assigned by MarketPulse verification, never supplied by the producer as trusted. */
    status: z.enum(PROPOSAL_VERIFICATION_STATUSES),
    /**
     * sha256 hex of the canonical serialization (JSON.stringify of the packet object, keys in
     * construction order) of the evidence packet the producer actually received. The M5 bridge
     * computes it when assembling the packet. Owner requirement 2026-08-10 19:43: the same
     * prose proposal over DIFFERENT underlying evidence must never read as the same research
     * result — the fingerprint is what makes that structurally impossible.
     */
    inputEvidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type ResearchProposalEnvelope = z.infer<typeof ResearchProposalEnvelopeSchema>;

/**
 * The Research-this-stock session, as the UI renders it. Terminal states are PROPOSAL_READY,
 * NEEDS_EVIDENCE and FAILED; the first two are SUCCESSES of different kinds — "here is a
 * proposal" and "here is exactly what stopped one" — and only FAILED is an error.
 */
export const RESEARCH_SESSION_STATES = [
  "IDLE",
  "RESEARCHING",
  "VERIFYING_SOURCES",
  "PROPOSAL_READY",
  "NEEDS_EVIDENCE",
  "FAILED",
] as const;

export type ResearchSessionState = (typeof RESEARCH_SESSION_STATES)[number];

export interface ResearchSessionEvent {
  at: string;
  state: ResearchSessionState;
  /** One plain sentence of what is happening or what stopped it. */
  detail: string;
}

/**
 * A deterministic fixture for building and testing the UI. Explicitly a fixture: nothing
 * downstream may treat it as research. The instrument is real so triage wiring can be exercised
 * end to end the moment the bridge exists.
 */
export const FIXTURE_PROPOSAL: ResearchProposal = ResearchProposalSchema.parse({
  instrumentId: "IN:XNSE:SBIN",
  thesis:
    "SBIN gapping >= 2% on relative volume >= 1.5 after public-sector-bank sector strength continues upward intraday.",
  rationale:
    "Opening imbalances in high-liquidity PSU banks have historically persisted through the first session hour; sector-level confirmation filters idiosyncratic gaps.",
  direction: "LONG",
  timeframe: "INTRADAY",
  requiredFeatures: ["gap_pct", "rvol", "sector_return"],
  entryConcept: "Enter when gap_pct >= 2 and rvol >= 1.5 within the first 15 minutes.",
  exitConcept: "Square off by broker deadline; stop 0.5%, target 1%.",
  catalysts: ["Sector index momentum", "Opening auction imbalance"],
  risks: ["Gap fade in weak breadth", "News-driven reversal"],
  sources: ["fixture://not-research/authored-for-ui-contract-tests"],
  confidence: 0.4,
  missingEvidence: ["sector_return feature is not derivable from price bars in this deployment yet"],
});

/**
 * The fixture envelope the U3/U4 surface renders until the P4A bridge exists. provider "fixture"
 * is the machine-readable marker the UI uses to draw its NOT INTEGRATION VERIFIED banner —
 * a real bridge result can never carry it.
 */
export const FIXTURE_ENVELOPE: ResearchProposalEnvelope = ResearchProposalEnvelopeSchema.parse({
  proposal: FIXTURE_PROPOSAL,
  researchRun: {
    provider: "fixture",
    model: "contract-fixture",
    startedAt: "2026-08-10T10:00:00.000Z",
    completedAt: "2026-08-10T10:00:04.000Z",
    tokens: null,
    cost: null,
    runId: "fixture-run-p4a-contract",
  },
  evidence: {
    instrumentId: "IN:XNSE:SBIN",
    marketSnapshotId: null,
    retrievedSources: ["fixture://not-research/authored-for-ui-contract-tests"],
    verifiedSources: [],
    rejectedSources: ["fixture://not-research/authored-for-ui-contract-tests"],
  },
  status: "UNVERIFIED",
  // sha256 of JSON.stringify({instrumentId:"IN:XNSE:SBIN", marketSnapshotId:null,
  // note:"fixture packet - no market evidence supplied"}) — the contract test recomputes this
  // exact recipe, so the constant cannot silently drift from its meaning.
  inputEvidenceFingerprint: "044c4ce29fbd9ae8aadf58075a9d19644a45d51231331a96c3596084191f2bed",
});
