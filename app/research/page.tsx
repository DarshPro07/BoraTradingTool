import Link from "next/link";
import { researchFunnel, strategyLab, experimentLedger } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

function FunnelStage({
  label,
  value,
  detail,
  href,
  survivors,
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  survivors: number | null;
}) {
  const rate = survivors !== null && value > 0 ? Math.round((survivors / value) * 100) : null;
  return (
    <Link href={href} className="stat-tile block border border-panel bg-panel-alt px-3 py-3 hover:border-[var(--amber)]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl leading-tight mt-0.5">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{detail}</div>
      {rate !== null ? (
        <div className="mt-2 h-1 bg-[rgba(255,255,255,0.06)]">
          <div className="h-1 bg-[var(--amber)]" style={{ width: `${Math.min(100, rate)}%` }} />
        </div>
      ) : null}
    </Link>
  );
}

export default async function ResearchOverviewPage() {
  const funnel = researchFunnel();
  const strategies = strategyLab();
  const trials = experimentLedger(500);

  const challengers = strategies.filter((strategy) => strategy.status === "paper_challenger").length;
  const failedTrials = trials.filter((trial) => trial.verdict === "fail").length;
  const survivalRate = trials.length > 0 ? Math.round(((trials.length - failedTrials) / trials.length) * 100) : null;

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">RESEARCH</h1>
        <span className="text-xs text-muted-foreground">
          Most ideas should die in this funnel. A high survival rate is a warning, not a win.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FunnelStage
          label="Sources"
          value={funnel.sources.total}
          detail={`${funnel.sources.rejected} rejected`}
          href="/library"
          survivors={funnel.claims.total}
        />
        <FunnelStage
          label="Claims"
          value={funnel.claims.total}
          detail={`${funnel.claims.verified} verified`}
          href="/edge-factory"
          survivors={funnel.claims.verified}
        />
        <FunnelStage
          label="Hypotheses"
          value={funnel.hypotheses.total}
          detail={`${funnel.hypotheses.duplicates} duplicates caught`}
          href="/edge-factory"
          survivors={funnel.hypotheses.active}
        />
        <FunnelStage
          label="Strategies"
          value={funnel.strategies.total}
          detail={`${challengers} paper challengers`}
          href="/strategies"
          survivors={challengers}
        />
        <FunnelStage
          label="Trials"
          value={trials.length}
          detail={`${failedTrials} failed`}
          href="/experiments"
          survivors={trials.length - failedTrials}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="WHAT THE FUNNEL IS SAYING" className="rise-1">
          {funnel.sources.total === 0 ? (
            <EmptyState>
              Nothing has entered the funnel yet. Archive a paper, video, or repository to begin — from Claude Code
              use <code>marketpulse_record_source</code>, or queue one under System → Jobs.
            </EmptyState>
          ) : (
            <ul className="space-y-2 text-xs leading-relaxed">
              <li>
                <span className="text-muted-foreground">Conversion:</span>{" "}
                {funnel.sources.total} source(s) produced {funnel.claims.total} claim(s) and{" "}
                {funnel.strategies.total} strategy specification(s).
              </li>
              {funnel.claims.byStatus.inferred ? (
                <li className="text-amber">
                  {funnel.claims.byStatus.inferred} claim(s) are still only inferred. Verify them against a second
                  source before building on them.
                </li>
              ) : null}
              {funnel.hypotheses.duplicates > 0 ? (
                <li className="text-gain">
                  {funnel.hypotheses.duplicates} restatement(s) were caught and not re-tested.
                </li>
              ) : null}
              {survivalRate !== null && survivalRate > 60 ? (
                <li className="text-amber">
                  {survivalRate}% of trials passed. That is high — check the gates are actually binding before
                  trusting it.
                </li>
              ) : null}
              {challengers === 0 && funnel.strategies.total > 0 ? (
                <li className="text-muted-foreground">
                  No strategy has cleared the gauntlet yet. That is the expected state early on.
                </li>
              ) : null}
            </ul>
          )}
        </Panel>

        <Panel title="RECENT TRIALS" className="rise-2">
          {trials.length === 0 ? (
            <EmptyState>No trials recorded. Running the gauntlet on a strategy populates this.</EmptyState>
          ) : (
            <ul className="space-y-1 text-xs">
              {trials.slice(0, 10).map((trial) => (
                <li key={trial.id} className="flex justify-between gap-2 border-b border-panel pb-1">
                  <span className="truncate">{trial.strategy}</span>
                  <span className="text-muted-foreground text-[10px]">{trial.kind.replace(/_/g, " ")}</span>
                  <span
                    className={
                      trial.verdict === "pass"
                        ? "text-gain"
                        : trial.verdict === "fail"
                          ? "text-loss"
                          : "text-amber"
                    }
                  >
                    {trial.verdict}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
