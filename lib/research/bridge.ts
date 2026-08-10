import { createHash } from "node:crypto";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { resolveInstrument } from "@/lib/market/instruments";
import { atr, rollingStdDev, rsi, sma } from "@/lib/quant/indicator-registry";
import { recordAgentRun } from "@/lib/runtime/agent-runs";
import { detectProviders, runAgent } from "@/lib/runtime/gateway";
import { defaultProfile, type RuntimeProfile } from "@/lib/runtime/routing";
import {
  ResearchProposalSchema,
  ResearchProposalEnvelopeSchema,
  type ResearchProposal,
  type ResearchProposalEnvelope,
  type ResearchSessionEvent,
  type ResearchSessionState,
} from "./proposal-contract";

/**
 * M5 — the research bridge. The first path in this system where a real model reasons about a real
 * instrument over real stored evidence, and the result survives as a typed, verified envelope.
 *
 * The doctrine it implements, in order of who is allowed to do what:
 *
 *   1. **The quant core computes.** Every number in the evidence packet — SMA, RSI, ATR, realized
 *      volatility — is produced by `lib/quant/indicator-registry.ts` before the model is called.
 *      The model is never asked to calculate; it is asked to interpret. A language model
 *      producing a plausible-looking RSI is worse than no RSI at all.
 *   2. **The provider proposes.** It returns a thesis, a direction and its claimed citations.
 *      It cannot return a verdict, a backtest number or a profitability claim — the schema has
 *      nowhere to put one.
 *   3. **MarketPulse verifies.** Retrieved is not verified (§30). Every citation is checked
 *      against the exact evidence packet that was supplied; anything else is REJECTED, and a
 *      proposal that cites nothing real cannot reach SOURCE_VERIFIED no matter how confident the
 *      prose is. This is what catches a fabricated citation, which is the failure mode a research
 *      bridge actually has.
 *
 * The run is bounded on purpose: the adapter runs with no tools and no web access, so "research"
 * here means reasoning over MarketPulse's own evidence. That limitation is stated in the packet
 * and carried into the envelope rather than hidden behind the word research.
 */

/** Bars the model is shown. Enough to see a trend; small enough that the packet stays bounded. */
const RECENT_BAR_WINDOW = 20;
const MIN_BARS_FOR_RESEARCH = 60;

export interface EvidencePacket {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  resolution: "D";
  barCount: number;
  firstDate: string;
  lastDate: string;
  lastClose: number;
  /** Computed by the deterministic engine. The model receives these; it never derives them. */
  features: Record<string, number | null>;
  recentCloses: number[];
  /** The ONLY strings a proposal may cite. Anything else is a fabrication by construction. */
  citableSources: string[];
  /** Stated limitations travel with the evidence, so they cannot be lost on the way to a UI. */
  dataLimitations: string[];
}

export type PacketResult =
  | { ok: true; packet: EvidencePacket; fingerprint: string }
  | { ok: false; code: "INSTRUMENT_UNKNOWN" | "NO_STORED_DATA"; message: string };

/**
 * Assemble the bounded evidence packet for one instrument, and fingerprint it.
 *
 * The fingerprint is sha256 over the canonical serialization of the packet object. Owner
 * requirement 2026-08-10 19:43: the same prose proposal over DIFFERENT underlying evidence must
 * never read as the same research result. Because the features and bars are inside the packet,
 * one changed bar changes the fingerprint, and the two runs are permanently distinguishable.
 */
