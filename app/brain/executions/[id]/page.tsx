import Link from "next/link";
import { executionTrace, type ExecutionMemberView } from "@/lib/brain/execution-trace";
import { Panel } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

/**
 * One TeamRun's execution tree — the ledgers, rendered. Job state sits ABOVE team state (the Job
 * OS is the lifecycle authority; a completed team never implies a completed job). Assigned vs
 * executed vs verification are three separate facts and stay three separate lines. Dissent is
 * rendered verbatim — the team architecture exists to preserve disagreement, and the UI must not
 * throw that work away. Artifact CONTENT is the system's own structured product; raw model
 * prompts are deliberately not shown here.
 */

function seconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function TimelineBar({ member, traceStart, traceMs }: { member: ExecutionMemberView; traceStart: number; traceMs: number }) {
  if (!member.startedAt || !member.completedAt || traceMs <= 0) return null;
  const start = new Date(member.startedAt).getTime();
  const end = new Date(member.completedAt).getTime();
  const left = Math.max(0, ((start - traceStart) / traceMs) * 100);
  const width = Math.max(1.5, ((end - start) / traceMs) * 100);
  return (
    <div className="flex items-center gap-2" data-testid="timeline-row">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground truncate">
        {member.role}
      </span>
      <div className="relative h-3 flex-1 bg-panel-alt border border-panel">
        <div
          className={`absolute inset-y-0 ${member.status === "FAILED" || member.status === "REFUSED" ? "bg-loss/50" : "bg-terminal/40"}`}
          style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-[10px] tabular-nums text-muted-foreground">{seconds(member.durationMs)}</span>
    </div>
  );
}

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trace = executionTrace(id);

  if (!trace) {
    return (
      <div className="p-4">
        <Panel title="EXECUTION">
          <p className="p-3 text-xs text-muted-foreground">
            No TeamRun <span className="tabular-nums">{id}</span> exists in the ledger.{" "}
            <Link href="/brain" className="underline">
              Back to the brain
            </Link>
            .
          </p>
        </Panel>
      </div>
    );
  }

  const traceStart = new Date(trace.startedAt).getTime();
  const traceMs =
    trace.durationMs ??
    Math.max(
      0,
      ...trace.members
        .filter((member) => member.completedAt)
        .map((member) => new Date(member.completedAt as string).getTime() - traceStart),
    );

  return (
    <div className="p-4 space-y-4" data-testid="execution-tree">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">
          EXECUTION — {trace.instrumentId ?? trace.teamId}{" "}
          <span
            className={
              trace.status === "COMPLETED" ? "text-gain" : trace.status === "FAILED" ? "text-loss" : "text-amber"
            }
            data-testid="execution-status"
          >
            {trace.status}
          </span>
        </h1>
        <Link href="/brain" className="text-xs text-muted-foreground underline">
          ← brain
        </Link>
      </header>

      {/* The lifecycle authority, from ITS OWN row — never inferred from team status. */}
      <Panel title="JOB — THE LIFECYCLE AUTHORITY">
        <div className="p-3 text-xs" data-testid="execution-job">
          {trace.job ? (
            <>
              <span className="tabular-nums">#{trace.job.id}</span> {trace.job.kind} ·{" "}
              <span className={trace.job.status === "succeeded" ? "text-gain" : trace.job.status === "dead" ? "text-loss" : "text-amber"}>
                {trace.job.status}
              </span>{" "}
              · attempt {trace.job.attempts}
              {trace.job.lastError ? <span className="text-loss"> · {trace.job.lastError.slice(0, 160)}</span> : null}
              <div className="text-[10px] text-muted-foreground mt-1">
                Team {trace.status} does not imply job completion — the Job OS decides the lifecycle.
              </div>
            </>
          ) : (
            "No originating job (a directly-invoked team run)."
          )}
        </div>
      </Panel>

      <Panel title="TIMELINE — WHO RAN, AND WHETHER WORK OVERLAPPED">
        <div className="p-3 space-y-1" data-testid="execution-timeline">
          {trace.members.map((member) => (
            <TimelineBar key={member.agentRunId} member={member} traceStart={traceStart} traceMs={traceMs || 1} />
          ))}
          <div className="text-[10px] text-muted-foreground pt-1">
            Total {seconds(trace.durationMs)} · bars are real ledger timestamps, not a schematic.
          </div>
        </div>
      </Panel>

      <Panel title="MEMBERS — ASSIGNED vs EXECUTED, NEVER COLLAPSED">
        <div className="p-3 space-y-2">
          {trace.members.map((member) => (
            <div key={member.agentRunId} className="border border-panel/60 px-2.5 py-2 text-xs" data-testid="execution-member">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="uppercase tracking-wider">{member.role}</span>
                <span
                  className={
                    member.status === "COMPLETED"
                      ? "text-gain"
                      : member.status === "FAILED" || member.status === "REFUSED"
                        ? "text-loss"
                        : "text-amber"
                  }
                  data-testid="member-status"
                >
                  {member.status}
                </span>
                {member.agentId ? (
                  <span className="text-muted-foreground">
                    {member.agentId}@{member.agentVersion ?? "?"}
                  </span>
                ) : null}
                <span className="text-muted-foreground">{seconds(member.durationMs)}</span>
              </div>
              <div className="grid gap-0.5 mt-1 text-[10px]" data-testid="member-binding">
                <div>
                  <span className="text-muted-foreground">Assigned:</span>{" "}
                  {member.assigned
                    ? `${member.assigned.providerId ?? "—"} / ${member.assigned.modelId ?? "—"} (${member.assigned.binding ?? "unstated"}, ${member.assigned.source ?? ""})`
                    : "no router assignment recorded"}
                </div>
                <div>
                  <span className="text-muted-foreground">Executed:</span>{" "}
                  {member.executed ? `${member.executed.provider} / ${member.executed.model}` : "no run row (interrupted write)"}
                </div>
                <div>
                  <span className="text-muted-foreground">Verification:</span> {member.modelVerification}
                </div>
                <div>
                  <span className="text-muted-foreground">Tokens:</span> {member.tokens ?? "—"} ·{" "}
                  <span className="text-muted-foreground">Cost:</span>{" "}
                  {member.cost !== null ? `${member.cost} ${member.costCurrency ?? ""}` : "COST UNAVAILABLE"}
                </div>
                {member.refusalCode ? (
                  <div className="text-loss">
                    {member.refusalCode}: {member.refusalMessage?.slice(0, 200)}
                  </div>
                ) : null}
              </div>
              {member.artifacts.length > 0 ? (
                <div className="mt-1 space-y-0.5" data-testid="member-artifacts">
                  {member.artifacts.map((artifact) => (
                    <div key={artifact.id} className="text-[10px]">
                      <span className="text-terminal">▸</span> {artifact.kind}{" "}
                      <span className="text-muted-foreground tabular-nums">
                        {artifact.id} · {artifact.bytes} bytes · {new Date(artifact.createdAt).toISOString().slice(11, 19)}Z ·
                        consumers: {artifact.consumers}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      {trace.result ? (
        <Panel title="TEAM RESULT — DISSENT SURVIVES SYNTHESIS">
          <div className="p-3 text-xs space-y-2" data-testid="execution-result">
            <div>
              <span className="text-muted-foreground">Conclusion:</span> {trace.result.conclusion}
            </div>
            <div>
              <span className="text-muted-foreground">Recommendation:</span>{" "}
              {trace.result.recommendation.replace(/_/g, " ")} ·{" "}
              <span className="text-muted-foreground">basis:</span> {trace.result.confidenceBasis}
            </div>
            {trace.result.dissent.length > 0 ? (
              <div data-testid="execution-dissent">
                <div className="text-[10px] uppercase tracking-wider text-amber">Dissent</div>
                {trace.result.dissent.map((entry, index) => (
                  <div key={index} className="text-[11px]">
                    <span className="uppercase text-muted-foreground">{entry.role}:</span> {entry.concern}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">No dissent was recorded by any member.</div>
            )}
            {trace.result.unresolvedQuestions.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Unresolved</div>
                {trace.result.unresolvedQuestions.map((question, index) => (
                  <div key={index} className="text-[11px]">
                    {question}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>
      ) : trace.error ? (
        <Panel title="TEAM RESULT">
          <p className="p-3 text-xs text-loss" data-testid="execution-error">
            {trace.error}
          </p>
        </Panel>
      ) : null}

      <Panel title="TOTALS — RECONCILED AGAINST THE CHILD RUNS">
        <div className="p-3 grid gap-1 sm:grid-cols-3 text-xs" data-testid="execution-totals">
          <div>
            Tokens: <span className="tabular-nums">{trace.totals.tokens ?? "—"}</span>{" "}
            <span className="text-[10px] text-muted-foreground">
              (
              {trace.reconciled === null
                ? "NOT COMPARABLE — no per-member token counts to reconcile against"
                : trace.reconciled
                  ? "reconciles with members"
                  : "DOES NOT reconcile"}
              )
            </span>
          </div>
          <div>
            Cost:{" "}
            {trace.totals.cost !== null
              ? `${trace.totals.cost} ${trace.totals.costCurrency ?? ""}`
              : trace.totals.tokens !== null
                ? "COST UNAVAILABLE (tokens measured; no pricing source)"
                : "COST UNAVAILABLE (no usage reported by the provider)"}
          </div>
          <div>
            Artifacts: {trace.totals.artifactCount} · Dissent: {trace.totals.dissentCount} · Unresolved:{" "}
            {trace.totals.unresolvedCount} · Failed members: {trace.totals.membersFailed}
          </div>
        </div>
      </Panel>
    </div>
  );
}
