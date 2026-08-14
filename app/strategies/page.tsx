import { strategyLab } from "@/lib/dashboard/queries";
import { GATES } from "@/lib/strategy/gauntlet";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";
import { GuidedStrategyFlow } from "@/components/factory/GuidedStrategyFlow";
import { FeatureSupportPanel } from "@/components/strategy/FeatureSupportPanel";
import { GraveyardPanel } from "@/components/strategy/GraveyardPanel";
import { standings } from "@/lib/strategy/promotion";
import { RunGauntletButton } from "@/components/strategy/RunGauntletButton";
import { StrategyAuthor } from "@/components/strategy/StrategyAuthor";
import { TradeInspector } from "@/components/strategy/TradeInspector";
import { RehearsalLedger } from "@/components/strategy/RehearsalLedger";
import { QuantAnalyticsPanel } from "@/components/quant/QuantAnalyticsPanel";
import { HypothesisInbox } from "@/components/research/HypothesisInbox";
import { StarMap } from "@/components/strategy/StarMap";
import { ValidationFunnel } from "@/components/strategy/ValidationFunnel";
import { HoldoutPanel } from "@/components/strategy/HoldoutPanel";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  paper_challenger: "text-gain",
  rejected: "text-loss",
  retired: "text-muted-foreground",
  validating: "text-amber",
  draft: "text-muted-foreground",
  compiled: "text-amber",
};