export function buildEvidencePacket(instrumentIdRaw: string): PacketResult {
  let instrument;
  try {
    instrument = resolveInstrument(instrumentIdRaw);
  } catch (caught) {
    return {
      ok: false,
      code: "INSTRUMENT_UNKNOWN",
      message: caught instanceof Error ? caught.message : `Cannot resolve ${instrumentIdRaw}.`,
    };
  }

  const bars = loadStoredCandles(instrument.id, "D");
  if (bars.length < MIN_BARS_FOR_RESEARCH) {
    return {
      ok: false,
      code: "NO_STORED_DATA",
      message:
        `The canonical store holds ${bars.length} daily bars for ${instrument.id}; ${MIN_BARS_FOR_RESEARCH} ` +
        "are required before an instrument can be researched. Missing history is an ingestion task — " +
        "the bridge refuses rather than researching an instrument it cannot see.",
    };
  }

  const closes = bars.map((bar) => bar.close);
  const last = <T>(series: readonly (T | null)[]): T | null => {
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (series[index] !== null) return series[index] as T;
    }
    return null;
  };

  const lastClose = closes[closes.length - 1];
  const sma20 = last(sma(closes, 20));
  const sma50 = last(sma(closes, 50));
  const dailyStdDev = last(
    rollingStdDev(
      closes.map((close, index) => (index === 0 ? 0 : (close - closes[index - 1]) / closes[index - 1])),
      20,
    ),
  );

  const round = (value: number | null, places = 2): number | null =>
    value === null ? null : Number(value.toFixed(places));

  const features: Record<string, number | null> = {
    last_close: round(lastClose),
    sma_20: round(sma20),
    sma_50: round(sma50),
    close_vs_sma20_pct: sma20 === null ? null : round(((lastClose - sma20) / sma20) * 100),
    close_vs_sma50_pct: sma50 === null ? null : round(((lastClose - sma50) / sma50) * 100),
    rsi_14: round(last(rsi(closes, 14))),
    atr_14: round(
      last(
        atr(
          {
            open: bars.map((bar) => bar.open),
            high: bars.map((bar) => bar.high),
            low: bars.map((bar) => bar.low),
            close: closes,
            volume: bars.map((bar) => bar.volume ?? 0),
          },
          14,
        ),
      ),
    ),
    // Annualized from daily standard deviation over 252 sessions — a stated convention, applied
    // by the deterministic engine, not a number the model is invited to produce.
    realized_vol_20d_annualized_pct: dailyStdDev === null ? null : round(dailyStdDev * Math.sqrt(252) * 100),
  };

  const toDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
  const firstDate = toDate(bars[0].time);
  const lastDate = toDate(bars[bars.length - 1].time);

  const packet: EvidencePacket = {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    currency: instrument.currency,
    resolution: "D",
    barCount: bars.length,
    firstDate,
    lastDate,
    lastClose: round(lastClose) as number,
    features,
    recentCloses: closes.slice(-RECENT_BAR_WINDOW).map((close) => round(close) as number),
    citableSources: [
      `mp://security-master/${instrument.id}`,
      `mp://candles/${instrument.id}/D?bars=${bars.length}&from=${firstDate}&to=${lastDate}`,
      `mp://features/${instrument.id}/D?asOf=${lastDate}`,
    ],
    dataLimitations: [
      "This run has no web access and no tools: it reasons only over the evidence in this packet.",
      "No fundamentals, no news, no earnings, no order-flow and no sector data are supplied.",
      "Daily bars only — nothing intraday is available to this run.",
    ],
  };

  return { ok: true, packet, fingerprint: fingerprintPacket(packet) };
}

export function fingerprintPacket(packet: EvidencePacket): string {
  return createHash("sha256").update(JSON.stringify(packet), "utf8").digest("hex");
}

export interface SourceVerification {
  verifiedSources: string[];
  rejectedSources: string[];
  status: "SOURCE_VERIFIED" | "CONFLICTED" | "INSUFFICIENT_EVIDENCE";
  detail: string;
}

/**
 * MarketPulse's own verification of what the proposal claims to have used.
 *
 * A citation is verified only if it is one of the strings the packet actually supplied. The three
 * outcomes are distinct kinds of result, not degrees of the same one:
 *
 *   SOURCE_VERIFIED       every citation traces to supplied evidence.
 *   CONFLICTED            some citations trace and some do not — the citation set cannot be
 *                         trusted as a whole, which is a materially different problem from
 *                         having too little evidence.
 *   INSUFFICIENT_EVIDENCE nothing the proposal cites was ever supplied to it.
 */
export function verifyProposalSources(
  proposal: ResearchProposal,
  packet: EvidencePacket,
): SourceVerification {
  const citable = new Set(packet.citableSources);
  const verifiedSources = proposal.sources.filter((source) => citable.has(source));
  const rejectedSources = proposal.sources.filter((source) => !citable.has(source));

  if (verifiedSources.length === 0) {
    return {
      verifiedSources,
      rejectedSources,
      status: "INSUFFICIENT_EVIDENCE",
      detail:
        rejectedSources.length === 0
          ? "The proposal cites no sources at all, so nothing in it traces to evidence."
          : `None of the ${rejectedSources.length} cited source(s) were supplied to this run — they cannot be verified and the proposal is treated as unsourced.`,
    };
  }
  if (rejectedSources.length > 0) {
    return {
      verifiedSources,
      rejectedSources,
      status: "CONFLICTED",
      detail: `${verifiedSources.length} citation(s) trace to supplied evidence but ${rejectedSources.length} do not: ${rejectedSources.join(", ")}. A citation set that mixes real and unsupplied evidence cannot be trusted as a whole.`,
    };
  }
  return {
    verifiedSources,
    rejectedSources,
    status: "SOURCE_VERIFIED",
    detail: `All ${verifiedSources.length} citation(s) trace to evidence this run was actually given.`,
  };
}

