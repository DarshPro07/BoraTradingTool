import Link from "next/link";
import { agentsAndJobs, auditView, dataQuality } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

const MODE_MEANING: Record<string, string> = {
  off: "Nothing runs on its own.",
  observing: "Reads state and surfaces what is due. Changes nothing.",
  learning: "Also drains the research queue while you are away.",
  evolving: "Also prepares code and strategy proposals for your review.",
};

export default async function SystemOverviewPage() {
  const [resources, jobs, audit] = await Promise.all([
    dataQuality(),
    Promise.resolve(agentsAndJobs()),
    Promise.resolve(auditView(50)),
  ]);

  const entries = Object.entries(resources) as [string, (typeof resources)["health"]][];
  const provided = entries.filter(([, result]) => result.ok).length;
  const stale = entries.filter(([, result]) => result.ok && result.stale).length;
  const pendingApproval = jobs.proposalStats.reviewed;

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">SYSTEM</h1>
        <span className="text-xs">
          AUTONOMY <span className="text-amber">{jobs.learningMode.toUpperCase()}</span>
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Data resources"
          value={`${provided}/${entries.length}`}
          hint={stale > 0 ? `${stale} stale` : "all fresh"}
          tone={stale > 0 ? "warn" : provided === entries.length ? "good" : "neutral"}
        />
        <StatTile
          label="Queued work"
          value={jobs.queue.queued}
          hint={jobs.queue.dead > 0 ? `${jobs.queue.dead} dead` : "no failures"}
          tone={jobs.queue.dead > 0 ? "bad" : "neutral"}
        />
        <StatTile
          label="Awaiting your approval"
          value={pendingApproval}
          hint="only you can approve"
          tone={pendingApproval > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Denied actions"
          value={audit.denied}
          hint="policy holding"
          tone={audit.denied > 0 ? "good" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="AUTONOMY"
          className="rise-1"
          action={<Link href="/learning" className="text-[10px] text-muted-foreground hover:text-foreground">CHANGE →</Link>}
        >
          <p className="text-xs leading-relaxed">
            <span className="text-amber">{jobs.learningMode.toUpperCase()}</span> —{" "}
            {MODE_MEANING[jobs.learningMode] ?? "Unknown mode."}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            Autonomous work begins after two minutes of inactivity and runs at most once every five minutes. Eleven
            actions stay prohibited in every mode, and nothing merges without you.
          </p>
        </Panel>

        <Panel
          title="DATA HEALTH"
          className="rise-2"
          action={<Link href="/data-quality" className="text-[10px] text-muted-foreground hover:text-foreground">DETAIL →</Link>}
        >
          <ul className="space-y-1 text-xs">
            {entries.map(([name, result]) => (
              <li key={name} className="flex justify-between gap-2 border-b border-panel pb-1">
                <span className="text-muted-foreground">{name}</span>
                <span className={result.ok ? (result.stale ? "text-amber" : "text-gain") : "text-loss"}>
                  {result.ok ? (result.stale ? "STALE" : "OK") : result.code.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="RECENT ACTIVITY"
          className="rise-3"
          action={<Link href="/audit" className="text-[10px] text-muted-foreground hover:text-foreground">AUDIT →</Link>}
        >
          {audit.events.length === 0 ? (
            <EmptyState>No governed actions attempted yet.</EmptyState>
          ) : (
            <ul className="space-y-1 text-xs">
              {audit.events.slice(0, 10).map((event) => (
                <li key={event.id} className="flex justify-between gap-2 border-b border-panel pb-1">
                  <span className="truncate">{event.action.replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-muted-foreground">{event.actor}</span>
                  <span className={event.decision === "denied" ? "text-loss" : "text-gain"}>{event.decision}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="PROPOSALS"
          className="rise-4"
          action={<Link href="/jobs" className="text-[10px] text-muted-foreground hover:text-foreground">JOBS →</Link>}
        >
          {jobs.proposals.length === 0 ? (
            <EmptyState>
              No evolution proposals. These only appear in evolving mode, and only you can approve or merge them.
            </EmptyState>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {jobs.proposals.slice(0, 6).map((proposal) => (
                <li key={proposal.id} className="flex justify-between gap-2 border-b border-panel pb-1">
                  <span className="truncate">{proposal.title}</span>
                  <span className="text-[10px] text-amber uppercase">{proposal.status.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
