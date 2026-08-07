import { agentsAndJobs } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

const JOB_TONE: Record<string, string> = {
  succeeded: "text-gain",
  dead: "text-loss",
  failed: "text-loss",
  running: "text-amber",
  queued: "text-muted-foreground",
};

export default async function JobsPage() {
  const { queue, jobs, proposals, proposalStats: stats, learningMode } = agentsAndJobs();

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">AGENTS &amp; JOBS</h1>
        <span className="text-xs">
          LEARNING MODE <span className="text-amber">{learningMode.toUpperCase()}</span>
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(queue).map(([status, count]) => (
          <StatTile
            key={status}
            label={status}
            value={count}
            tone={status === "dead" && count > 0 ? "bad" : status === "succeeded" ? "good" : "neutral"}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="JOBS">
          {jobs.length === 0 ? (
            <EmptyState>
              The queue is empty. Nothing is scheduled, and the worker is idle rather than stuck.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                    <th className="pb-1">#</th>
                    <th className="pb-1">Kind</th>
                    <th className="pb-1">Status</th>
                    <th className="pb-1">Attempts</th>
                    <th className="pb-1">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-t border-panel align-top">
                      <td className="py-1.5 text-muted-foreground">{job.id}</td>
                      <td className="py-1.5">{job.kind.replace(/_/g, " ")}</td>
                      <td className={`py-1.5 ${JOB_TONE[job.status] ?? ""}`}>{job.status}</td>
                      <td className="py-1.5">
                        {job.attempts}/{job.maxAttempts}
                      </td>
                      <td className="py-1.5 text-muted-foreground max-w-[240px]">{job.lastError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="EVOLUTION PROPOSALS">
          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(stats).map(([status, count]) => (
              <span key={status} className="border border-panel px-1.5 py-0.5 text-[10px]">
                {status.replace(/_/g, " ")}: {count}
              </span>
            ))}
          </div>

          {proposals.length === 0 ? (
            <EmptyState>
              No proposals. Autonomous code changes only appear here in evolving mode, and only the owner can
              approve or merge them.
            </EmptyState>
          ) : (
            <ul className="space-y-2 text-xs">
              {proposals.map((proposal) => (
                <li key={proposal.id} className="border border-panel bg-panel-alt p-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>{proposal.title}</span>
                    <span className="text-amber text-[10px] uppercase">{proposal.status.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-muted-foreground mt-1">{proposal.rationale}</p>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    action: {proposal.actionId} · evidence: {proposal.evidenceItems.length}
                    {proposal.reviewer ? ` · reviewer: ${proposal.reviewer}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
