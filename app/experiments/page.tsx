import { experimentLedger } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

const VERDICT_TONE: Record<string, string> = {
  pass: "text-gain",
  fail: "text-loss",
  inconclusive: "text-amber",
};

export default async function ExperimentsPage() {
  const trials = experimentLedger(150);
  const failed = trials.filter((trial) => trial.verdict === "fail").length;
  const inconclusive = trials.filter((trial) => trial.verdict === "inconclusive").length;

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">EXPERIMENT LAB</h1>
        <span className="text-xs text-muted-foreground">
          Every attempt is recorded, including failures. Deleting a trial is blocked at the database level.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Trials recorded" value={trials.length} />
        <StatTile label="Failed" value={failed} tone={failed > 0 ? "bad" : "neutral"} />
        <StatTile label="Inconclusive" value={inconclusive} tone={inconclusive > 0 ? "warn" : "neutral"} />
        <StatTile label="Passed" value={trials.length - failed - inconclusive} tone="good" />
      </div>

      <Panel title="TRIAL LEDGER">
        {trials.length === 0 ? (
          <EmptyState>No trials yet. Running the validation gauntlet on a strategy populates this ledger.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[680px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">#</th>
                  <th className="pb-1">Strategy</th>
                  <th className="pb-1">Stage</th>
                  <th className="pb-1">Verdict</th>
                  <th className="pb-1">Reason</th>
                  <th className="pb-1">Actor</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((trial) => (
                  <tr key={trial.id} className="border-t border-panel align-top">
                    <td className="py-1.5 text-muted-foreground">{trial.id}</td>
                    <td className="py-1.5">{trial.strategy}</td>
                    <td className="py-1.5 text-muted-foreground">{trial.kind.replace(/_/g, " ")}</td>
                    <td className={`py-1.5 ${VERDICT_TONE[trial.verdict] ?? ""}`}>{trial.verdict}</td>
                    <td className="py-1.5 text-muted-foreground max-w-[380px]">{trial.reason ?? "—"}</td>
                    <td className="py-1.5 text-muted-foreground">{trial.actor}</td>
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
