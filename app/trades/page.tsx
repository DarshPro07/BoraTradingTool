import Link from "next/link";
import { AlertTriangle, Ban, Clock, ShieldCheck } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { Panel, StatTile } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import { buildProposal, orderTicket, type Proposal } from "@/lib/execution/proposal";
import { DEFAULT_RULES } from "@/lib/risk/gate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * EXECUTE — proposals awaiting human confirmation.
 *
 * This page has no button that places an order, and there is no endpoint behind it that could.
 * `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING`; the ticket below is text the owner
 * carries to their broker.
 *
 * A proposal is only generated for a strategy carrying forward evidence. Today none do, so the
 * honest state of this page is empty — and it says which of the two empties it is.
 */

const DECISION_TONE = {
  ALLOW_FOR_CONFIRMATION: "text-gain",
  DEFER: "text-amber",
  BLOCK: "text-loss",
} as const;

/**
 * Strategies that have earned the right to propose: promoted or paper challengers.
 *
 * They do not become proposals here. Turning a strategy into a *priced* ticket needs a live
 * signal — an entry, a stop and a target the strategy actually emitted at a real quote — and
 * that comes from the signal path, not from a page render. Manufacturing an entry price from a
 * last close would be the single most dangerous fabrication this system could make, so this
 * counts eligibility and stops there.
 */
function eligibleStrategies(): { id: string; name: string; status: string; forwardResolved: number }[] {
  const db = getDb();
  const specs = db
    .select()
    .from(schema.strategySpecs)
    .all()
    .filter((row) => row.status === "paper_challenger" || row.status === "promoted");
  if (specs.length === 0) return [];

  const outcomes = db.select().from(schema.forwardOutcomes).all();
  return specs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    status: spec.status,
    forwardResolved: outcomes.filter((row) => row.strategySpecId === spec.id && row.outcome !== "open").length,
  }));
}

export default async function ExecutePage() {
  const eligible = eligibleStrategies();
  const proposals: Proposal[] = [];
  const open = getDb().select().from(schema.paperPositions).all();

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">EXECUTE</h1>
        <span className="text-xs text-muted-foreground">
          Every ticket is placed by you, manually, outside this software.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Awaiting confirmation" value={proposals.filter((p) => p.decision === "ALLOW_FOR_CONFIRMATION").length} />
        <StatTile label="Deferred" value={proposals.filter((p) => p.decision === "DEFER").length} tone="warn" />
        <StatTile label="Blocked" value={proposals.filter((p) => p.decision === "BLOCK").length} tone={proposals.some((p) => p.decision === "BLOCK") ? "bad" : "neutral"} />
        <StatTile label="Open paper positions" value={open.length} />
      </div>

      <div className="inline-notice inline-notice-warning" data-testid="execution-boundary">
        <Ban className="w-4 h-4" />
        <span>
          <strong>No broker adapter exists.</strong> <code>/api/trade/place</code> returns{" "}
          <code>EXECUTION_ADAPTER_MISSING</code>. Nothing on this page can transmit an order, by
          design and by test.
        </span>
      </div>

      <Panel title="PROPOSALS">
        {proposals.length === 0 ? (
          <>
            <StateBody
              state="empty"
              reason={
                eligible.length === 0
                  ? "No strategy has reached paper-challenger status, so none has earned the right to propose. This is an observed zero — the pipeline ran and produced none — not a missing feed."
                  : `${eligible.length} strategy(ies) are eligible, but none has emitted a priced signal. A proposal needs an entry, stop and target the strategy actually produced at a live quote; deriving one from a last close would be fabricating the trade.`
              }
            />
            {eligible.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px]" data-testid="eligible-strategies">
                {eligible.map((strategy) => (
                  <li key={strategy.id} className="flex justify-between gap-3 border-b border-panel pb-1">
                    <span>{strategy.name}</span>
                    <span className="text-muted-foreground">
                      {strategy.status} · {strategy.forwardResolved} forward resolved
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <ul className="space-y-3" data-testid="proposals">
            {proposals.map((proposal) => (
              <li key={`${proposal.instrumentId}-${proposal.createdAt.toISOString()}`} className="border border-panel bg-panel-alt p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <span className="text-sm">
                    {proposal.symbol} · {proposal.side} {proposal.quantity}
                  </span>
                  <span className={`text-[11px] uppercase tracking-wider ${DECISION_TONE[proposal.decision]}`}>
                    {proposal.decision.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] mb-2">
                  <div><span className="text-muted-foreground">Entry</span> {proposal.entryPrice}</div>
                  <div><span className="text-muted-foreground">Stop</span> {proposal.stopPrice}</div>
                  <div><span className="text-muted-foreground">Target</span> {proposal.targetPrice}</div>
                  <div className="text-loss">
                    <span className="text-muted-foreground">Max loss</span>{" "}
                    {Number.isFinite(proposal.maxLoss) ? `${proposal.maxLoss} ${proposal.currency}` : "UNBOUNDED"}
                  </div>
                </div>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap border border-panel p-2">
                  {orderTicket(proposal)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="RISK CEILINGS — OWNER SET">
          <ul className="space-y-1 text-xs" data-testid="risk-ceilings">
            {Object.entries(DEFAULT_RULES).map(([rule, value]) => (
              <li key={rule} className="flex justify-between gap-3 border-b border-panel pb-1">
                <span className="text-muted-foreground">{rule.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                <span>{String(value)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            <ShieldCheck className="w-3 h-3 inline mr-1" />
            The risk kernel is hook-protected and test-enforced. An autonomous actor may propose
            against these ceilings; it cannot change them.
          </p>
        </Panel>

        <Panel title="WHAT REACHES THIS PAGE">
          <ol className="space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <li>1. A hypothesis becomes a compiled strategy in <Link href="/strategies" className="text-terminal">Studio</Link>.</li>
            <li>2. It survives the simulation battery in rehearsal — costing no trial.</li>
            <li>3. It passes the gauntlet, which costs a trial and consumes holdout budget.</li>
            <li>4. It accumulates <strong>forward</strong> paper observations. Backtest history is not evidence.</li>
            <li>5. Only then does it produce a proposal here, with a computed maximum loss.</li>
          </ol>
          <p className="text-[10px] text-amber mt-2 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            A proposal expires. <Clock className="w-3 h-3 inline" /> A stale one describes a market
            that has moved, which is a different trade from the one that was evaluated.
          </p>
        </Panel>
      </div>
    </div>
  );
}
