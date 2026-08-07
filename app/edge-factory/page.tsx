import Link from "next/link";
import { researchFunnel } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

function Stage({ label, total, breakdown }: { label: string; total: number; breakdown: [string, number][] }) {
  return (
    <div className="border border-panel bg-panel-alt p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-xl">{total}</span>
      </div>
      {breakdown.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          {breakdown.map(([key, value]) => (
            <li key={key} className="flex justify-between">
              <span>{key.replace(/_/g, " ")}</span>
              <span>{value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">nothing yet</p>
      )}
    </div>
  );
}

export default async function EdgeFactoryPage() {
  const funnel = researchFunnel();
  const conversion =
    funnel.sources.total === 0 ? 0 : (funnel.strategies.total / funnel.sources.total) * 100;

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">EDGE FACTORY</h1>
        <span className="text-xs text-muted-foreground">
          Source → Claim → Hypothesis → Strategy. Most ideas should die here, not in the market.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sources archived" value={funnel.sources.total} hint={`${funnel.sources.rejected} rejected`} />
        <StatTile label="Claims verified" value={funnel.claims.verified} hint={`of ${funnel.claims.total} extracted`} />
        <StatTile
          label="Duplicate ideas caught"
          value={funnel.hypotheses.duplicates}
          hint="not re-tested"
          tone={funnel.hypotheses.duplicates > 0 ? "good" : "neutral"}
        />
        <StatTile
          label="Source → strategy"
          value={`${conversion.toFixed(0)}%`}
          hint="a low number is healthy"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stage label="Sources" total={funnel.sources.total} breakdown={Object.entries(funnel.sources.byKind)} />
        <Stage label="Claims" total={funnel.claims.total} breakdown={Object.entries(funnel.claims.byStatus)} />
        <Stage
          label="Hypotheses"
          total={funnel.hypotheses.total}
          breakdown={[
            ["active", funnel.hypotheses.active],
            ["duplicates", funnel.hypotheses.duplicates],
            ["rejected", funnel.hypotheses.rejected],
          ]}
        />
        <Stage label="Strategies" total={funnel.strategies.total} breakdown={Object.entries(funnel.strategies.byStatus)} />
      </div>

      <Panel
        title="HOW TO FEED THE FACTORY"
        action={<Link href="/jobs" className="text-[10px] text-muted-foreground hover:text-foreground">JOBS →</Link>}
      >
        {funnel.sources.total === 0 ? (
          <EmptyState>
            No sources archived yet. From Claude Code, use <code>marketpulse_enqueue_research</code> or{" "}
            <code>marketpulse_record_source</code> to add a paper, video, or repository.
          </EmptyState>
        ) : (
          <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              The worker archives, links and deduplicates without a model. Claims and hypotheses must be supplied by
              the analyst — the worker will not invent them from raw text.
            </p>
            <p>
              {funnel.claims.byStatus.inferred ?? 0} claim(s) are still marked inferred. Verify them against a second
              source before building a strategy on top.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
