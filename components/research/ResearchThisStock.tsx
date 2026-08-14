"use client";

import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/system/Panel";
import { mutationFetch } from "@/lib/client/mutation-fetch";
import type {
  ResearchProposalEnvelope,
  ResearchSessionEvent,
  ResearchSessionState,
} from "@/lib/research/proposal-contract";

/**
 * U3/U4 — the Research-this-stock surface (mission P0-MEETING, UI lane).
 *
 * STATUS: INTEGRATED 2026-08-10. The M5 bridge exists, so this surface now drives a real model
 * over real stored evidence through /api/research/stock. The fixture driver is gone — it was
 * scaffolding for exactly this moment, and keeping it would leave a path that can produce
 * research-shaped content with no provider behind it.
 *
 * What did NOT change is the honesty apparatus, because it was built to survive this transition:
 * the banners are driven by the envelope's own provenance and MarketPulse's assigned verification
 * status, never by which code path ran. A real run that cites nothing verifiable is labelled just
 * as loudly as a fixture was, and its hand-off is disabled just as firmly. The lifecycle is the
 * owner's: IDLE → RESEARCHING → VERIFYING_SOURCES → PROPOSAL_READY | NEEDS_EVIDENCE | FAILED.
 */

const STATE_TONE: Record<ResearchSessionState, string> = {
  IDLE: "text-muted-foreground",
  RESEARCHING: "text-terminal",
  VERIFYING_SOURCES: "text-amber",
  PROPOSAL_READY: "text-gain",
  NEEDS_EVIDENCE: "text-amber",
  FAILED: "text-loss",
};

type BridgeResponse =
  | { ok: true; envelope: ResearchProposalEnvelope; events: ResearchSessionEvent[] }
  | { ok: false; code: string; message: string; events: ResearchSessionEvent[] };

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", INR: "₹" };

interface HandoffResult {
  verdict: string;
  reason: string;
  authored: { specId: string; name: string } | null;
}

/**
 * Turn a verified proposal into the hypothesis the existing triage engine already understands.
 *
 * The provenance goes into the rationale rather than being dropped: months later, "which research
 * run produced this strategy, over which evidence" must be answerable from the hypothesis itself.
 * Nothing here invents a threshold — the triage reads the researcher's own words, and if they are
 * too vague to express, NEEDS_FEATURE is the correct and useful answer.
 */
