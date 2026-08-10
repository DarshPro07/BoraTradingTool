"use client";

import { useState } from "react";
import { Panel } from "@/components/system/Panel";
import { TradeChart } from "@/components/strategy/TradeChart";

/**
 * Per-trade inspection: the audit surface for a backtest.
 *
 * Every row answers "why did this trade exist, what happened, where did the money go" — because a
 * wrong entry rule, a mispriced fee and a deadline violation all hide equally well inside an
 * aggregate. Clicking a row opens the evidence: signal-bar values, each entry clause's verdict,
 * MFE/MAE, and a fee decomposition whose arithmetic reconciles on screen.
 */

interface Clause {
  clause: string;
  observed: number | null;
  passed: boolean | null;
}

interface Trade {
  index: number;
  instrumentId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
  grossReturn: number;
  netReturn: number;
  signal: { feature: string; value: number | null }[];
  clauses: Clause[];
  mfe: number | null;
  mae: number | null;
  economics: {
    quantityAssumed: 1;
    notional: number;
    grossPnl: number;
    statutoryFees: number;
    dpCharge: number;
    totalFees: number;
    netPnl: number;
    feeScheduleId: string;
  } | null;
  economicsUnavailable?: string;
}

interface Report {
  ok: boolean;
  servedFrom?: "ledger" | "fresh";
  resolution?: string | null;
  provenance?: {
    datasetSnapshotId: string;
    fingerprint: string | null;
    barCount: number | null;
    instruments: number | null;
    engineVersion: string;
    note: string;
  } | null;
  specName?: string;
  trades?: Trade[];
  execution?: { broker: string; mandatoryExit: string; description: string } | null;
  summary?: string;
  error?: string;
  message?: string;
}

