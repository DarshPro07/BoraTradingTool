import { strategyLab } from "@/lib/dashboard/queries";
import { GATES } from "@/lib/strategy/gauntlet";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";
import { FeatureSupportPanel } from "@/components/strategy/FeatureSupportPanel";
import { GraveyardPanel } from "@/components/strategy/GraveyardPanel";
import { RunGauntletButton } from "@/components/strategy/RunGauntletButton";
import { StrategyAuthor } from "@/components/strategy/StrategyAuthor";
import { StarMap } from "@/components/strategy/StarMap";
import { ValidationFunnel } from "@/components/strategy/ValidationFunnel";

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

      <Panel title="AUTHOR A STRATEGY">
        <StrategyAuthor />
      </Panel>

      <FeatureSupportPanel />

      <StarMap />

      <div className="grid gap-4 lg:grid-cols-2">
        <ValidationFunnel />
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
                    <td className="py-1.5">
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