function hypothesisFrom(envelope: ResearchProposalEnvelope) {
  const { proposal, researchRun, evidence, inputEvidenceFingerprint } = envelope;
  const title = `${proposal.instrumentId} — ${proposal.direction} ${proposal.timeframe}`.slice(0, 160);
  const statement = [proposal.thesis, `Entry: ${proposal.entryConcept}`, `Exit: ${proposal.exitConcept}`]
    .join(" ")
    .slice(0, 2_000);
  const rationale = [
    proposal.rationale,
    "",
    `Provenance: ${researchRun.provider}/${researchRun.model} run ${researchRun.runId}, evidence fingerprint ${inputEvidenceFingerprint}.`,
    `MarketPulse verification: ${envelope.status} (${evidence.verifiedSources.length} of ${evidence.retrievedSources.length} citations verified).`,
    proposal.missingEvidence.length > 0 ? `Researcher-declared gaps: ${proposal.missingEvidence.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);

  return { title, statement, rationale, market: proposal.instrumentId.startsWith("US:") ? "US" : "NSE" };
}

/**
 * The shape `/api/market/ingest` answers with. Only the fields this surface renders are declared —
 * the route returns more (inserted/skipped/rejected/source) for the ledger and the API consumer.
 */
interface IngestOutcome {
  ok: boolean;
  code: string;
  message: string;
  storedAfter: number;
  required: number;
  ready: boolean;
}

export function ResearchThisStock({ instrumentId }: { instrumentId: string }) {
  const [state, setState] = useState<ResearchSessionState>("IDLE");
  const [timeline, setTimeline] = useState<ResearchSessionEvent[]>([]);
  const [envelope, setEnvelope] = useState<ResearchProposalEnvelope | null>(null);
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestOutcome | null>(null);
  const running = useRef(false);

  // Evidence survives a reload. A research run costs real quota and real minutes; a surface that
  // forgets it the moment the page refreshes teaches the owner the system has no memory — and the
  // ledger is what makes the run auditable later.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/research/stock?instrumentId=${encodeURIComponent(instrumentId)}`,
        );
        const payload = (await response.json()) as
          | { found: true; envelope: ResearchProposalEnvelope; completedAt: string }
          | { found: false };
        if (cancelled || !payload.found || running.current) return;
        setEnvelope(payload.envelope);
        setState(payload.envelope.status === "INSUFFICIENT_EVIDENCE" ? "NEEDS_EVIDENCE" : "PROPOSAL_READY");
        setRestored(payload.completedAt);
      } catch {
        // A failed restore is not an error state: the surface simply offers to research.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instrumentId]);

  /**
   * Ingest history for this instrument, then let the owner research it.
   *
   * `NO_STORED_DATA` is a CORRECT refusal — the bridge will not research an instrument it cannot
   * see, and softening that would be the fabrication the product forbids. But a correct refusal
   * with no way out is still a dead end: the only route to history used to be two CLI steps run
   * outside the application, which meant a fresh database could never become researchable through
   * the product at all. The refusal now carries an action.
   *
   * The outcome is rendered verbatim, including the unfit-for-validation declaration. Ingested
   * bars are unadjusted and exclude delisted names; the whole point of the import is that
   * declaration travelling with the data, not the bars themselves.
   */
  async function ingestHistory() {
    if (ingesting) return;
    setIngesting(true);
    setIngestResult(null);
    try {
      const response = await mutationFetch("/api/market/ingest", {
        method: "POST",
        body: JSON.stringify({ instrumentId }),
      });
      const payload = (await response.json()) as IngestOutcome | { error: string; message: string };
      if (!("ok" in payload)) {
        setIngestResult({
          ok: false,
          code: payload.error,
          message: payload.message,
          storedAfter: 0,
          required: 0,
          ready: false,
        });
        return;
      }
      setIngestResult(payload);
      // Ready means the refusal that prompted this no longer applies. Clear it so the surface
      // stops showing a stale reason the user has just resolved.
      if (payload.ready) setRefusal(null);
    } catch (caught) {
      setIngestResult({
        ok: false,
        code: "REQUEST_FAILED",
        message: caught instanceof Error ? caught.message : String(caught),
        storedAfter: 0,
        required: 0,
        ready: false,
      });
    } finally {
      setIngesting(false);
    }
  }

  async function run() {
    if (running.current) return;
    running.current = true;
    setEnvelope(null);
    setRefusal(null);
    setRestored(null);
    setState("RESEARCHING");
    setTimeline([
      {
        at: new Date().toISOString(),
        state: "RESEARCHING",
        detail: `Assembling the evidence packet for ${instrumentId} and calling the research provider. This takes as long as the model takes.`,
      },
    ]);

    try {
      const response = await mutationFetch("/api/research/stock", {
        method: "POST",
        body: JSON.stringify({ instrumentId }),
      });
      const payload = (await response.json()) as BridgeResponse | { error: string; message: string };

      if (!("ok" in payload)) {
        setState("FAILED");
        setRefusal({ code: payload.error, message: payload.message });
        return;
      }

      // The server's timeline carries the real timings; the client's optimistic first line is
      // replaced rather than merged, so nothing on screen is a guess about what happened.
      setTimeline(payload.events);
      if (payload.ok) {
        setEnvelope(payload.envelope);
        setState(payload.envelope.status === "INSUFFICIENT_EVIDENCE" ? "NEEDS_EVIDENCE" : "PROPOSAL_READY");
      } else {
        setState("FAILED");
        setRefusal({ code: payload.code, message: payload.message });
      }
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Session failed.";
      setState("FAILED");
      setRefusal({ code: "REQUEST_FAILED", message: detail });
      setTimeline((current) => [...current, { at: new Date().toISOString(), state: "FAILED", detail }]);
    } finally {
      running.current = false;
    }
  }

  async function sendToFactory() {
    if (!envelope || envelope.status !== "SOURCE_VERIFIED" || handingOff) return;
    setHandingOff(true);
    try {
      const response = await mutationFetch("/api/research/hypotheses", {
        method: "POST",
        body: JSON.stringify(hypothesisFrom(envelope)),
      });
      const payload = (await response.json()) as
        | HandoffResult
        | { error: string; message: string };
      setHandoff(
        "verdict" in payload
          ? payload
          : { verdict: payload.error, reason: payload.message, authored: null },
      );
    } catch (caught) {
      setHandoff({
        verdict: "REQUEST_FAILED",
        reason: caught instanceof Error ? caught.message : "The hand-off request failed.",
        authored: null,
      });
    } finally {
      setHandingOff(false);
    }
  }

  const busy = state === "RESEARCHING" || state === "VERIFYING_SOURCES";
  const isFixture = envelope?.researchRun.provider === "fixture";
  const verified = envelope?.status === "SOURCE_VERIFIED";
  const symbol = envelope?.researchRun.costCurrency
    ? (CURRENCY_SYMBOL[envelope.researchRun.costCurrency] ?? `${envelope.researchRun.costCurrency} `)
    : "";

  return (
    <Panel title="RESEARCH THIS STOCK — AUTONOMOUS PROPOSAL, VERIFIED BY MARKETPULSE">
      <div className="p-3 space-y-2 text-[11px]" data-testid="research-stock">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="border border-terminal text-terminal px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-terminal/10 disabled:opacity-50"
            data-testid="research-stock-run"
          >
            {busy ? "Researching…" : "Research this stock"}
          </button>
          <span className={`text-[10px] uppercase tracking-wider ${STATE_TONE[state]}`} data-testid="research-stock-state">
            {state.replace(/_/g, " ")}
          </span>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          The provider proposes; MarketPulse verifies every citation against the evidence it
          actually supplied; the quant core tests the rule; forward and paper prove it
          prospectively. Indicator values are computed by the deterministic engine before the model
          is called — it interprets numbers, it never produces them.
        </p>

        {timeline.length > 0 ? (
          <ol className="space-y-0.5 font-mono text-[10px]" data-testid="research-stock-timeline">
            {timeline.map((event, index) => (
              <li key={`${event.state}-${index}`}>
                <span className="text-muted-foreground">{event.at.slice(11, 19)}</span>{" "}
                <span className={STATE_TONE[event.state]}>{event.state.replace(/_/g, " ")}</span>{" "}
                <span className="text-muted-foreground">— {event.detail}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {refusal ? (
          <div className="border border-loss bg-loss/10 px-2 py-1.5 text-[10px] text-loss" data-testid="research-stock-refusal">
            <span className="uppercase tracking-widest">{refusal.code}</span> — {refusal.message}
          </div>
        ) : null}

        {/* A missing-history refusal carries its remedy. Only NO_STORED_DATA — every other refusal
            has a different cause, and offering an ingest button for them would be noise. */}
        {refusal?.code === "NO_STORED_DATA" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={ingestHistory}
              disabled={ingesting}
              className="border border-amber text-amber px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-amber/10 disabled:opacity-50"
              data-testid="research-stock-ingest"
            >
              {ingesting ? "Ingesting history…" : "Ingest history for this instrument"}
            </button>
            <span className="text-[10px] text-muted-foreground">
              Fetches daily bars into the canonical store. The sample is unadjusted and excludes
              delisted names, so it is usable for exploring an idea, never for promoting one.
            </span>
          </div>
        ) : null}

        {ingestResult ? (
          <div
            className={`border px-2 py-1.5 text-[10px] ${
              ingestResult.ready ? "border-gain bg-gain/10 text-gain" : "border-amber bg-amber/10 text-amber"
            }`}
            data-testid="research-stock-ingest-result"
          >
            <span className="uppercase tracking-widest">{ingestResult.code}</span> — {ingestResult.message}
          </div>
        ) : null}

        {envelope ? (
          <div className="border border-panel px-3 py-2 space-y-2" data-testid="research-stock-proposal">
            {restored ? (
              <div className="text-[10px] text-muted-foreground" data-testid="research-stock-restored">
                Restored from the agent-run ledger — researched {restored.slice(0, 16).replace("T", " ")} UTC.
                Run again to research it fresh.
              </div>
            ) : null}
            {isFixture ? (
              <div className="border border-amber bg-amber/10 px-2 py-1 text-[10px] uppercase tracking-widest text-amber" data-testid="research-stock-fixture-banner">
                FIXTURE — NOT INTEGRATION VERIFIED. This is the contract, not research.
              </div>
            ) : verified ? (
              <div className="border border-gain bg-gain/10 px-2 py-1 text-[10px] uppercase tracking-widest text-gain" data-testid="research-stock-verified-banner">
                SOURCE VERIFIED — provider {envelope.researchRun.provider} · {envelope.evidence.verifiedSources.length} of{" "}
                {envelope.evidence.retrievedSources.length} source(s) verified
              </div>
            ) : (
              // A real run that cannot be traced to supplied evidence is labelled exactly as
              // loudly as a fixture was. This is the banner that keeps "a model said it" from
              // reading as "MarketPulse verified it".
              <div className="border border-amber bg-amber/10 px-2 py-1 text-[10px] uppercase tracking-widest text-amber" data-testid="research-stock-unverified-banner">
                {envelope.status.replace(/_/g, " ")} — a real provider ran, but MarketPulse could not
                verify its citations. Not usable as evidence.
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Thesis</span>
              <p className="leading-relaxed" data-testid="research-stock-thesis">{envelope.proposal.thesis}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div><span className="text-muted-foreground">Direction</span> {envelope.proposal.direction}</div>
              <div><span className="text-muted-foreground">Timeframe</span> {envelope.proposal.timeframe}</div>
              <div><span className="text-muted-foreground">Model confidence</span> {(envelope.proposal.confidence * 100).toFixed(0)}% <span className="text-muted-foreground">(never strategy confidence)</span></div>
              <div>
                <span className="text-muted-foreground">Verification</span>{" "}
                <span className={verified ? "text-gain" : "text-amber"} data-testid="research-stock-status">{envelope.status}</span>
              </div>
            </div>
            <div className="text-[10px]">
              <span className="text-muted-foreground">Required features:</span>{" "}
              {envelope.proposal.requiredFeatures.join(", ") || "none"}
            </div>
            {envelope.evidence.rejectedSources.length > 0 ? (
              <div className="text-[10px] text-loss" data-testid="research-stock-rejected">
                Rejected citations (never supplied to this run): {envelope.evidence.rejectedSources.join("; ")}
              </div>
            ) : null}
            {envelope.proposal.missingEvidence.length > 0 ? (
              <div className="text-[10px] text-amber" data-testid="research-stock-missing">
                Missing evidence: {envelope.proposal.missingEvidence.join("; ")}
              </div>
            ) : null}
            <div className="text-[10px] text-muted-foreground">
              Run: {envelope.researchRun.provider} / {envelope.researchRun.model} ·{" "}
              {envelope.evidence.retrievedSources.length} source(s) retrieved · {envelope.evidence.verifiedSources.length} verified ·{" "}
              {envelope.evidence.rejectedSources.length} rejected
              {envelope.researchRun.tokens !== null ? ` · ${envelope.researchRun.tokens} tokens` : ""}
              {envelope.researchRun.cost !== null ? ` · ${symbol}${envelope.researchRun.cost.toFixed(4)}` : ""}
              {" · evidence fp "}
              <span title="sha256 of the exact evidence packet the researcher received — the same prose over different evidence can never read as the same result">
                {envelope.inputEvidenceFingerprint.slice(0, 12)}…
              </span>
            </div>
            <button
              type="button"
              onClick={sendToFactory}
              disabled={!verified || handingOff}
              title={verified ? undefined : "Hand-off activates only for a SOURCE_VERIFIED proposal — unverified content never enters the research ledger."}
              className="border border-panel px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground disabled:opacity-50"
              data-testid="research-stock-handoff"
            >
              {handingOff ? "Sending…" : "Send to Strategy Factory"}
            </button>
            {handoff ? (
              // A refusal is rendered exactly as prominently as an acceptance. NOT_A_RULE and
              // NEEDS_FEATURE are the outcomes most real hypotheses earn, and an owner trained to
              // read them as failures stops submitting research.
              <div
                className={`border px-2 py-1.5 text-[10px] ${
                  handoff.authored ? "border-gain bg-gain/10 text-gain" : "border-amber bg-amber/10 text-amber"
                }`}
                data-testid="research-stock-handoff-result"
              >
                <span className="uppercase tracking-widest">{handoff.verdict}</span> — {handoff.reason}
                {handoff.authored ? (
                  <>
                    {" "}
                    <a className="underline" href="/strategies" data-testid="research-stock-handoff-link">
                      Open {handoff.authored.name} in the Strategy Factory
                    </a>
                  </>
                ) : null}
              </div>
            ) : null}
            {!verified ? (
              <p className="text-[9px] text-muted-foreground">
                Disabled on purpose: a proposal MarketPulse could not source must never become a
                hypothesis. The same button submits a verified proposal to triage.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