function metric(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export default async function StrategyLabPage() {
  const strategies = strategyLab();
  // Computed once and indexed, not re-derived per cell — each standing reads the trial ledger and
  // the forward record, and calling it four times per row would make the page O(rows × reads).
  // The SAME array feeds the funnel, so the counters and the per-row stages cannot disagree.
  const all = standings();
  const byId = new Map(all.map((standing) => [standing.specId, standing]));
  const stageOf = (specId: string) => byId.get(specId);
  const challengers = strategies.filter((strategy) => strategy.status === "paper_challenger");
  const rejected = strategies.filter((strategy) => strategy.status === "rejected");

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">STRATEGY LAB</h1>
        <span className="text-xs text-muted-foreground">
          A strategy is evidence only after it survives the gauntlet at the trial count it actually used.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Strategies" value={strategies.length} />
        <StatTile label="Paper challengers" value={challengers.length} tone={challengers.length > 0 ? "good" : "neutral"} />
        <StatTile label="Rejected" value={rejected.length} hint="kept on record" />
        <StatTile
          label="Total trials"
          value={strategies.reduce((total, strategy) => total + strategy.trials, 0)}
          hint="the multiple-testing denominator"
        />
      </div>

      {/* P3: the one guided flow — idea → interpretation → backtest → validate → forward. The
          composer lives inside it (same testids, same engine); the DSL editor below stays as the
          power path, which cannot mint research identity and says so. */}
      <GuidedStrategyFlow />

      <Panel title="AUTHOR A STRATEGY — DSL POWER PATH">
        <StrategyAuthor />
      </Panel>

      {/* Item 15: every recorded hypothesis, including the held ones — a refusal with a stated
          reason is work in the queue, not work lost. */}
      <Panel title="HYPOTHESIS INBOX">
        <HypothesisInbox />
      </Panel>

      {/* The audit surface: per-trade why/what/where-the-money-went for any stored strategy.
          A replay, not a trial - it spends nothing and may run freely. */}
      <Panel title="INSPECT">
        <TradeInspector specs={strategies.map((strategy) => ({ id: strategy.id, name: strategy.name }))} />
      </Panel>

      {/* 13b: rehearsal verdicts with the dataset snapshot each was judged on. */}
      <RehearsalLedger />

      {/* Q1b: metrics that explain themselves — estimator, policy, assumptions, honest nulls. */}
      <QuantAnalyticsPanel specs={strategies.map((strategy) => ({ id: strategy.id, name: strategy.name }))} />

      <FeatureSupportPanel />

      <StarMap />

      <div className="grid gap-4 lg:grid-cols-2">
        <ValidationFunnel standings={all} />
        <HoldoutPanel />
        <GraveyardPanel />
        <Panel title="GATES">
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div><span className="text-muted-foreground">OOS PF ≥</span> {GATES.minOutOfSampleProfitFactor}</div>
            <div><span className="text-muted-foreground">PBO ≤</span> {GATES.maxPbo}</div>
            <div><span className="text-muted-foreground">DSR ≥</span> {GATES.minDeflatedSharpe}</div>
            <div><span className="text-muted-foreground">2× cost PF ≥</span> {GATES.minCostStressProfitFactor}</div>
            <div><span className="text-muted-foreground">Min trades</span> {GATES.minTradesForEvidence}</div>
            <div><span className="text-muted-foreground">P(loss) ≤</span> {GATES.maxProbabilityOfLoss}</div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Running the gauntlet consumes holdout budget and permanently raises this strategy&apos;s
            bar. The rehearsal in the autonomous cycle answers &ldquo;is it worth a trial?&rdquo;
            without spending one.
          </p>
        </Panel>
      </div>

      <Panel title="REGISTRY">
        {strategies.length === 0 ? (
          <EmptyState>
            No strategy specifications yet. Compile one from a hypothesis to enter it into the trial ledger.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">Strategy</th>
                  <th className="pb-1">Status</th>
                  <th className="pb-1">Trials</th>
                  <th className="pb-1">OOS PF</th>
                  <th className="pb-1">DSR</th>
                  <th className="pb-1">PBO</th>
                  <th className="pb-1">2× cost PF</th>
                  <th className="pb-1">Lineage</th>
                  <th className="pb-1">Stage</th>
                  <th className="pb-1">Validate</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => (
                  <tr key={strategy.id} className="border-t border-panel">
                    <td className="py-1.5">
                      {strategy.name} <span className="text-muted-foreground">v{strategy.version}</span>
                    </td>
                    <td className={`py-1.5 ${STATUS_TONE[strategy.status] ?? ""}`}>
                      {strategy.status.replace(/_/g, " ")}
                    </td>
                    <td className="py-1.5">
                      {strategy.trials}
                      {strategy.failedTrials > 0 ? (
                        <span className="text-loss"> ({strategy.failedTrials} failed)</span>
                      ) : null}
                    </td>
                    <td className="py-1.5">{metric(strategy.validation?.oosProfitFactor ?? null)}</td>
                    <td
                      className={`py-1.5 ${
                        (strategy.validation?.deflatedSharpe ?? 0) >= GATES.minDeflatedSharpe ? "text-gain" : "text-loss"
                      }`}
                    >
                      {metric(strategy.validation?.deflatedSharpe ?? null, 3)}
                    </td>
                    <td className="py-1.5">{metric(strategy.validation?.pbo ?? null, 2)}</td>
                    <td className="py-1.5">{metric(strategy.validation?.costMultiplePf ?? null)}</td>
                    <td className="py-1.5 text-muted-foreground">{strategy.parentId ? "child" : "root"}</td>
                    <td className="py-1.5 align-top">
                      {/* The rung *and* what it is waiting for. A stage on its own reads as a
                          label; the reason is what tells the owner whether the next move is
                          theirs or the system's. */}
                      <span className={stageOf(strategy.id)?.stage === "graveyard" ? "text-loss" : "text-amber"}>
                        {(stageOf(strategy.id)?.stage ?? "unknown").replace(/_/g, " ")}
                      </span>
                      {/* The typed wait — `blockedOn` was computed every cycle and rendered
                          nowhere, which is how twenty strategies sat stalled with the reason
                          existing only in memory. */}
                      {stageOf(strategy.id)?.blockedOn ? (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground" data-testid="stage-blocked-on">
                          waiting on {stageOf(strategy.id)!.blockedOn!.replace(/_/g, " ")}
                        </span>
                      ) : null}
                      <div className="text-[10px] text-muted-foreground max-w-[26rem] leading-relaxed mt-0.5">
                        {stageOf(strategy.id)?.advance.because}
                      </div>
                    </td>
                    <td className="py-1.5 align-top">
                      {/* Offered on every strategy, including ones already validated: re-running is
                          a legitimate act that costs another trial, and hiding the button would
                          make the ledger look cheaper than it is. */}
                      <RunGauntletButton specId={strategy.id} name={strategy.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
