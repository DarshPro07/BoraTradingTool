"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/system/Panel";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * The quant surface (Q1b): metrics that explain themselves.
 *
 * Every number renders WITH its estimator, its sample, the versioned policy it was computed
 * under, and the pinned assumption records it stands on. An unavailable metric shows its reason —
 * never a zero. This panel is how the UI reinforces the research discipline instead of hiding it.
 */

interface IndicatorRow {
  id: string;
  version: string;
  warmup: number;
  applicability: string;
  requiresContext: string[];
  conventions: Record<string, string>;
}

interface AnalyticsResponse {
  specName: string;
  experimentId: string;
  datasetSnapshotId: string;
  engineVersion: string;
  tradeCount: number;
  periodsPerYear: number | null;
  analytics: {
    observations: number;
    sharpeAnnualizedNaive: number | null;
    sharpeAnnualizedSerialAdjusted: number | null;
    serialAdjustment: { estimator: string; estimatorVersion: string; lagsUsed: number } | null;
    sortino: number | null;
    maxDrawdown: number | null;
    var95Historical: number | null;
    var95Normal: number | null;
    expectedShortfall95: number | null;
    winRate: number | null;
    expectancy: number | null;
    unavailable: Record<string, string>;
    riskPolicy: { policyVersion: string; minTailObservations: number; confidenceLevel: number; tailMethod: string };
    assumptions: { id: string; version: string; hash: string }[];
  };
  error?: string;
  message?: string;
}

function metric(value: number | null, digits = 3): string {
  return value === null ? "unavailable" : value.toFixed(digits);
}

export function QuantAnalyticsPanel({ specs }: { specs: { id: string; name: string }[] }) {
  const [indicators, setIndicators] = useState<IndicatorRow[] | null>(null);
  const [specId, setSpecId] = useState(specs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<AnalyticsResponse | null>(null);

  const loadRegistry = useCallback(() => {
    fetch("/api/quant")
      .then(async (response) => {
        const body = (await response.json()) as { indicators?: IndicatorRow[] };
        setIndicators(body.indicators ?? []);
      })
      .catch(() => setIndicators([]));
  }, []);
  useEffect(loadRegistry, [loadRegistry]);

  async function run() {
    setBusy(true);
    setReport(null);
    try {
      const response = await mutationFetch("/api/quant/analytics", {
        method: "POST",
        body: JSON.stringify({ specId }),
      });
      setReport((await response.json()) as AnalyticsResponse);
    } catch (caught) {
      setReport({ error: "REQUEST_FAILED", message: caught instanceof Error ? caught.message : "Request failed." } as AnalyticsResponse);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="QUANT ANALYTICS — METRICS THAT EXPLAIN THEMSELVES">
      <div className="p-3 space-y-3 text-[11px]" data-testid="quant-panel">
        <div data-testid="quant-indicators">
          <div className="text-[10px] tracking-widest text-muted-foreground mb-1">
            INDICATOR REGISTRY — one formula, one version, warmup is null never zero
          </div>
          {indicators === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <ul className="space-y-0.5">
              {indicators.map((row) => (
                <li key={row.id} className="text-[10px] text-muted-foreground" data-testid="quant-indicator-row">
                  <span className="text-foreground font-bold">{row.id}</span> v{row.version} · warmup {row.warmup} ·{" "}
                  {row.applicability}
                  {row.requiresContext.length > 0 ? ` · requires ${row.requiresContext.join(", ")}` : ""}
                  {Object.entries(row.conventions)
                    .map(([key, value]) => ` · ${key}: ${value.split(".")[0]}`)
                    .join("")}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={specId}
            onChange={(event) => setSpecId(event.target.value)}
            className="bg-background border border-panel px-2 py-1.5 text-xs outline-none focus:border-terminal max-w-[320px] min-w-0 truncate"
            data-testid="quant-spec"
          >
            {specs.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !specId}
            onClick={run}
            className="border border-terminal text-terminal px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-terminal/10 disabled:opacity-50"
            data-testid="quant-run"
          >
            Analyze recorded experiment
          </button>
        </div>

        {report ? (
          report.error ? (
            <div className="border border-loss/40 text-loss px-3 py-2 text-[11px]" data-testid="quant-error">
              <strong>{report.error}</strong> — {report.message}
            </div>
          ) : (
            <div className="space-y-2" data-testid="quant-metrics">
              <p className="text-[10px] text-muted-foreground">
                {report.specName} · experiment {report.experimentId} · dataset {report.datasetSnapshotId} · engine{" "}
                {report.engineVersion} · {report.tradeCount} trade(s) ·{" "}
                {report.periodsPerYear === null ? "annualization unavailable (resolution unmapped)" : `${report.periodsPerYear} periods/yr`}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 font-mono text-[10px]">
                <div className="border border-panel/60 px-2 py-1.5" data-testid="quant-sharpe">
                  <div className="text-muted-foreground">SHARPE (annualized)</div>
                  <div>naive √t: {metric(report.analytics.sharpeAnnualizedNaive, 2)}</div>
                  <div>
                    serial-adjusted: {metric(report.analytics.sharpeAnnualizedSerialAdjusted, 2)}
                    {report.analytics.serialAdjustment
                      ? ` (${report.analytics.serialAdjustment.estimator} v${report.analytics.serialAdjustment.estimatorVersion}, ${report.analytics.serialAdjustment.lagsUsed} lags)`
                      : ""}
                  </div>
                </div>
                <div className="border border-panel/60 px-2 py-1.5" data-testid="quant-tails">
                  <div className="text-muted-foreground">
                    TAILS ({report.analytics.riskPolicy.policyVersion} · {report.analytics.riskPolicy.tailMethod})
                  </div>
                  <div>VaR95 historical: {metric(report.analytics.var95Historical, 4)}</div>
                  <div>VaR95 normal (labelled baseline): {metric(report.analytics.var95Normal, 4)}</div>
                  <div>ES95: {metric(report.analytics.expectedShortfall95, 4)}</div>
                </div>
                <div className="border border-panel/60 px-2 py-1.5">
                  <div className="text-muted-foreground">PATH</div>
                  <div>max drawdown: {metric(report.analytics.maxDrawdown, 4)}</div>
                  <div>sortino: {metric(report.analytics.sortino, 3)}</div>
                  <div>win rate: {metric(report.analytics.winRate, 2)}</div>
                  <div>expectancy: {metric(report.analytics.expectancy, 5)}</div>
                </div>
              </div>
              {Object.keys(report.analytics.unavailable).length > 0 ? (
                <div className="text-[10px] text-amber" data-testid="quant-unavailable">
                  {Object.entries(report.analytics.unavailable).map(([key, reason]) => (
                    <div key={key}>
                      {key}: {reason}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="text-[9px] text-muted-foreground" data-testid="quant-assumptions">
                ASSUMPTIONS PINNED:{" "}
                {report.analytics.assumptions.map((entry) => `${entry.id}@${entry.version}#${entry.hash}`).join(" · ")}
              </div>
            </div>
          )
        ) : null}
      </div>
    </Panel>
  );
}
