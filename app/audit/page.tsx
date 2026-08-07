import { auditView } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const { events, denied, prohibited, failures, learningMode, execution } = auditView();

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">AUDIT</h1>
        <span className="text-xs text-muted-foreground">
          Append-only. Audit rows cannot be edited or deleted, enforced by database triggers.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Events" value={events.length} />
        <StatTile label="Denied" value={denied} tone={denied > 0 ? "warn" : "good"} hint="policy working" />
        <StatTile label="Failures on record" value={failures.length} />
        <StatTile
          label="Execution"
          value={execution.confirmedLive ? "ENABLED" : "DISABLED"}
          hint={execution.reason}
          tone={execution.confirmedLive ? "bad" : "good"}
        />
      </div>

      <Panel title="PROHIBITED ACTIONS">
        <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
          These are enforced in code and by tests, not by instruction. Learning mode is currently{" "}
          <span className="text-amber">{learningMode}</span>, and none of the following become available in any mode.
        </p>
        <ul className="grid gap-1.5 text-[11px] sm:grid-cols-2">
          {prohibited.map((action) => (
            <li key={action.id} className="border border-panel px-2 py-1.5">
              <span className="text-loss">{action.id.replace(/_/g, " ")}</span>
              <p className="text-muted-foreground mt-0.5">{action.reason}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="EVENT LOG">
        {events.length === 0 ? (
          <EmptyState>No governed actions have been attempted yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">When</th>
                  <th className="pb-1">Actor</th>
                  <th className="pb-1">Action</th>
                  <th className="pb-1">Decision</th>
                  <th className="pb-1">Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-panel align-top">
                    <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-1.5">{event.actor}</td>
                    <td className="py-1.5">{event.action.replace(/_/g, " ")}</td>
                    <td className={`py-1.5 ${event.decision === "denied" ? "text-loss" : "text-gain"}`}>
                      {event.decision}
                      {event.denialCode ? <span className="block text-[10px]">{event.denialCode}</span> : null}
                    </td>
                    <td className="py-1.5 text-muted-foreground max-w-[360px]">{event.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="FAILURE MEMORY">
        {failures.length === 0 ? (
          <EmptyState>No failures recorded.</EmptyState>
        ) : (
          <ul className="space-y-2 text-xs">
            {failures.map((failure) => (
              <li key={failure.id} className="border-b border-panel pb-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-loss">{failure.failureMode.replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-muted-foreground">{failure.scope}</span>
                </div>
                <p className="text-muted-foreground mt-0.5">{failure.detail}</p>
                {failure.lesson ? <p className="text-amber mt-0.5">Lesson: {failure.lesson}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
