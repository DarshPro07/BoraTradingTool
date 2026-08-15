import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listGraveyard } from "@/lib/strategy/graveyard";
import { alphaHealthFor } from "@/lib/quant/alpha-health";
import { systemReadiness } from "@/lib/product/readiness";
import { forwardScorecard } from "@/lib/forward/shadow";
import { nextStep } from "@/lib/guide/next-step";
import { lastCycleRun } from "@/lib/learning/run-log";
import { listJobs, queueStats } from "@/lib/research/queue";
import { Panel } from "@/components/system/Panel";
import { AutonomousControl } from "@/components/system/AutonomousControl";
import { RUNTIME_PROFILES } from "@/lib/runtime/routing";
import { getBrainState, type LaneState } from "@/lib/brain/kernel";
import { listExecutions } from "@/lib/brain/execution-trace";

export const dynamic = "force-dynamic";

/**
 * /brain — the visible operational mind (mission P0; the product philosophy the owner's video
 * made concrete: the system does not hide its learning).
 *
 * Everything on this page is a live database read: what the system KNOWS, what it is DOING,
 * what FAILED and why, what survives, and what is ready vs missing. No number here is invented,
 * and a gap is a stated gap with the job that fixes it — never a bare "insufficient data".
 */
export default async function BrainPage() {
  const db = getDb();
  const readiness = systemReadiness();
  const brain = await getBrainState();

  const specs = db.select().from(schema.strategySpecs).all();
  const experiments = db.select().from(schema.experiments).all();
  const sources = db.select().from(schema.knowledgeSources).all().length;
  let claims = 0;
  try {
    claims = db.select().from(schema.knowledgeClaims).all().length;
  } catch {
    claims = 0;
  }
  const hypotheses = db.select().from(schema.researchHypotheses).all().length;
  const graveyard = listGraveyard();
  const challengers = db.select().from(schema.forwardChallengers).all();
  const paperAccounts = db.select().from(schema.paperForwardAccounts).all();
  const paperOrders = db.select().from(schema.paperOrders).all().length;
  // The forward-driven paper desk is a DELIBERATELY separate ledger from the manual paper tickets.
  // Counting accounts from one ledger and orders from the other read as "8 accounts, 0 orders"
  // after eight full journeys — a truthful cockpit shows each ledger's own count.
  const forwardPaperOrders = db.select().from(schema.paperForwardOrders).all().length;
  const trials = db.select().from(schema.selectionTrials).all().length;

  // Current autonomous work: the newest audit trail entries, humanized lightly.
  const recentWork = db
    .select()
    .from(schema.auditEvents)
    .orderBy(desc(schema.auditEvents.id))
    .limit(8)
    .all();

  // Families with member counts — the research tree, not a flat list.
  const families = db.select().from(schema.strategyFamilies).all();
  const identity = db.select().from(schema.strategyIdentity).all();
  const memberCounts = new Map<string, number>();
  for (const row of identity) {
    memberCounts.set(row.strategyFamilyId, (memberCounts.get(row.strategyFamilyId) ?? 0) + 1);
  }

  // Graveyard: why strategies actually died, as a histogram of recorded failing stages.
  const deathReasons = new Map<string, number>();
  for (const grave of graveyard) {
    for (const reason of grave.reasons.length > 0 ? grave.reasons : ["unrecorded"]) {
      const key = reason.split(":")[0].trim().slice(0, 40);
      deathReasons.set(key, (deathReasons.get(key) ?? 0) + 1);
    }
  }

  const activeChallengers = challengers.filter((row) => row.status === "ACTIVE");
  const health = activeChallengers
    .map((challenger) => ({ challenger, health: alphaHealthFor(challenger.id) }))
    .filter((entry) => entry.health !== null);

  // AUTONOMY ACTIVITY (owner directive 2026-08-10 15:00): the difference between "there is a
  // learning button" and "I can see the system thinking". Every row is a durable read — the
  // queue, the run log, the forward ledgers, the graveyard, the readiness contract — never a
  // promise. A section with nothing to show says what its zero means.
  const queue = queueStats();
  const runningJobs = listJobs("running", 3);
  const queuedJobs = listJobs("queued", 3);
  const latestRun = lastCycleRun();
  const rehearsing = specs.filter((spec) => spec.status === "validating").length;
  const awaitingEvidence = activeChallengers
    .map((challenger) => ({ challenger, card: forwardScorecard(challenger.id) }))
    .filter((entry) => entry.card !== null)
    .map((entry) => ({
      name: entry.card!.specName,
      signals: entry.card!.signals,
      needed: entry.card!.policy.minSignals,
      verdict: entry.card!.verdict,
    }));
  const recentBurials = graveyard.slice(0, 3);
  const dataGaps = readiness.items.filter((item) => item.status === "MISSING" && item.fixedBy);
  const guidance = nextStep();

  const statusTone = (status: string) =>
    status === "READY" ? "text-gain" : status === "PARTIAL" ? "text-amber" : "text-loss";

  return (
    <div className="p-4 space-y-3 max-w-6xl mx-auto" data-testid="brain-page">
      {/* The one button. Everything beneath the governance ceiling runs itself after this. */}
      <Panel title="MARKETPULSE — AUTONOMOUS RUNTIME">
        <AutonomousControl profile={RUNTIME_PROFILES[0]} />
      </Panel>

      <Panel title="MARKETPULSE BRAIN — WHAT THE SYSTEM KNOWS, DOES, AND STILL LACKS">
        <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]" data-testid="brain-system">
          <div>
            <div className="text-muted-foreground text-[10px]">MODE</div>
            <div className="font-bold uppercase">{brain.mode === "RUN" ? "AUTO — RUNNING" : brain.mode}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px]">READINESS</div>
            <div>
              <span className="text-gain">{readiness.summary.ready} ready</span> ·{" "}
              <span className="text-amber">{readiness.summary.partial} partial</span> ·{" "}
              <span className="text-loss">{readiness.summary.missing} missing</span> ·{" "}
              {readiness.summary.unavailable} by design
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px]">EXECUTION</div>
            <div>PAPER ONLY — no broker adapter places orders</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px]">STATISTICAL SPEND</div>
            <div>{trials} selection trial(s) recorded, permanently</div>
          </div>
        </div>
      </Panel>

      {/* AUTO MODE LANES — concurrent, not mode switching */}
      <Panel title="AUTO MODE — CONCURRENT LANES">
        <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]" data-testid="brain-lanes">
          {Object.entries(brain.lanes).map(([key, lane]) => {
            const colorClass = lane.state === "ACTIVE" ? "text-gain" : lane.state === "WAITING" ? "text-amber" : lane.state === "BLOCKED" || lane.state === "FAILED" ? "text-loss" : "text-muted-foreground";
            return (
              <div key={key} className="border border-panel/60 px-2 py-1">
                <div className={`font-bold uppercase ${colorClass}`}>{lane.state}</div>
                <div className="text-[10px]">{lane.name}</div>
                {lane.lastAction && <div className="text-muted-foreground truncate">{lane.lastAction}</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="KNOWLEDGE — WHAT IT HAS LEARNED AND TESTED">
        <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="brain-knowledge">
          <div>Research sources: {sources}</div>
          <div>Verified claims: {claims}</div>
          <div>Hypotheses: {hypotheses}</div>
          <div>Strategies: {specs.length}</div>
          <div>Experiments: {experiments.length}</div>
          <div>Graveyard: {graveyard.length}</div>
          <div>Forward challengers: {challengers.length}</div>
          <div>Paper accounts: {paperAccounts.length}</div>
          <div>Paper orders: {paperOrders}</div>
          <div>Forward paper orders: {forwardPaperOrders}</div>
        </div>
      </Panel>

      <Panel title="RECENT WORK — TEAM EXECUTIONS, FROM THE LEDGERS">
        <div className="p-3 space-y-1.5 text-[11px]" data-testid="brain-executions">
          {(() => {
            const executions = listExecutions(8);
            if (executions.length === 0) {
              return (
                <div className="text-muted-foreground">
                  No team executions yet. A deep research job (payload depth: &quot;deep&quot;) runs the
                  Chief-of-Staff team; its full execution tree — members, models, artifacts,
                  dissent — appears here from the ledgers.
                </div>
              );
            }
            return executions.map((execution) => (
              <Link
                key={execution.teamRunId}
                href={`/brain/executions/${execution.teamRunId}`}
                className="block border border-panel/60 px-2.5 py-1.5 hover:bg-panel-alt"
                data-testid="brain-execution-row"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span>{execution.instrumentId ?? execution.teamId}</span>
                  <span
                    className={
                      execution.status === "COMPLETED"
                        ? "text-gain"
                        : execution.status === "FAILED"
                          ? "text-loss"
                          : "text-amber"
                    }
                  >
                    {execution.status}
                  </span>
                  {execution.durationMs !== null ? (
                    <span className="text-muted-foreground">{(execution.durationMs / 1000).toFixed(1)}s</span>
                  ) : null}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {execution.memberCount} member(s) · {execution.artifactCount} artifact(s) ·{" "}
                  {execution.dissentCount} dissent · tokens {execution.tokens ?? "—"}
                  {execution.recommendation ? ` · ${execution.recommendation.replace(/_/g, " ")}` : ""}
                </div>
              </Link>
            ));
          })()}
        </div>
      </Panel>

      <Panel title="AUTONOMY ACTIVITY — WHAT IT IS WORKING ON, FROM THE LEDGERS">
        {/* These cells quote strategy ids verbatim (`deep_journey_gap_jyothylab_mstjkez4_…`), and a
            grid item will not shrink below its content. Unwrapped, one id made the cockpit 782px
            wide on a 390px phone — the page this whole surface exists to be read on. */}
        <div
          className="p-3 grid gap-2 md:grid-cols-2 text-[11px] [overflow-wrap:anywhere] [&>*]:min-w-0"
          data-testid="brain-activity"
        >
          {/* U6: every lane opens the surface where its rows live — activity is inspectable,
              not just displayed. */}
          <div className="border border-panel/60 px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-terminal">● Researching</div>
              <Link href="/jobs" className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="brain-activity-link-research">
                Open research →
              </Link>
            </div>
            {queue.running + queue.queued === 0 ? (
              <p className="text-muted-foreground mt-0.5">
                Research queue empty — an observed zero, not a stall. Intake adds work; the cycle drains it.
              </p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                <div>{queue.running} running · {queue.queued} queued{queue.dead > 0 ? ` · ${queue.dead} dead` : ""}</div>
                {[...runningJobs, ...queuedJobs].slice(0, 3).map((job) => (
                  <div key={job.id} className="text-muted-foreground truncate">{job.kind.replace(/_/g, " ")} #{job.id}</div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-panel/60 px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-terminal">● Testing</div>
              <Link href="/experiments" className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="brain-activity-link-testing">
                Open experiments →
              </Link>
            </div>
            {latestRun ? (
              <p className="mt-0.5">
                Last cycle rehearsed {latestRun.rehearsed} strategy(ies); {latestRun.wouldPass} would pass the
                gauntlet{rehearsing > 0 ? `; ${rehearsing} mid-validation` : ""}.
              </p>
            ) : (
              <p className="text-muted-foreground mt-0.5">No cycle has run in this database yet.</p>
            )}
          </div>

          <div className="border border-panel/60 px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-amber">● Waiting for evidence</div>
              <Link href="/paper" className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="brain-activity-link-forward">
                Open forward →
              </Link>
            </div>
            {awaitingEvidence.length === 0 ? (
              <p className="text-muted-foreground mt-0.5">No active forward challenger — forward evidence accumulates only after activation.</p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {awaitingEvidence.slice(0, 3).map((entry) => (
                  <div key={entry.name}>
                    {entry.name}: {entry.signals}/{entry.needed} forward signal(s) · {entry.verdict}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-panel/60 px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-loss">● Rejected</div>
              <Link href="/strategies" className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="brain-activity-link-graveyard">
                Open graveyard →
              </Link>
            </div>
            {recentBurials.length === 0 ? (
              <p className="text-muted-foreground mt-0.5">Nothing buried yet in this database.</p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {recentBurials.map((grave) => (
                  <div key={grave.name} className="truncate">
                    {grave.name} — <span className="text-muted-foreground">{grave.reasons[0] ?? "unrecorded"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-panel/60 px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-amber">● Data jobs owed</div>
              <Link href="/data-quality" className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="brain-activity-link-data">
                Open readiness →
              </Link>
            </div>
            {dataGaps.length === 0 ? (
              <p className="text-muted-foreground mt-0.5">No missing data area — every readiness item is at least partial.</p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {dataGaps.slice(0, 3).map((item) => (
                  <div key={item.area} className="truncate">
                    {item.area} — <span className="text-muted-foreground">{item.fixedBy}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-panel/60 px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-gain">● Next</div>
              <Link href={guidance.href} className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="brain-activity-link-next">
                Open →
              </Link>
            </div>
            <p className="mt-0.5">
              {guidance.title} <span className="text-muted-foreground">— {guidance.needsYou ? "needs you" : "runs on its own"}</span>
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="CURRENT AUTONOMOUS WORK — THE AUDIT TRAIL, NOT A PROMISE">
        <div className="p-3 space-y-1 text-[10px] font-mono" data-testid="brain-work">
          {recentWork.length === 0 ? (
            <p className="text-muted-foreground">No autonomous action recorded yet — the cycle has not run in this database.</p>
          ) : (
            recentWork.map((event) => (
              <div key={event.id} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">
                  {event.createdAt instanceof Date ? event.createdAt.toISOString().slice(5, 16) : String(event.createdAt)}
                </span>
                <span className="shrink-0">{event.action}</span>
                <span className={event.decision === "denied" ? "text-loss shrink-0" : "text-gain shrink-0"}>{event.decision}</span>
                <span className="text-muted-foreground truncate">{(event.detail ?? "").slice(0, 110)}</span>
              </div>
            ))
          )}
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-3">
        <Panel title="STRATEGY FAMILIES — THE RESEARCH TREE">
          <div className="p-3 text-[11px] space-y-1" data-testid="brain-families">
            {families.length === 0 ? (
              <p className="text-muted-foreground">No declared family yet. The professor path creates one per hypothesis.</p>
            ) : (
              families.slice(0, 12).map((family) => (
                <div key={family.id}>
                  <span className="font-bold">{family.name}</span>{" "}
                  <span className="text-muted-foreground text-[10px]">
                    {memberCounts.get(family.id) ?? 0} version(s) · {family.economicHypothesis.slice(0, 80)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="GRAVEYARD — WHY STRATEGIES DIED (FAILURE IS EVIDENCE)">
          <div className="p-3 text-[11px] space-y-1" data-testid="brain-graveyard">
            {deathReasons.size === 0 ? (
              <p className="text-muted-foreground">
                Nothing buried yet — an observed zero: no strategy has failed the gauntlet in this database.
              </p>
            ) : (
              [...deathReasons.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <div key={reason} className="flex justify-between">
                    <span>{reason}</span>
                    <span className="text-loss font-mono">{count}</span>
                  </div>
                ))
            )}
          </div>
        </Panel>
      </div>

      <Panel title="ALPHA HEALTH — HISTORICAL → SHADOW → PAPER">
        <div className="p-3 text-[11px] space-y-1" data-testid="brain-alpha">
          {health.length === 0 ? (
            <p className="text-muted-foreground">
              No active challenger with evidence yet. Activation freezes a strategy and starts recording predictions
              before their outcomes exist.
            </p>
          ) : (
            health.map(({ challenger, health: entry }) => (
              <div key={challenger.id}>
                <span className="font-bold">{challenger.strategySpecId}</span>{" "}
                <span
                  className={
                    entry!.status === "HEALTHY" ? "text-gain" : entry!.status === "INSUFFICIENT_EVIDENCE" ? "text-amber" : "text-loss"
                  }
                >
                  {entry!.status}
                </span>{" "}
                <span className="text-muted-foreground text-[10px]">{entry!.reasons[0]}</span>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel title="SYSTEM READINESS — WHAT IS READY, WHAT IS MISSING, AND WHICH JOB FIXES IT">
        <div className="p-3 space-y-1.5 text-[11px]" data-testid="brain-readiness">
          {readiness.items.map((item) => (
            <div key={item.area} data-testid="readiness-item">
              <span className={`font-bold ${statusTone(item.status)}`}>{item.status}</span>{" "}
              <span className="font-bold">{item.area}</span>{" "}
              <span className="text-muted-foreground">— {item.detail}</span>
              {item.fixedBy ? <span className="text-amber text-[10px]"> Fixed by: {item.fixedBy}</span> : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
