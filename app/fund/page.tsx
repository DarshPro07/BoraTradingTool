import { Panel, StatTile } from "@/components/system/Panel";
import { fundOsHealth } from "@/lib/fund/health";
import { fundReport, type MandateReport } from "@/lib/fund/report";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(2)}%`);
const tone = (x: number | null) => (x === null ? "neutral" : x >= 0 ? "good" : "bad");

function Gate({ label, pass }: { label: string; pass: boolean }) {
  return (
    <span
      data-testid={`gate-${label}`}
      className={`px-2 py-0.5 rounded text-[10px] font-mono border ${pass ? "text-gain border-gain" : "text-muted-foreground border-border"}`}
    >
      {label} {pass ? "PASS" : "not yet"}
    </span>
  );
}

function MandatePanel({ r }: { r: MandateReport }) {
  const m = r.metrics;
  const unit = r.contract.venue === "NSE" ? "₹" : "$";
  return (
    <Panel
      title={`${r.contract.id} · ${r.contract.title}`}
      action={<span className="text-[10px] font-mono text-muted-foreground">hash {r.hash}{r.suspended ? " · SUSPENDED" : ""}</span>}
    >
      <div data-testid={`mandate-${r.contract.id}`} className="space-y-3">
        <p className="text-xs text-muted-foreground"><b>Declared prior:</b> {r.contract.prior}</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <StatTile label="Sleeve NAV" value={m.navNow === null ? "—" : `${unit}${m.navNow.toFixed(2)}`} />
          <StatTile label="Return" value={pct(m.totalReturn)} tone={tone(m.totalReturn)} hint={`buy-and-hold ${pct(m.benchmarkReturn)}`} />
          <StatTile label="Max drawdown" value={pct(m.maxDrawdown)} hint={`buy-and-hold ${pct(m.benchmarkMaxDrawdown)}`} />
          <StatTile label="Sharpe (ann.)" value={m.annualizedSharpe?.toFixed(2) ?? "—"} />
          <StatTile label="Days live" value={m.daysLive} hint={`${r.decisions.length} decisions`} />
          <StatTile label="Holding" value={Number(r.holding.toFixed(6))} hint={r.contract.asset.symbol} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Gate label="T1" pass={r.gates.T1_OPERATIONAL} />
          <Gate label="T2" pass={r.gates.T2_BEHAVES_AS_DECLARED} />
          <Gate label="T3" pass={r.gates.T3_STATISTICAL} />
          <Gate label="LIVE-ELIGIBLE" pass={r.gates.eligibleToProposeLive} />
        </div>
        {r.gates.reasons.length > 0 && (
          <ul className="text-[11px] text-muted-foreground list-disc pl-4">
            {r.gates.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        <details>
          <summary className="text-xs cursor-pointer">Decisions ({r.decisions.length}) and executions ({r.executions.length})</summary>
          <table className="w-full text-[11px] font-mono mt-2">
            <thead><tr className="text-left text-muted-foreground"><th>date</th><th>kind</th><th>result</th><th>inputs / reason</th></tr></thead>
            <tbody>
              {[
                ...r.decisions.map((d) => ({ at: d.decisionDate, kind: d.bootstrap ? "decision (bootstrap)" : "decision", result: d.hold ? "HOLD" : "OUT", detail: JSON.stringify(d.inputs) })),
                ...r.executions.map((e) => ({ at: e.tradeDate, kind: `execution ${e.side}`, result: e.status, detail: e.reason ?? `fill ${e.fillPrice} · fees ${e.fees}` })),
              ]
                .sort((a, b) => b.at.localeCompare(a.at))
                .map((row, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td>{row.at}</td><td>{row.kind}</td><td>{row.result}</td><td className="break-all">{row.detail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </div>
    </Panel>
  );
}

export default function FundPage() {
  const report = fundReport();
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="terminal-kicker">SIM / AUTONOMOUS FUND</p>
          <h1 className="text-xl font-bold mt-1">Autonomous Paper Fund</h1>
          <p className="text-xs text-muted-foreground mt-2">
            Frozen, published rules on NSE and Solana, run every 15 minutes by the scheduled cycle. Paper only.
            Every decision is recorded before its outcome exists and cannot be edited. Real money needs all three
            trust gates <b>and</b> your approval; the system never switches itself.
          </p>
        </div>
        <span className="mode-badge">PAPER · NO BROKER</span>
      </div>
      <Panel title="System health (watchdog)">
        <ul data-testid="fund-health" className="text-xs font-mono space-y-1">
          {fundOsHealth().map((c) => (
            <li key={c.name} className={c.ok ? "text-gain" : "text-loss"}>
              {c.ok ? "OK  " : "FAIL"} {c.name} — {c.detail}
            </li>
          ))}
        </ul>
      </Panel>
      {report.map((r) => <MandatePanel key={r.contract.id} r={r} />)}
      <p className="text-[11px] text-muted-foreground">
        Not modelled: Indian tax (crypto 30% + 1% TDS; equity STCG/LTCG). Returns shown are before tax. PRD:
        docs/plans/autonomous-fund/02-product.md
      </p>
    </div>
  );
}
