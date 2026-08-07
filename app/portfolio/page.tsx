import Link from "next/link";
import { getPaperPortfolio } from "@/lib/paper/service";
import { getPaperRiskSummary } from "@/lib/paper/risk";
import { fetchQuantResource } from "@/lib/quantcore/client";
import { executionCapabilities } from "@/lib/trading/capabilities";
import { DataState, EmptyState, Panel, Provenance, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export default async function PortfolioRiskPage() {
  const risk = getPaperRiskSummary();
  const portfolio = getPaperPortfolio();
  const forward = await fetchQuantResource("forwardOutcomes");

  const resolved = forward.ok ? forward.data.observations.filter((o) => o.outcome !== "open") : [];
  const wins = resolved.filter((o) => o.outcome === "win").length;
  const losses = resolved.filter((o) => o.outcome === "loss").length;

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">PORTFOLIO &amp; RISK</h1>
        <span className="text-xs text-amber">{executionCapabilities.reason}</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open positions" value={risk.openPositions} />
        <StatTile
          label="Forward resolved"
          value={resolved.length}
          hint={forward.ok ? `${forward.data.pending} still open` : "quant core unavailable"}
        />
        <StatTile
          label="Forward W/L"
          value={resolved.length === 0 ? "—" : `${wins}/${losses}`}
          hint="unbiased evidence only"
          tone={resolved.length === 0 ? "warn" : wins > losses ? "good" : "bad"}
        />
        <StatTile label="Broker" value="NONE" hint="no adapter installed" tone="good" />
      </div>

      <Panel title="PAPER ACCOUNTS">
        {risk.accounts.length === 0 ? (
          <EmptyState>No paper accounts initialised.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">Currency</th>
                  <th className="pb-1">Cash</th>
                  <th className="pb-1">Starting</th>
                  <th className="pb-1">Cost exposure</th>
                  <th className="pb-1">Capital used</th>
                </tr>
              </thead>
              <tbody>
                {risk.accounts.map((account) => (
                  <tr key={account.currency} className="border-t border-panel">
                    <td className="py-1.5">{account.currency}</td>
                    <td className="py-1.5">{money(account.cash, account.currency)}</td>
                    <td className="py-1.5 text-muted-foreground">{money(account.startingCash, account.currency)}</td>
                    <td className="py-1.5">{money(account.costExposure, account.currency)}</td>
                    <td
                      className={`py-1.5 ${account.capitalUtilizationPct > 60 ? "text-amber" : ""}`}
                    >
                      {account.capitalUtilizationPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="POSITIONS"
          action={<Link href="/paper" className="text-[10px] text-muted-foreground hover:text-foreground">PAPER DESK →</Link>}
        >
          {portfolio.positions.length === 0 ? (
            <EmptyState>No open paper positions.</EmptyState>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">Instrument</th>
                  <th className="pb-1">Quantity</th>
                  <th className="pb-1">Avg cost</th>
                  <th className="pb-1">Realised</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((position) => (
                  <tr key={position.instrumentId} className="border-t border-panel">
                    <td className="py-1.5">{position.instrumentId}</td>
                    <td className="py-1.5">{position.quantity}</td>
                    <td className="py-1.5">{position.averageCost.toFixed(2)}</td>
                    <td className={`py-1.5 ${position.realizedPnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {position.realizedPnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="FORWARD OUTCOMES">
          {forward.ok ? (
            forward.data.observations.length === 0 ? (
              <EmptyState>The quant core has recorded no forward observations.</EmptyState>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                  These are the only unbiased results in the system. {resolved.length} of{" "}
                  {forward.data.observations.length} have resolved — treat conclusions as provisional until the
                  sample is large enough to distinguish skill from luck.
                </p>
                <ul className="space-y-1 text-xs max-h-80 overflow-auto">
                  {forward.data.observations.slice(0, 40).map((observation) => (
                    <li key={observation.id} className="flex justify-between gap-2 border-b border-panel pb-1">
                      <span className="truncate">{observation.symbol}</span>
                      <span className="text-muted-foreground text-[10px]">{observation.strategy ?? "—"}</span>
                      <span
                        className={
                          observation.outcome === "win"
                            ? "text-gain"
                            : observation.outcome === "loss"
                              ? "text-loss"
                              : "text-muted-foreground"
                        }
                      >
                        {observation.outcome}
                      </span>
                    </li>
                  ))}
                </ul>
                <Provenance
                  source={forward.source}
                  generatedAt={forward.generatedAt}
                  transport={forward.transport}
                  stale={forward.stale}
                />
              </>
            )
          ) : (
            <DataState code={forward.code} message={forward.message} source={forward.source} />
          )}
        </Panel>
      </div>
    </div>
  );
}