const SYSTEM_PROMPT = [
  "You are a securities research analyst producing a structured research proposal for a quantitative research platform.",
  "You output ONLY a single JSON object and no other text. No markdown fences, no commentary.",
  "",
  "Hard rules:",
  "- You MUST NOT compute or restate any indicator value yourself. Every number you need is already in the evidence packet, computed by the platform's deterministic engine.",
  "- You MUST NOT claim profitability, expected return, win rate, or any backtest result. The platform tests the rule; you propose it.",
  "- You MAY ONLY cite strings that appear verbatim in the packet's citableSources array. Citing anything else — a URL, a news outlet, a filing, a source you believe exists — will be detected and rejected.",
  "- You MUST list in missingEvidence everything material you could not establish from the packet. An empty missingEvidence array on a packet this bounded is itself a red flag.",
  "- confidence is your MODEL confidence in the reasoning, from 0 to 1. It is never strategy confidence, and the platform will not treat it as one.",
  "- If the evidence does not support a directional view, use direction NEUTRAL. Abstaining is a valid and frequently correct answer.",
].join("\n");

function userPrompt(packet: EvidencePacket): string {
  return [
    "Evidence packet (this is everything you have):",
    JSON.stringify(packet, null, 2),
    "",
    "Return exactly this JSON shape:",
    JSON.stringify(
      {
        instrumentId: packet.instrumentId,
        thesis: "one testable sentence",
        rationale: "why, referencing only the supplied features",
        direction: "LONG | SHORT | NEUTRAL",
        timeframe: "INTRADAY | SWING | POSITIONAL",
        requiredFeatures: ["feature_name_the_platform_would_need"],
        entryConcept: "when a position would be opened",
        exitConcept: "when it would be closed, including a stop",
        catalysts: ["what would make this work"],
        risks: ["what would break it"],
        sources: ["only strings from citableSources"],
        confidence: 0.5,
        missingEvidence: ["what you could not establish"],
      },
      null,
      2,
    ),
  ].join("\n");
}

/** Models wrap JSON in prose or fences often enough that tolerating it is cheaper than retrying. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first === -1 || last <= first) throw new Error("No JSON object found in the model's reply.");
    return JSON.parse(candidate.slice(first, last + 1));
  }
}

export type BridgeResult =
  | { ok: true; envelope: ResearchProposalEnvelope; events: ResearchSessionEvent[] }
  | { ok: false; code: string; message: string; events: ResearchSessionEvent[] };

/**
 * Research one instrument end to end: evidence → model → verification → envelope.
 *
 * Every stage emits an event with a real timestamp, so the UI timeline reports what happened
 * rather than animating a script.
 */
