import { getDb, schema } from "@/lib/db";
import { Panel } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import { lastCycleRun } from "@/lib/learning/run-log";

/**
 * The validation funnel — how many strategies survive each stage.
 *
 * From the reel (frame 1440): stages drawn as bars with survivor counts, over a table where
 * strategies that made money on screen still carry a GRAVEYARD badge. That juxtaposition is the
 * system's whole argument, and a list of gate *thresholds* — which is what this screen showed
 * before — states the rules while hiding whether they bite.
 *
 * Counted from the trial ledger, so the funnel cannot drift from the record it describes.
 */

const STAGES = [
  { key: "authored", label: "AUTHORED", note: "Compiled and stored" },
  { key: "rehearsed", label: "REHEARSED", note: "Last cycle; costs no trial" },
  { key: "validated", label: "GAUNTLET", note: "Spent a trial" },
  { key: "passed", label: "PASSED", note: "Cleared every gate" },
  { key: "forward", label: "FORWARD", note: "Accumulating paper evidence" },
] as const;

export function ValidationFunnel() {
  const db = getDb();
  const specs = db.select().from(schema.strategySpecs).all();

  if (specs.length === 0) {
    return (
      <Panel title="VALIDATION FUNNEL">
        <StateBody state="empty" reason="No strategies have been authored, so nothing has entered the funnel." />
      </Panel>
    );
  }

  const results = db.select().from(schema.validationResults).all();
  const trials = db.select().from(schema.trials).all();
  const forward = db.select().from(schema.forwardOutcomes).all();

  const validatedIds = new Set(results.map((row) => row.strategySpecId));
  const passedIds = new Set(results.filter((row) => row.passed === 1).map((row) => row.strategySpecId));
  const forwardIds = new Set(forward.map((row) => row.strategySpecId));

  // Rehearsal comes from the cycle log, not from `trials`.
  //
  // My first version counted trial rows here, which made REHEARSED and GAUNTLET the same
  // number — trials are written *by* the gauntlet. The rehearsal deliberately records nothing
  // per strategy, so the only honest source is the last cycle's own count, and it is labelled
  // as such rather than presented as a cumulative total it cannot be.
  const lastRun = lastCycleRun();
  const rehearsedLastCycle = lastRun?.rehearsed ?? 0;
  // Trials exist independently of validation results, so keep them visible.
  const trialsSpent = new Set(trials.map((row) => row.strategySpecId)).size;

  const counts: Record<string, number> = {
    authored: specs.length,
    rehearsed: rehearsedLastCycle,
    validated: Math.max(validatedIds.size, trialsSpent),
    passed: passedIds.size,
    forward: forwardIds.size,
  };

  const widest = Math.max(1, counts.authored);
  const buried = specs.filter((spec) => spec.status === "rejected" || spec.status === "retired");

  return (
    <Panel title="VALIDATION FUNNEL">
      <div className="space-y-1.5 mb-3" data-testid="validation-funnel">
        {STAGES.map((stage) => {
          const count = counts[stage.key] ?? 0;
          const share = count / widest;
          return (
            <div key={stage.key} className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                {stage.label}
              </span>
              <div className="flex-1 h-4 bg-panel-alt border border-panel relative">
                <div
                  className={`h-full ${count === 0 ? "bg-transparent" : "bg-terminal/30"}`}
                  style={{ width: `${Math.max(share * 100, count > 0 ? 3 : 0)}%` }}
                />
                <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] tabular-nums">
                  {count}
                </span>
              </div>
              <span className="text-[9px] text-muted-foreground w-40 shrink-0">{stage.note}</span>
            </div>
          );
        })}
      </div>

      {/* The line the reel makes with a table of profitable strategies all marked GRAVEYARD. */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {counts.passed === 0 && counts.validated > 0 ? (
          <>
            <span className="text-amber">{counts.validated} strategies spent a trial and none passed.</span> That is
            the gauntlet working, not a fault. A strategy can be profitable on screen and still be
            rejected — most are.
          </>
        ) : counts.validated === 0 ? (
          <>
            Nothing has been through the gauntlet. Rehearsal answers &ldquo;is it worth a
            trial?&rdquo; for free; the gauntlet costs one and permanently raises that
            strategy&rsquo;s bar.
          </>
        ) : (
          <>
            {counts.passed} of {counts.validated} cleared every gate. Passing is a licence to
            gather forward evidence, not a conclusion.
          </>
        )}
        {buried.length > 0 ? ` ${buried.length} buried and kept on record so they cannot be rediscovered.` : ""}
      </p>
    </Panel>
  );
}
