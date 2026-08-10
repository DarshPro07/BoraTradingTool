import Link from "next/link";
import { AlertTriangle, Ban, Clock, Info, ShieldCheck } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { Panel, StatTile } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import { buildTradeBoard, eligibleMarkets, type TradeBoard } from "@/lib/execution/board";
import { orderTicket } from "@/lib/execution/proposal";
import { fetchMarketSample } from "@/lib/learning/dataset";
import type { Candle } from "@/lib/providers/types";
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
 * The board is derived on every render rather than stored. A proposal is a function of a live
 * signal, a live price and the current risk state, and it expires in twenty minutes — persisting
 * one would mean serving a ticket for a market that has since moved, which is a different trade
 * from the one that was evaluated.
 */

const DECISION_TONE = {
  ALLOW_FOR_CONFIRMATION: "text-gain",
  DEFER: "text-amber",
  BLOCK: "text-loss",
} as const;

/**
 * Bars for exactly the markets that have a strategy able to propose.
 *
 * Nothing is fetched when nothing is eligible, which is the normal state — otherwise every render
 * of an empty page would cost two dozen provider calls.
 */
async function boardDataset(): Promise<Record<string, readonly Candle[]>> {
  const markets = eligibleMarkets();
  if (markets.length === 0) return {};

  const samples = await Promise.all(
    [...new Set(markets.map((market) => (market === "US" ? "US" : "IN")))].map((market) =>
      fetchMarketSample(market, "D"),
    ),
  );
  return Object.assign({}, ...samples) as Record<string, readonly Candle[]>;
}

export default async function ExecutePage() {
  const board: TradeBoard = buildTradeBoard({ dataset: await boardDataset() });
  const { entries, eligible } = board;
  const proposals = entries.map((entry) => entry.proposal);
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
                  ? "No strategy has reached owner review, so none has earned the right to propose. Everything below that rung is measured on data the strategy was selected against. This is an observed zero — the ladder ran and put nothing at the top — not a missing feed."
                  : `${eligible.length} strategy(ies) are eligible and ${board.scanned} strategy × instrument pair(s) were evaluated, but none fired an entry condition on the last bar.`
              }
            />
            {eligible.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px]" data-testid="eligible-strategies">
                {eligible.map((strategy) => (
                  <li key={strategy.specId} className="flex justify-between gap-3 border-b border-panel pb-1">
                    <span>{strategy.name}</span>
                    <span className="text-muted-foreground">
                      {strategy.stage} · {strategy.forwardResolved} forward resolved
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <ul className="space-y-3" data-testid="proposals">
            {entries.map(({ proposal, unavailable }) => (
              <li key={`${proposal.strategyId}-${proposal.instrumentId}`} className="border border-panel bg-panel-alt p-3">
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
                  <div>
                    <span className="text-muted-foreground">Target</span>{" "}
                    {proposal.targetPrice ?? <span className="text-muted-foreground">time/condition exit</span>}
                  </div>
                  <div className="text-loss">
                    <span className="text-muted-foreground">Max loss</span>{" "}
                    {Number.isFinite(proposal.maxLoss) ? `${proposal.maxLoss} ${proposal.currency}` : "UNBOUNDED"}
                  </div>
                </div>

                {/*
                  Blocked rules split in two, because they have opposite remedies. A breach is the
                  gate doing its job on a real limit; an unavailable input is a gap in this
                  install. Listing them together sends the reader hunting for a risk problem that
                  is not there.
                */}
                {proposal.gate.blockedBy.length > 0 ? (
                  <ul className="text-[10px] space-y-1 mb-2" data-testid="blocked-rules">
                    {proposal.gate.blockedBy.map((rule) => (
                      <li key={rule} className="flex items-start gap-1.5">
                        {unavailable[rule] ? (
                          <>
                            <Info className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              <strong>{rule.replace(/_/g, " ")}</strong> — input not available: {unavailable[rule]}
                            </span>
                          </>
                        ) : (
                          <>
                            <Ban className="w-3 h-3 mt-0.5 shrink-0 text-loss" />
                            <span className="text-loss">
                              <strong>{rule.replace(/_/g, " ")}</strong> —{" "}
                              {proposal.gate.checks.find((check) => check.rule === rule)?.detail}
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap border border-panel p-2">
                  {orderTicket(proposal)}
                </pre>
              </li>
            ))}
          </ul>
        )}

        {board.refusals.length > 0 ? (
          <details className="mt-3 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer">
              {board.refusals.length} pair(s) could not be evaluated
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {board.refusals.map((refusal) => (
                <li key={refusal}>· {refusal}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>

      {board.notes.length > 0 ? (
        <Panel title="CONFIGURATION — YOUR DECISION">
          <ul className="space-y-1.5 text-[11px] text-amber" data-testid="board-notes">
            {board.notes.map((note) => (
              <li key={note} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

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
            <li>1. <strong>draft</strong> — a hypothesis becomes a compiled strategy in <Link href="/strategies" className="text-terminal">Studio</Link>.</li>
            <li>2. <strong>rehearsed</strong> — it survives the simulation battery, costing no trial.</li>
            <li>3. <strong>validated</strong> — it passes the gauntlet. A trial is spent and the family&apos;s bar rises permanently.</li>
            <li>4. <strong>holdout_cleared</strong> — it clears the sealed holdout on its one permitted query, ever.</li>
            <li>5. <strong>paper_forward</strong> — it accumulates <strong>forward</strong> observations. Backtest history is not evidence.</li>
            <li>6. <strong>owner_review</strong> — the forward mean is positive beyond its own error. Only now does it propose here.</li>
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