export async function researchInstrument(
  instrumentIdRaw: string,
  options: { profile?: RuntimeProfile; timeoutMs?: number } = {},
): Promise<BridgeResult> {
  const events: ResearchSessionEvent[] = [];
  const emit = (state: ResearchSessionState, detail: string) => {
    events.push({ at: new Date().toISOString(), state, detail });
  };

  const sessionStartedAt = new Date();

  const built = buildEvidencePacket(instrumentIdRaw);
  if (!built.ok) {
    emit("FAILED", built.message);
    // Recorded even though no provider ran: "we could not research SBIN because the store is
    // empty" is exactly the kind of thing the owner needs to find in the ledger the next morning.
    recordRefusal({
      instrumentId: instrumentIdRaw,
      provider: "none",
      code: built.code,
      message: built.message,
      startedAt: sessionStartedAt,
    });
    return { ok: false, code: built.code, message: built.message, events };
  }
  const { packet, fingerprint } = built;

  emit(
    "RESEARCHING",
    `Evidence assembled: ${packet.barCount} daily bars for ${packet.symbol} (${packet.firstDate} → ${packet.lastDate}), ` +
      `${Object.keys(packet.features).length} deterministic features, fingerprint ${fingerprint.slice(0, 12)}…`,
  );

  const profile = options.profile ?? defaultProfile("SUBSCRIPTION_FIRST", `boot_${Date.now()}`);
  const detected = await detectProviders();

  const run = await runAgent({
    capability: "RESEARCH",
    prompt: userPrompt(packet),
    systemPrompt: SYSTEM_PROMPT,
    profile,
    detected,
    timeoutMs: options.timeoutMs,
  });

  if (!run.ok) {
    const trail = run.attempted.map((entry) => `${entry.provider}: ${entry.reason}`).join(" · ");
    const message = trail ? `${run.message} (${trail})` : run.message;
    emit("FAILED", message);
    recordRefusal({
      instrumentId: packet.instrumentId,
      provider: run.attempted[0]?.provider ?? "none",
      code: run.code,
      message,
      startedAt: sessionStartedAt,
      evidenceFingerprint: fingerprint,
    });
    return { ok: false, code: run.code, message, events };
  }

  emit(
    "VERIFYING_SOURCES",
    `${run.provider}/${run.model} replied in ${Math.round(
      (Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000,
    )}s. Checking every citation against the packet that was actually supplied.`,
  );

  let proposal: ResearchProposal;
  try {
    proposal = ResearchProposalSchema.parse({
      ...(extractJson(run.text) as Record<string, unknown>),
      // The instrument is ours, not the model's: it cannot redirect the proposal to another
      // security by writing a different id.
      instrumentId: packet.instrumentId,
    });
  } catch (caught) {
    const message = `The provider's reply did not satisfy the proposal contract: ${
      caught instanceof Error ? caught.message : String(caught)
    }`;
    emit("FAILED", message);
    recordRefusal({
      instrumentId: packet.instrumentId,
      provider: run.provider,
      model: run.model,
      code: "CONTRACT_VIOLATION",
      message,
      startedAt: sessionStartedAt,
      evidenceFingerprint: fingerprint,
      tokens: run.tokens,
      cost: run.cost,
      costCurrency: run.costCurrency,
    });
    return { ok: false, code: "CONTRACT_VIOLATION", message, events };
  }

  const verification = verifyProposalSources(proposal, packet);

  const envelope = ResearchProposalEnvelopeSchema.parse({
    proposal,
    researchRun: {
      provider: run.provider,
      model: run.model,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      tokens: run.tokens,
      cost: run.cost,
      costCurrency: run.costCurrency,
      runId: run.runId,
    },
    evidence: {
      instrumentId: packet.instrumentId,
      marketSnapshotId: null,
      retrievedSources: packet.citableSources,
      verifiedSources: verification.verifiedSources,
      rejectedSources: verification.rejectedSources,
    },
    status: verification.status,
    inputEvidenceFingerprint: fingerprint,
  });

  recordAgentRun({
    id: run.runId,
    capability: "RESEARCH",
    provider: run.provider,
    model: run.model,
    status: "COMPLETED",
    trigger: "USER",
    instrumentId: packet.instrumentId,
    evidenceFingerprint: fingerprint,
    envelope,
    refusalCode: null,
    refusalMessage: null,
    tokens: run.tokens,
    cost: run.cost,
    costCurrency: run.costCurrency,
    fallbackReason: run.fallbackReason,
    startedAt: sessionStartedAt,
    completedAt: new Date(),
  });

  emit(
    verification.status === "INSUFFICIENT_EVIDENCE" ? "NEEDS_EVIDENCE" : "PROPOSAL_READY",
    verification.detail,
  );

  return { ok: true, envelope, events };
}

/**
 * Record a run that produced no envelope.
 *
 * Deliberately never throws: a ledger write that fails must not turn a clean refusal ("the store
 * has no bars") into a 500 that hides it. The refusal is still returned to the caller either way.
 */
function recordRefusal(input: {
  instrumentId: string;
  provider: string;
  model?: string;
  code: string;
  message: string;
  startedAt: Date;
  evidenceFingerprint?: string;
  tokens?: number | null;
  cost?: number | null;
  costCurrency?: "USD" | "INR" | null;
}): void {
  try {
    recordAgentRun({
      id: `agr_${createHash("sha256")
        .update(`${input.instrumentId}|${input.code}|${input.startedAt.toISOString()}`, "utf8")
        .digest("hex")
        .slice(0, 16)}`,
      capability: "RESEARCH",
      provider: input.provider,
      model: input.model ?? "none",
      status: input.code === "CONTRACT_VIOLATION" ? "FAILED" : "REFUSED",
      trigger: "USER",
      instrumentId: input.instrumentId,
      evidenceFingerprint: input.evidenceFingerprint ?? null,
      envelope: null,
      refusalCode: input.code,
      refusalMessage: input.message,
      tokens: input.tokens ?? null,
      cost: input.cost ?? null,
      costCurrency: input.costCurrency ?? null,
      fallbackReason: null,
      startedAt: input.startedAt,
      completedAt: new Date(),
    });
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }
}
