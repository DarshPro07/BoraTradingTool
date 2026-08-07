import { getDb, schema } from "@/lib/db";
import { Panel } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import { lossLedger, reconciles, riskPosture, PATTERN_THRESHOLD } from "@/lib/paper/loss-memory";
import { EquityCurve } from "@/components/plot/EquityCurve";
import { cumulative } from "@/lib/ui/plot";

/**
 * What was lost, why, and what changed as a result.
 *
 * The requirement this answers is the owner's: losing money must not merely be recorded, it must
 * *do* something. The posture panel below shows the ceiling the system is operating under now
 * and the reason it moved — an adaptation nobody can see is indistinguishable from none.
 */

const BASE_POSITION_PCT = 5;
const BASE_DAILY_STOP_PCT = 2;

function money(value: number, currency: string | null): string {
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  const sign = value < 0 ? "-" : "";
  return `${sign}${symbol}${Math.abs(value).toFixed(2)}`;
}

export function LossLedgerPanel() {
  const ledger = lossLedger();
  const accounts = getDb().select().from(schema.paperAccounts).all();
  const starting = accounts.find((account) => account.currency === ledger.currency) ?? accounts[0];
  const posture = riskPosture(
    ledger,
    starting?.startingCash ?? 0,
    BASE_POSITION_PCT,
    BASE_DAILY_STOP_PCT,
  );
  const agreement = reconciles();

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Panel title="LOSS LEDGER">
        {ledger.trades.length === 0 ? (
          <StateBody
            state="empty"
            reason="No position has been closed yet, so there is nothing realised to attribute. An open position that is down is not a loss until it is closed — unrealised movement is not recorded here."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
              <div className="border border-panel bg-panel-alt px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Closed</div>
                <div>{ledger.trades.length}</div>
              </div>
              <div className="border border-panel bg-panel-alt px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Net realised</div>
                <div className={ledger.netRealised < 0 ? "text-loss" : "text-gain"}>
                  {money(ledger.netRealised, ledger.currency)}
                </div>
              </div>
              <div className="border border-panel bg-panel-alt px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Today</div>
                <div className={ledger.realisedToday < 0 ? "text-loss" : ""}>
                  {money(ledger.realisedToday, ledger.currency)}
                </div>
              </div>
              <div className="border border-panel bg-panel-alt px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Worst</div>
                <div className="text-loss">
                  {ledger.worst ? money(ledger.worst.realised, ledger.currency) : "—"}
                </div>
              </div>
            </div>

            {/* Realised equity, not marked-to-market: this curve moves only when a position is
                closed, which is the same rule the loss ledger and the risk posture use. */}
            <div className="mb-3">
              <EquityCurve
                equity={cumulative(
                  ledger.trades.map((trade) => trade.realised),
                  starting?.startingCash ?? 0,
                )}
                currency={ledger.currency ?? ""}
              />
            </div>

            {ledger.byCause.length === 0 ? (
              <p className="text-xs text-muted-foreground">Every closed trade was profitable.</p>
            ) : (
              <ul className="space-y-1 text-xs" data-testid="loss-causes">
                {ledger.byCause.map((entry) => (
                  <li key={entry.cause} className="flex flex-wrap items-baseline gap-2 border-b border-panel pb-1">
                    <span className="text-loss w-20 shrink-0 tabular-nums">
                      {money(entry.total, ledger.currency)}
                    </span>
                    <span className="flex-1 min-w-[140px]">{entry.cause.replace(/_/g, " ")}</span>
                    <span className="text-[10px] text-muted-foreground">×{entry.count}</span>
                    {entry.isPattern ? (
                      <span className="text-[10px] text-amber" title={`Seen ${PATTERN_THRESHOLD}+ times`}>
                        PATTERN
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {!agreement.ok ? (
              <p className="text-[10px] text-loss mt-2" data-testid="ledger-drift">
                This ledger disagrees with the stored position rows by{" "}
                {Object.entries(agreement.drift)
                  .map(([id, value]) => `${id}: ${value.toFixed(2)}`)
                  .join(", ")}
                . Two views of the same money have diverged — trust neither until it is resolved.
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel title="RISK POSTURE">
        <div className="space-y-2 text-xs" data-testid="risk-posture">
          <div className="flex justify-between gap-3 border-b border-panel pb-1">
            <span className="text-muted-foreground">Max position</span>
            <span>
              {posture.tightened ? (
                <>
                  <span className="text-muted-foreground line-through mr-1">{posture.basePositionPct}%</span>
                  <span className="text-amber">{posture.positionPct}%</span>
                </>
              ) : (
                <span>{posture.positionPct}%</span>
              )}
            </span>
          </div>
          <div className="flex justify-between gap-3 border-b border-panel pb-1">
            <span className="text-muted-foreground">Daily stop</span>
            <span>
              {posture.tightened ? (
                <>
                  <span className="text-muted-foreground line-through mr-1">{posture.baseDailyStopPct}%</span>
                  <span className="text-amber">{posture.dailyStopPct}%</span>
                </>
              ) : (
                <span>{posture.dailyStopPct}%</span>
              )}
            </span>
          </div>
          <div className="flex justify-between gap-3 border-b border-panel pb-1">
            <span className="text-muted-foreground">Realised drawdown</span>
            <span className={posture.drawdown > 0 ? "text-loss" : ""}>
              {(posture.drawdown * 100).toFixed(2)}%
            </span>
          </div>
        </div>

        {posture.reasons.length > 0 ? (
          <ul className="mt-2 space-y-1" data-testid="posture-reasons">
            {posture.reasons.map((reason) => (
              <li key={reason} className="text-[10px] text-amber leading-relaxed">
                → {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Operating at the owner&apos;s ceilings. Adaptation can only tighten these, never widen
            them — a system that can raise its own limits after a bad run can trade its way out of
            a drawdown.
          </p>
        )}
      </Panel>
    </div>
  );
}