function ist(time: number): string {
  const d = new Date((time + 5.5 * 3600) * 1000);
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function TradeInspector({ specs }: { specs: { id: string; name: string }[] }) {
  const [specId, setSpecId] = useState(specs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [openTrade, setOpenTrade] = useState<number | null>(null);

  async function inspect() {
    setBusy(true);
    setReport(null);
    setOpenTrade(null);
    try {
      const response = await fetch("/api/strategy/trades", {
        method: "POST",
        headers: { "content-type": "application/json", "x-marketpulse-csrf": "1" },
        body: JSON.stringify({ specId }),
      });
      const body = (await response.json()) as Report;
      setReport({ ...body, ok: response.ok });
    } catch (caught) {
      setReport({ ok: false, error: "REQUEST_FAILED", message: caught instanceof Error ? caught.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="TRADE INSPECTION — WHY, WHAT, AND WHERE THE MONEY WENT">
      <div className="p-3 space-y-2" data-testid="trade-inspector">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={specId}
            onChange={(event) => setSpecId(event.target.value)}
            className="bg-background border border-panel px-2 py-1.5 text-xs outline-none focus:border-terminal w-full max-w-[320px] min-w-0 truncate"
            data-testid="inspect-spec"
          >
            {specs.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={inspect}
            disabled={busy || !specId}
            className="border border-terminal text-terminal px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-terminal/10 disabled:opacity-50"
            data-testid="inspect-run"
          >
            {busy ? "Replaying…" : "Inspect trades"}
          </button>
          <span className="text-[10px] text-muted-foreground">
            Spends nothing — no trial, no holdout. A replay over stored bars, decomposed.
          </span>
        </div>

        {report ? (
          !report.ok ? (
            <div className="border border-loss/40 text-loss px-3 py-2 text-[11px]" data-testid="inspect-error">
              <strong>{report.error}</strong> — {report.message}
            </div>
          ) : (
            <div className="space-y-2" data-testid="inspect-result">
              <p className="text-[11px]">{report.summary}</p>
              {report.execution ? (
                <p className="text-[10px] text-muted-foreground" data-testid="inspect-execution">
                  {report.execution.description}
                </p>
              ) : null}
              {report.provenance ? (
                <p className="text-[10px] text-muted-foreground" data-testid="inspect-provenance">
                  {report.servedFrom === "ledger" ? "EVIDENCE (stored ledger)" : "FRESH EXPERIMENT"} · snapshot{" "}
                  {report.provenance.datasetSnapshotId} · {report.provenance.barCount ?? "?"} bars ·{" "}
                  {report.provenance.instruments ?? "?"} instruments · engine {report.provenance.engineVersion} ·{" "}
                  {report.provenance.note}
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th className="pr-2">#</th>
                      <th className="pr-2">Instrument</th>
                      <th className="pr-2">Entry (IST)</th>
                      <th className="pr-2">Exit (IST)</th>
                      <th className="pr-2">Reason</th>
                      <th className="pr-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.trades ?? []).map((trade) => (
                      <tr
                        key={trade.index}
                        onClick={() => setOpenTrade(openTrade === trade.index ? null : trade.index)}
                        className={`cursor-pointer border-t border-panel/60 hover:bg-panel/30 ${trade.netReturn >= 0 ? "" : "text-loss"}`}
                        data-testid={`trade-row-${trade.index}`}
                      >
                        <td className="pr-2 py-1">{trade.index}</td>
                        <td className="pr-2">{trade.instrumentId.split(":").pop()}</td>
                        <td className="pr-2">{ist(trade.entryTime)}</td>
                        <td className="pr-2">{ist(trade.exitTime)}</td>
                        <td className="pr-2">{trade.exitReason}</td>
                        <td className="pr-2 text-right">{(trade.netReturn * 100).toFixed(3)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {openTrade !== null && report.trades ? (
                (() => {
                  const trade = report.trades.find((entry) => entry.index === openTrade)!;
                  return (
                    <div className="border border-panel px-3 py-2 text-[10px] font-mono space-y-2" data-testid="trade-detail">
                      <div className="text-[10px] tracking-widest text-muted-foreground">
                        TRADE #{trade.index} — {trade.instrumentId}
                      </div>
                      <div>
                        <div className="text-muted-foreground">SIGNAL (bar before the fill)</div>
                        {trade.signal.map((entry) => (
                          <div key={entry.feature}>
                            {entry.feature}: {entry.value === null ? "n/a" : entry.value.toFixed(4)}
                          </div>
                        ))}
                      </div>
                      <div data-testid="trade-clauses">
                        <div className="text-muted-foreground">RULE EVALUATION</div>
                        {trade.clauses.map((clause) => (
                          <div key={clause.clause}>
                            {clause.passed === null ? "·" : clause.passed ? "✓" : "✗"} {clause.clause}
                            {clause.observed !== null ? ` (observed ${clause.observed.toFixed(4)})` : ""}
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-muted-foreground">PATH</div>
                        <div>
                          entry {trade.entryPrice.toFixed(2)} → exit {trade.exitPrice.toFixed(2)} ({trade.exitReason})
                        </div>
                        <div>
                          MFE {trade.mfe === null ? "n/a" : `${(trade.mfe * 100).toFixed(3)}%`} · MAE{" "}
                          {trade.mae === null ? "n/a" : `${(trade.mae * 100).toFixed(3)}%`}
                        </div>
                      </div>
                      {report.resolution ? (
                        <TradeChart
                          ticker={trade.instrumentId}
                          resolution={report.resolution}
                          entryTime={trade.entryTime}
                          exitTime={trade.exitTime}
                          entryPrice={trade.entryPrice}
                          exitPrice={trade.exitPrice}
                          exitReason={trade.exitReason}
                        />
                      ) : null}
                      <div data-testid="trade-economics">
                        {trade.economics === null ? (
                          <div className="text-amber">
                            ECONOMICS UNAVAILABLE — {trade.economicsUnavailable ?? "no fee schedule covers this trade's date."}
                          </div>
                        ) : (
                          <>
                            <div className="text-muted-foreground">
                              ECONOMICS (quantity {trade.economics.quantityAssumed} — stated, not sized)
                            </div>
                            <div>gross P&L: {trade.economics.grossPnl.toFixed(2)}</div>
                            <div>statutory fees: {trade.economics.statutoryFees.toFixed(2)}</div>
                            <div>DP charge: {trade.economics.dpCharge.toFixed(2)}</div>
                            <div>total fees: {trade.economics.totalFees.toFixed(2)}</div>
                            <div>net P&L: {trade.economics.netPnl.toFixed(2)}</div>
                            <div className="text-muted-foreground">fee schedule: {trade.economics.feeScheduleId}</div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </Panel>
  );
}
