"use client";

import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { Distribution } from "@/components/plot/Distribution";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * Simulation Lab — investment mode made visible.
 *
 * The series below are clearly-labelled worked examples, not market data. They exist so the
 * battery's behaviour can be seen and tested directly: one has a real edge, one is symmetric
 * noise, one hides its whole record inside a single lucky stretch. A lab where you cannot see
 * the tool reject something is a lab that has never demonstrated it works.
 */

type Verdict = "pass" | "fail" | "inconclusive";

interface SimulationResult {
  kind: string;
  verdict: Verdict;
  reason: string;
  metrics: Record<string, number>;
}

interface BatteryReport {
  label: string | null;
  results: SimulationResult[];
  verdict: Verdict;
  summary: string;
  trades: number;
}

const FIXTURES: Array<{ id: string; label: string; note: string; returns: number[] }> = [
  {
    id: "edge",
    label: "Steady edge",
    note: "Four wins to one loss, spread evenly. Should survive every simulation.",
    returns: Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? -0.01 : 0.014)),
  },
  {
    id: "noise",
    label: "Symmetric noise",
    note: "Alternating equal wins and losses. No edge exists; nothing should pass.",
    returns: Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01)),
  },
  {
    id: "lucky",
    label: "One lucky stretch",
    note: "Flat for most of the record, then a burst carries everything. Walk-forward should catch it.",
    returns: Array.from({ length: 60 }, (_, i) => (i >= 48 ? 0.05 : -0.001)),
  },
  {
    id: "thin",
    label: "Edge thinner than costs",
    note: "Profitable on paper until costs are charged twice. Cost stress should catch it.",
    returns: Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.0022 : -0.0012)),
  },
];

const VERDICT_STYLE: Record<Verdict, { className: string; Icon: typeof CheckCircle2 }> = {
  pass: { className: "text-gain", Icon: CheckCircle2 },
  fail: { className: "text-loss", Icon: AlertTriangle },
  inconclusive: { className: "text-amber", Icon: HelpCircle },
};

export default function SimulationsPage() {
  const [report, setReport] = useState<BatteryReport | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fixture: (typeof FIXTURES)[number]) {
    setRunning(fixture.id);
    setError(null);
    try {
      // `mutationFetch`, not `fetch`: the endpoint now requires the CSRF header, and this is the
      // third call site to have hand-rolled the request and omitted it. The helper exists so the
      // header cannot be forgotten — reaching past it is how the guard gets discovered in
      // production instead of here.
      const response = await mutationFetch("/api/simulation", {
        method: "POST",
        body: JSON.stringify({
          returns: fixture.returns,
          label: fixture.label,
          modelledRoundTripCost: fixture.id === "thin" ? 0.002 : 0.001,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "The simulation request was refused.");
        setReport(null);
        return;
      }
      setReport(data as BatteryReport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The simulation could not be reached.");
      setReport(null);
    } finally {
      setRunning(null);
    }
  }

  const style = report ? VERDICT_STYLE[report.verdict] : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-screen-2xl mx-auto px-4 py-5 space-y-4">
        <section className="market-hero rise-1">
          <div>
            <p className="terminal-kicker">INVESTMENT MODE / SIMULATION BATTERY</p>
            <h1>Simulation Lab</h1>
            <p>
              Five independent attacks on one return series. They can disagree, and the disagreement is
              the point.
            </p>
          </div>
        </section>

        <div className="inline-notice inline-notice-warning" data-testid="synthetic-warning">
          <AlertTriangle className="w-4 h-4" />
          SYNTHETIC — these are worked examples with known properties, not market data. No result here
          says anything about a real instrument.
        </div>

        <section className="terminal-panel p-4 rise-2">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-terminal" />
            <h2 className="text-xs font-bold uppercase tracking-wider">Series</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {FIXTURES.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                onClick={() => run(fixture)}
                disabled={running !== null}
                data-testid={`run-${fixture.id}`}
                className="stat-tile border border-panel bg-panel-alt px-3 py-3 text-left hover:border-terminal disabled:opacity-50 transition-colors"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {fixture.returns.length} trades
                </div>
                <div className="text-sm leading-tight mb-1">{fixture.label}</div>
                <div className="text-[10px] text-muted-foreground leading-relaxed">{fixture.note}</div>
                <div className="text-[10px] text-terminal mt-2">
                  {running === fixture.id ? "RUNNING…" : "RUN BATTERY →"}
                </div>
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <div className="inline-notice inline-notice-warning" data-testid="simulation-error">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        ) : null}

        {report && style ? (
          <section className="terminal-panel p-4 rise-3" data-testid="battery-report">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <style.Icon className={`w-4 h-4 ${style.className}`} />
                <h2 className="text-xs font-bold uppercase tracking-wider">
                  {report.label} — <span data-testid="battery-verdict">{report.verdict}</span>
                </h2>
              </div>
              <span className="text-[11px] text-muted-foreground">{report.trades} TRADES</span>
            </div>

            <p className="text-xs text-muted-foreground mb-3 leading-relaxed" data-testid="battery-summary">
              {report.summary}
            </p>

            {/* The shape being tested, not only the verdict on it. Two candidates can share a
                verdict and look nothing alike — one marginal, one hopeless — and the number
                alone hides which. Break-even is marked because that is the line the sample is
                really being asked about. */}
            <div className="mb-3 border border-panel bg-panel-alt px-3 py-2" data-testid="return-distribution">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Trade returns under test
              </div>
              <Distribution
                values={FIXTURES.find((fixture) => fixture.label === report.label)?.returns ?? []}
                reference={0}
                referenceLabel="break-even"
                label="Trade returns"
                width={300}
                height={54}
              />
            </div>

            <div className="space-y-2" data-testid="simulation-results">
              {report.results.map((result) => {
                const resultStyle = VERDICT_STYLE[result.verdict];
                return (
                  <div
                    key={result.kind}
                    className="border border-panel bg-panel-alt px-3 py-2"
                    data-testid={`result-${result.kind}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] uppercase tracking-wider">
                        {result.kind.replace(/_/g, " ")}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider ${resultStyle.className}`}>
                        {result.verdict}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{result.reason}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      {Object.entries(result.metrics).map(([key, value]) => (
                        <span key={key}>
                          {key}: {typeof value === "number" ? value.toFixed(4) : String(value)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
