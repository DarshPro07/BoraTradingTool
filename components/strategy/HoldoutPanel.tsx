import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listSeals } from "@/lib/research-data/holdout-seal";
import { Panel } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";

/**
 * The sealed holdout, made visible: which window is sealed, what state its seal is in, what the
 * ONE next act is, and what every consumed generation concluded (with degradation vs validation
 * — the number memory learns from). The apparatus enforces itself elsewhere; this panel's job is
 * that the owner never has to guess where the sample stands.
 */

const NEXT_ACT: Record<string, string> = {
  SEALED: "Authorize (confirm) to permit its one evaluation — POST /api/strategy/holdout/authorize.",
  AUTHORIZED_FOR_EVALUATION: "Enqueue holdout_decision {specId, confirmed:true} for the chosen validated strategy.",
  CONSUMED: "This generation answered its one question. The next look is a NEW seal (next generation).",
  INVALIDATED: "The sealed bars drifted; this seal proves nothing. Seal a new window.",
};

function day(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function HoldoutPanel() {
  const seals = listSeals();
  const results = getDb()
    .select()
    .from(schema.holdoutResults)
    .orderBy(desc(schema.holdoutResults.evaluatedAt))
    .limit(10)
    .all();

  if (seals.length === 0) {
    return (
      <Panel title="SEALED HOLDOUT">
        <StateBody
          state="empty"
          reason="No holdout window has been sealed. Development currently sees the entire store; seal a window (POST /api/strategy/holdout) BEFORE validating candidates you intend to judge on it."
        />
      </Panel>
    );
  }

  return (
    <Panel title="SEALED HOLDOUT">
      <div className="space-y-2" data-testid="holdout-panel">
        {seals.map((seal) => (
          <div key={seal.id} className="border border-panel p-2 text-xs" data-testid="holdout-seal-row">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="tabular-nums text-muted-foreground">{seal.id}</span>
              <span>
                {seal.market}/{seal.resolution} · gen {seal.generation}
              </span>
              <span
                className={
                  seal.state === "CONSUMED"
                    ? "text-muted-foreground"
                    : seal.state === "INVALIDATED"
                      ? "text-loss"
                      : "text-amber"
                }
                data-testid="holdout-seal-state"
              >
                {seal.state.replace(/_/g, " ")}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              window {day(seal.startTime)} → {day(seal.endTime)} · {seal.barCount} bars · purge{" "}
              {Math.round(seal.purgeGapSeconds / 86_400)}d · embargo {Math.round(seal.embargoSeconds / 86_400)}d ·
              pinned rule: net PF ≥ {seal.decisionRule.minNetProfitFactor} over ≥ {seal.decisionRule.minTrades} trades
            </div>
            <div className="text-[10px] mt-0.5">{NEXT_ACT[seal.state]}</div>
            {seal.stateReason ? (
              <div className="text-[10px] text-muted-foreground mt-0.5">{seal.stateReason}</div>
            ) : null}
          </div>
        ))}

        {results.length > 0 ? (
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Evaluations</div>
            {results.map((row) => (
              <div key={row.id} className="text-[10px] leading-relaxed" data-testid="holdout-result-row">
                <span className={row.passed === 1 ? "text-gain" : "text-loss"}>
                  {row.passed === 1 ? "PASS" : "FAIL"}
                </span>{" "}
                {row.detail}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            No evaluation has spent a look yet. A holdout pass is a licence to gather forward evidence — never a
            profitable-strategy claim.
          </p>
        )}
      </div>
    </Panel>
  );
}
