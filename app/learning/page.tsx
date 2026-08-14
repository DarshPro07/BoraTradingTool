import { getLearningMode } from "@/lib/governance/runtime";
import { AUTONOMOUS_PERMITTED, AUTONOMOUS_PROHIBITED } from "@/lib/governance/policy";
import { masteryByPlane, nextCurriculum } from "@/lib/learning/curriculum";
import { proposalStats } from "@/lib/learning/evolution";
import { queueStats } from "@/lib/research/queue";
import { IDLE_THRESHOLDS, inspectMemory } from "@/lib/learning/introspection";
import { LearningModeControl } from "@/components/learning/LearningModeControl";
import { LearningProgressPanel } from "@/components/learning/LearningProgressPanel";
import { LiveTerminal } from "@/components/learning/LiveTerminal";
import { StudyPanel } from "@/components/learning/StudyPanel";
import { ResearchIntake } from "@/components/research/ResearchIntake";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

const MODE_ORDER = ["off", "observing", "learning", "evolving"];

export default async function LearningPage() {
  const mode = getLearningMode();
  const curriculum = nextCurriculum(undefined, 10);
  const mastery = masteryByPlane();
  const proposals = proposalStats();
  const queue = queueStats();
  const introspection = inspectMemory();

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">AUTO RUNTIME</h1>
        <span className="text-xs">
          CURRENT <span className="text-amber">{mode === "off" ? "MAINTENANCE" : "RUN"}</span>
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Queued jobs" value={queue.queued} />
        <StatTile label="Dead jobs" value={queue.dead} tone={queue.dead > 0 ? "bad" : "neutral"} />
        <StatTile label="Open proposals" value={proposals.draft + proposals.tests_pending + proposals.tests_passed + proposals.reviewed} />
        <StatTile label="Awaiting approval" value={proposals.reviewed} tone={proposals.reviewed > 0 ? "warn" : "neutral"} />
      </div>

      {/* Progress vs activity, and the broker assumptions every intraday number rests on.
          First, because "is this getting better?" is the question this page exists to answer,
          and the tiles above it are activity — necessary, insufficient. */}
      <LearningProgressPanel />

      <Panel title="AUTO / RUN">
        <LearningModeControl current={mode} />

        {/* Directly under the control, because the question "did that do anything?" arrives
            within seconds of changing the mode — not on another screen. */}
        <LiveTerminal />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="WHAT IS ENABLED IN RUN">
          <ul className="space-y-1 text-xs">
            {AUTONOMOUS_PERMITTED.map((action) => {
              const enabled = MODE_ORDER.indexOf(mode) >= MODE_ORDER.indexOf(action.minimumMode);
              return (
                <li key={action.id} className="flex justify-between gap-2 border-b border-panel pb-1">
                  <span className={enabled ? "" : "text-muted-foreground"}>{action.summary}</span>
                  <span className={`text-[10px] whitespace-nowrap ${enabled ? "text-gain" : "text-muted-foreground"}`}>
                    {enabled ? "ON" : `needs ${action.minimumMode}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="NEVER PERMITTED">
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            These stay off in every mode. They are enforced by the policy module, by database triggers, and by tests
            that fail the build if any of them becomes reachable.
          </p>
          <ul className="space-y-1 text-xs">
            {AUTONOMOUS_PROHIBITED.map((action) => (
              <li key={action.id} className="flex justify-between gap-2 border-b border-panel pb-1">
                <span className="text-muted-foreground">{action.id.replace(/_/g, " ")}</span>
                <span className="text-[10px] text-loss">BLOCKED</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="SELF-INSPECTION">
        <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
          What the system finds when it examines its own memory — after{" "}
          <span className="text-amber">{IDLE_THRESHOLDS.idleAfterMinutes} min</span> of silence for
          light passes, <span className="text-amber">{IDLE_THRESHOLDS.deepIdleAfterMinutes} min</span>{" "}
          for the expensive ones. It cannot read papers unattended: there is no model inside this
          application, so each finding becomes work for the next agent connection rather than a
          conclusion drawn here.
        </p>

        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground mb-3">
          <span data-testid="introspection-summary">{introspection.summary}</span>
        </div>

        {introspection.findings.length === 0 ? (
          <EmptyState>Nothing orphaned, nothing stalled, no failure mode repeating.</EmptyState>
        ) : (
          <ul className="space-y-1.5 text-xs" data-testid="introspection-findings">
            {introspection.findings.map((finding, index) => (
              <li
                key={`${finding.kind}-${index}`}
                className="border border-panel bg-panel-alt px-2.5 py-1.5"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-wider ${
                      finding.severity === "attention" ? "text-amber" : "text-muted-foreground"
                    }`}
                  >
                    {finding.kind.replace(/_/g, " ")}
                  </span>
                  <span className="flex-1 min-w-[220px]">{finding.summary}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {finding.subjectIds.length || ""}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  → {finding.suggestedWork}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="RESEARCH INTAKE">
        <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
          What the deterministic worker drains on every <span className="text-amber">RUN</span> cycle. Until
          something is queued here the loop has nothing to ingest, and{" "}
          <span className="text-amber">Processed 0 job(s)</span> is an accurate report of an empty queue rather than a
          broken one.
        </p>
        <ResearchIntake />
      </Panel>

      <Panel title="STUDY QUEUE">
        {/* The panel used to be a list with no way to answer it, so mastery stayed at zero and the
            same concepts showed as `never studied` forever. The card is the producer. */}
        <div className="mb-3">
          <StudyPanel />
        </div>

        {curriculum.length === 0 ? (
          <EmptyState>Nothing to study. Concepts enter the curriculum when lessons introduce them.</EmptyState>
        ) : (
          <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
            {curriculum.map((item) => (
              <li key={item.conceptId} className="flex justify-between border border-panel px-2 py-1">
                <span>{item.name}</span>
                <span className="text-[10px] text-muted-foreground">{item.reason.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}
        {mastery.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {mastery.map((entry) => (
              <span key={entry.plane}>
                {entry.plane.replace(/_/g, " ")}: {entry.studied}/{entry.concepts} studied
                {entry.dueNow > 0 ? <span className="text-amber"> · {entry.dueNow} due</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
