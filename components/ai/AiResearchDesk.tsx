"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Bot, BrainCircuit, CheckCircle2, Clock3, Database, Loader2, ShieldCheck } from "lucide-react";
import { mutationFetch } from "@/lib/client/mutation-fetch";
import { InstrumentCombobox } from "@/components/market/InstrumentCombobox";

type ProviderId = "anthropic" | "openai";

interface ProviderStatus {
  id: ProviderId;
  configured: boolean;
  model: string;
}

interface EvidenceItem {
  id: string;
  label: string;
  quality: string;
  sourceId: string;
}

interface AnalysisResult {
  provider: ProviderId;
  model: string;
  snapshotHash: string;
  instrument: {
    id: string;
    symbol: string;
    name: string;
    exchange: string;
    currency: string;
  };
  generatedAt: string;
  evidence: EvidenceItem[];
  analysis: {
    verdict: "BUY" | "HOLD" | "SELL" | "ABSTAIN";
    confidence: number;
    summary: string;
    bullCase: string[];
    bearCase: string[];
    risks: string[];
    invalidationConditions: string[];
    missingEvidence: string[];
    citations: Array<{ evidenceId: string; claim: string }>;
    disclaimer: string;
  };
}

export function AiResearchDesk({ initialInstrumentId }: { initialInstrumentId: string }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId);
  const [purpose, setPurpose] = useState("DEEP_DIVE");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((response) => response.json())
      .then((data) => setProviders(data.providers ?? []))
      .catch(() => setError({ code: "STATUS_UNAVAILABLE", message: "Provider status could not be loaded." }));
  }, []);

  const selectedProvider = providers.find((item) => item.id === provider);

  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await mutationFetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, instrumentId, purpose, question }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError({ code: data.error ?? "AI_PROVIDER_ERROR", message: data.message ?? "Analysis failed." });
        return;
      }
      setResult(data);
    } catch {
      setError({ code: "NETWORK_ERROR", message: "The AI analysis service is unavailable." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-desk">
      <aside className="terminal-panel ai-control-panel">
        <div className="panel-heading">
          <span>Analysis controls</span>
          <span>READ ONLY</span>
        </div>
        <form onSubmit={analyze} className="p-4 space-y-4">
          <InstrumentCombobox
            id="ai-instrument"
            label="Instrument"
            value={instrumentId}
            onValueChange={setInstrumentId}
            required
            labelClassName="field-label"
            storageKey="marketpulse.ai.instrument.v1"
          />

          <fieldset>
            <legend className="field-label mb-2">Model provider</legend>
            <div className="provider-options">
              {(["anthropic", "openai"] as ProviderId[]).map((id) => {
                const status = providers.find((item) => item.id === id);
                return (
                  <label key={id} className={provider === id ? "provider-option provider-option-active" : "provider-option"}>
                    <input type="radio" name="provider" value={id} checked={provider === id} onChange={() => setProvider(id)} />
                    <span>
                      <strong>{id === "anthropic" ? "Claude" : "OpenAI"}</strong>
                      <small>{status?.model ?? "Checking..."}</small>
                    </span>
                    <span className={status?.configured ? "status-dot status-dot-live" : "status-dot"} />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="field-label">
            Review mode
            <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="terminal-input mt-1">
              <option value="DEEP_DIVE">Deep dive</option>
              <option value="THESIS_CHECK">Challenge thesis</option>
              <option value="RISK_REVIEW">Risk review</option>
            </select>
          </label>

          <label className="field-label" htmlFor="ai-question">Research question</label>
          <textarea
            id="ai-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="Optional: What evidence would invalidate this setup?"
            className="terminal-input resize-y"
          />

          {!selectedProvider?.configured && providers.length > 0 && (
            <div className="inline-notice inline-notice-warning">
              <AlertTriangle className="w-4 h-4" />
              <span>Set the provider key in the server environment, then restart.</span>
            </div>
          )}

          <button type="submit" disabled={busy || !selectedProvider?.configured} className="terminal-action w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
            {busy ? "ASSEMBLING EVIDENCE..." : "RUN EVIDENCE REVIEW"}
          </button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The model receives a bounded snapshot. It cannot browse, create an order, or call a broker.
          </p>
        </form>
      </aside>

      <main className="terminal-panel ai-result-panel" aria-busy={busy}>
        <div className="panel-heading">
          <span>Model opinion</span>
          <span>{result ? `${result.provider.toUpperCase()} / ${result.model}` : "AWAITING RUN"}</span>
        </div>
        <div aria-live="polite" className="ai-result-body">
          {busy && <LoadingState />}
          {!busy && error && <ErrorState error={error} />}
          {!busy && !error && !result && <IdleState />}
          {!busy && result && <AnalysisView result={result} />}
        </div>
      </main>

      <aside className="terminal-panel ai-evidence-panel">
        <div className="panel-heading">
          <span>Evidence ledger</span>
          <span>{result?.evidence.length ?? 0} ITEMS</span>
        </div>
        {!result ? (
          <div className="empty-ledger">
            <Database className="w-6 h-6" />
            <p>Evidence provenance appears after a completed run.</p>
          </div>
        ) : (
          <div className="evidence-list">
            <div className="evidence-meta">
              <span>{result.instrument.exchange}</span>
              <span>{result.instrument.currency}</span>
              <span title={result.snapshotHash}>HASH {result.snapshotHash.slice(0, 10)}</span>
            </div>
            {result.evidence.map((item) => (
              <article key={item.id} className="evidence-row">
                <div className="flex items-center justify-between gap-2">
                  <code>{item.id}</code>
                  <span className={`quality-tag quality-${item.quality.toLowerCase()}`}>{item.quality}</span>
                </div>
                <p>{item.label}</p>
                <small title={item.sourceId}>{item.sourceId}</small>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="analysis-state">
      <Loader2 className="w-8 h-8 animate-spin text-terminal" />
      <h2>Building a bounded evidence packet</h2>
      <p>Normalizing market data, calculating indicators, and validating provider output.</p>
    </div>
  );
}

function IdleState() {
  return (
    <div className="analysis-state">
      <Bot className="w-9 h-9 text-muted-foreground" />
      <h2>No model opinion yet</h2>
      <p>Select a canonical instrument and provider. Deterministic evidence stays separate from model interpretation.</p>
      <div className="capability-strip">
        <span><CheckCircle2 className="w-3.5 h-3.5" /> US / NSE / BSE</span>
        <span><ShieldCheck className="w-3.5 h-3.5" /> No broker tools</span>
        <span><Clock3 className="w-3.5 h-3.5" /> 30s timeout</span>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: { code: string; message: string } }) {
  return (
    <div className="analysis-state analysis-state-error" role="alert">
      <AlertTriangle className="w-8 h-8 text-loss" />
      <h2>{error.code.replaceAll("_", " ")}</h2>
      <p>{error.message}</p>
      {error.code === "AI_PROVIDER_NOT_CONFIGURED" && <Link href="/settings" className="text-terminal underline">Open setup guidance</Link>}
    </div>
  );
}

function AnalysisView({ result }: { result: AnalysisResult }) {
  const analysis = result.analysis;
  return (
    <div className="analysis-report">
      <header className="analysis-report-header">
        <div>
          <p className="terminal-kicker">{result.instrument.id}</p>
          <h2>{result.instrument.name}</h2>
          <p>{analysis.summary}</p>
        </div>
        <div className={`verdict verdict-${analysis.verdict.toLowerCase()}`}>
          <span>{analysis.verdict}</span>
          <strong>{Math.round(analysis.confidence * 100)}%</strong>
          <small>confidence</small>
        </div>
      </header>

      <div className="analysis-columns">
        <AnalysisList title="Bull evidence" items={analysis.bullCase} tone="gain" />
        <AnalysisList title="Bear evidence" items={analysis.bearCase} tone="loss" />
      </div>
      <AnalysisList title="Risks" items={analysis.risks} tone="amber" />
      <AnalysisList title="Invalidation conditions" items={analysis.invalidationConditions} />
      {analysis.missingEvidence.length > 0 && <AnalysisList title="Missing evidence" items={analysis.missingEvidence} tone="amber" />}

      <section>
        <h3 className="report-section-title">Citations</h3>
        <div className="citation-list">
          {analysis.citations.map((citation) => (
            <div key={`${citation.evidenceId}-${citation.claim}`}>
              <code>{citation.evidenceId}</code>
              <p>{citation.claim}</p>
            </div>
          ))}
        </div>
      </section>
      <p className="analysis-disclaimer">{analysis.disclaimer}</p>
    </div>
  );
}

function AnalysisList({ title, items, tone = "neutral" }: { title: string; items: string[]; tone?: "gain" | "loss" | "amber" | "neutral" }) {
  return (
    <section>
      <h3 className="report-section-title">{title}</h3>
      {items.length ? (
        <ul className={`analysis-list analysis-list-${tone}`}>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No evidence supplied.</p>}
    </section>
  );
}
