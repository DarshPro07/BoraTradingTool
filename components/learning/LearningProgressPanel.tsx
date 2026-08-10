import { executionContextFor, describeExecution } from "@/lib/broker/execution-profile";
import { learningMetrics, type Measure } from "@/lib/learning/metrics";
import { Panel } from "@/components/system/Panel";

/**
 * Is the system getting anywhere — and under which execution assumptions?
 *
 * Two disciplines carried from the modules this renders:
 *
 * 1. **Activity is not progress.** The two columns are never summed, because adding them is how a
 *    dashboard flatters a stalled system: cycles rise every day whatever happens.
 * 2. **Missing is not zero.** A `Measure` whose value is null renders as "n/a" with its note —
 *    "0 trials spent" and "the trial ledger cannot be counted" are different facts, and a panel
 *    that shows both as 0 has destroyed the distinction.
 *
 * The execution strip exists because every intraday number anywhere in this app is downstream of
 * one broker deadline, and until 2026-08-09 that deadline was a hardcoded 15:20 nobody could see
 * or audit. Now it is shown, with its source and confidence, where the owner already looks.
 */

function MeasureCell({ label, measure }: { label: string; measure: Measure }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {measure.value === null ? (
        <span className="text-xs text-amber" title={measure.note}>
          n/a — {measure.note ?? "not measurable"}
        </span>
      ) : (
        <span className="text-sm tabular-nums">{formatValue(measure.value)}</span>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function LearningProgressPanel() {
  const metrics = learningMetrics();
  const execution = executionContextFor("NSE", "5m", new Date());

  return (
    <Panel title="LEARNING PROGRESS">
      <div className="p-3 space-y-3">
        <p className="text-xs leading-relaxed">{metrics.verdict}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground mb-1">
              ACTIVITY — rises whether or not anything is learned
            </p>
            <MeasureCell label="Cycles, last 7 days" measure={metrics.activity.cyclesLast7Days} />
            <MeasureCell label="Research sources held" measure={metrics.activity.researchSourcesHeld} />
            <MeasureCell label="Claims extracted" measure={metrics.activity.claimsExtracted} />
            <MeasureCell label="Hypotheses formed" measure={metrics.activity.hypothesesFormed} />
            <MeasureCell label="Strategies in registry" measure={metrics.activity.strategiesInRegistry} />
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground mb-1">
              PROGRESS — what has actually been established
            </p>
            <MeasureCell label="Hypotheses with a strategy" measure={metrics.progress.hypothesesWithAStrategy} />
            <MeasureCell label="With research identity" measure={metrics.progress.strategiesWithResearchIdentity} />
            <MeasureCell label="Selection trials spent" measure={metrics.progress.selectionTrialsSpent} />
            <MeasureCell label="Strategies validated" measure={metrics.progress.strategiesValidated} />
            <MeasureCell label="Forward observations resolved" measure={metrics.progress.forwardObservationsResolved} />
            <MeasureCell label="Evidence yield (fwd obs / trial)" measure={metrics.evidenceYield} />
          </div>
        </div>

        <div className="pt-2 border-t border-border/40">
          <p className="text-[10px] tracking-widest text-muted-foreground mb-1">EXECUTION ASSUMPTIONS</p>
          {execution.available ? (
            <p className="text-xs leading-relaxed">
              {describeExecution(execution.profile)}
              {execution.profile.assumptions.length > 0 ? (
                <span className="text-muted-foreground"> {execution.profile.assumptions.join(" ")}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-xs text-amber">{execution.reason}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
