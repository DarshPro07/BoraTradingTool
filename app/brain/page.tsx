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
import { familyComparison, quantScoreboard, rejectionDiagnosis } from "@/lib/dashboard/quant-scoreboard";
import { universeCoverage } from "@/lib/market/universe-coverage";
import { familyReadiness } from "@/lib/market/family-readiness";
import { ingestionHealth } from "@/lib/market/bar-ingestion-ledger";
import { NSE_QC_001 } from "@/lib/strategy/campaigns/nse-qc-001";
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

  // The primary scoreboard (owner directive 2026-08-15): the quant funnel over the ledgers.
  const board = quantScoreboard();
  const familyRows = familyComparison();
  const diagnoses = rejectionDiagnosis();
  // Data coverage (owner directive 2026-08-16): the bottleneck, measured — never extrapolated.
  const coverage = universeCoverage();
  // The metric that decides when spending trials is meaningful (owner, 2026-08-16): not a global
  // percentage but whether EACH family's own data requirement is met across the universe.
  const familyData = familyReadiness(NSE_QC_001.families, coverage);
  const fetchHealth = ingestionHealth(5);

  return (
    <div className="p-4 space-y-3 max-w-6xl mx-auto" data-testid="brain-page">
      {/* The one button. Everything beneath the governance ceiling runs itself after this. */}
      <Panel title="MARKETPULSE — AUTONOMOUS RUNTIME">
        <AutonomousControl profile={RUNTIME_PROFILES[0]} />
      </Panel>

      {/* THE PRIMARY QUESTION (owner directive 2026-08-15): quant quality, not build metrics.
          Every count names its basis; ratios over nothing render "—", never a fake 0. */}
      <Panel title="QUANT SCOREBOARD — A REPEATABLE NET POSITIVE NSE EDGE, OR THE HONEST ABSENCE OF ONE">
        <div className="p-3 space-y-3 text-[11px]" data-testid="brain-quant-scoreboard">
          <p className="text-[10px] text-muted-foreground">{board.question}</p>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2" data-testid="quant-funnel">
            {board.funnel.map((stage) => (
              <div key={stage.key} className="flex items-baseline justify-between gap-2" data-testid={`quant-funnel-${stage.key}`} title={stage.basis}>
                <span>{stage.label}</span>
                <span className="tabular-nums font-bold">{stage.count}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-border pt-2">
            <div>
              <div className="text-muted-foreground text-[10px]">CAMPAIGNS / FAMILIES</div>
              <div className="tabular-nums">{board.campaigns.open} open of {board.campaigns.total} · {board.families} families</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">TRIALS SPENT (DSR DENOMINATOR)</div>
              <div className="tabular-nums">{board.trialsSpent} configuration(s), permanently</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">HOLDOUT</div>
              <div className="tabular-nums">{board.holdout.generations} sealed · {board.holdout.evaluations} evaluated · {board.holdout.passed} passed</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">FORWARD</div>
              <div className="tabular-nums">{board.forward.challengers} enrolled · {board.forward.signals} signals · {board.forward.resolved} resolved</div>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 border-t border-border pt-2">
            <div data-testid="quant-rejections">
              <div className="text-muted-foreground text-[10px]">GAUNTLET REJECTIONS — BY TYPED STAGE</div>
              {board.gauntletRejections.length === 0 ? (
                <div className="text-muted-foreground">none recorded yet — no configuration has failed a gauntlet stage</div>
              ) : (
                board.gauntletRejections.map((rejection) => (
                  <div key={rejection.kind} className="flex justify-between gap-2">
                    <span>{rejection.kind}</span>
                    <span className="tabular-nums">{rejection.count}</span>
                  </div>
                ))
              )}
              <div className="flex justify-between gap-2 text-muted-foreground">
                <span>graveyard (all causes, permanent)</span>
                <span className="tabular-nums">{board.graveyardCount}</span>
              </div>
            </div>
            <div data-testid="quant-paper-net">
              <div className="text-muted-foreground text-[10px]">PAPER — NET AFTER ALL MODELLED COSTS</div>
              <div className="tabular-nums">
                {board.paper.closedPositions} closed · gross ₹{board.paper.grossPnl.toFixed(2)} − fees ₹{board.paper.fees.toFixed(2)} ={" "}
                <span className={board.paper.netPnl > 0 ? "text-gain" : board.paper.netPnl < 0 ? "text-loss" : ""}>net ₹{board.paper.netPnl.toFixed(2)}</span>
              </div>
              <div className="tabular-nums text-muted-foreground">
                expectancy/trade {board.paper.netExpectancyPerTrade === null ? "—" : `₹${board.paper.netExpectancyPerTrade.toFixed(2)}`} · cost share of gross{" "}
                {board.paper.costShareOfGross === null ? "—" : `${(board.paper.costShareOfGross * 100).toFixed(1)}%`}
              </div>
              <div className="text-muted-foreground text-[10px] mt-1">SURVIVORS — LATEST VALIDATION PASSED</div>
              {board.survivors.length === 0 ? (
                <div className="text-muted-foreground" data-testid="quant-survivors-empty">
                  none — no strategy currently holds a passing validation (an honest zero, not a failure of the page)
                </div>
              ) : (
                board.survivors.slice(0, 5).map((survivor) => (
                  <div key={survivor.specId} className="flex flex-wrap justify-between gap-x-2" data-testid="quant-survivor-row">
                    <span className="break-all">{survivor.name}</span>
                    <span className="tabular-nums">
                      DSR {survivor.deflatedSharpe?.toFixed(2) ?? "—"} · PBO {survivor.pbo?.toFixed(2) ?? "—"} · OOS PF {survivor.oosProfitFactor?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* v2: which IDEA families deserve further research — not which backtest looked best. */}
          <div className="border-t border-border pt-2 overflow-x-auto" data-testid="quant-family-comparison">
            <div className="text-muted-foreground text-[10px]">FAMILY COMPARISON — POOL (CANDIDATES · REHEARSED · READY) · TRIALS · GAUNTLET · HOLDOUT · FORWARD · PAPER NET · MAX DD</div>
            {familyRows.length === 0 ? (
              <div className="text-muted-foreground">no registered families yet</div>
            ) : (
              <table className="w-full text-[10px] tabular-nums">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="pr-2 font-normal">Family</th>
                    <th className="pr-2 font-normal">Campaign</th>
                    <th className="pr-2 font-normal text-right" title="candidates / rehearsed / ready for gauntlet — prepared without spending trials">Pool C/R/G</th>
                    <th className="pr-2 font-normal text-right">Trials</th>
                    <th className="pr-2 font-normal text-right">Gauntlet</th>
                    <th className="pr-2 font-normal text-right">Holdout</th>
                    <th className="pr-2 font-normal text-right">Forward</th>
                    <th className="pr-2 font-normal text-right">Paper net</th>
                    <th className="font-normal text-right">Max DD</th>
                  </tr>
                </thead>
                <tbody>
                  {familyRows.map((row) => (
                    <tr key={row.familyId} data-testid="quant-family-row">
                      <td className="pr-2 break-all">{row.name}</td>
                      <td className="pr-2">{row.campaignName}</td>
                      <td className="pr-2 text-right">{row.candidates}/{row.rehearsed}/{row.readyForGauntlet}</td>
                      <td className="pr-2 text-right">{row.trials}</td>
                      <td className="pr-2 text-right">{row.gauntletPass}</td>
                      <td className="pr-2 text-right">{row.holdoutPass}</td>
                      <td className="pr-2 text-right">{row.forwardResolved}</td>
                      <td className={`pr-2 text-right ${row.paperNet !== null && row.paperNet > 0 ? "text-gain" : row.paperNet !== null && row.paperNet < 0 ? "text-loss" : ""}`}>
                        {row.paperNet === null ? "—" : `₹${row.paperNet.toFixed(2)}`}
                      </td>
                      <td className="text-right">{row.maxDrawdown === null ? "—" : `${(row.maxDrawdown * 100).toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* The owner's behavioral rule: no survivor-optimization — read the rejections instead. */}
          <div className="border-t border-border pt-2" data-testid="quant-diagnosis">
            <div className="text-muted-foreground text-[10px]">WHEN NOTHING SURVIVES — READ THE REJECTIONS, NEVER TUNE UNTIL SOMETHING PASSES</div>
            {diagnoses.length === 0 ? (
              <div className="text-muted-foreground">no diagnosis yet — fewer than the evidence thresholds require, or nothing failing</div>
            ) : (
              diagnoses.map((diagnosis) => (
                <div key={diagnosis.signal} className="flex flex-wrap gap-x-2" data-testid="quant-diagnosis-row">
                  <span className="font-bold uppercase text-[10px]">{diagnosis.signal}</span>
                  <span className="text-muted-foreground">{diagnosis.evidence}</span>
                  <span>→ {diagnosis.reading}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </Panel>

      {/* The mission bottleneck (owner, 2026-08-16): coverage before trial spending. Every number
          counts the exchange's own taxonomy; SME is a SEPARATE universe, reported beside. */}
      <Panel title="NSE DATA COVERAGE — THE ELIGIBLE UNIVERSE, MEASURED">
        <div className="p-3 space-y-2 text-[11px]" data-testid="brain-data-coverage">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <div className="text-muted-foreground text-[10px]">TRADABLE RESEARCH UNIVERSE (EQ MAIN BOARD)</div>
              <div className="tabular-nums font-bold">{coverage.mainBoard.total}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">RESEARCH READY (≥{coverage.thresholds.research} D BARS)</div>
              <div className="tabular-nums" data-testid="coverage-research-ready">
                {coverage.mainBoard.researchReady} · {coverage.mainBoard.researchCoveragePct}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">VALIDATION READY (≥{coverage.thresholds.validation} D BARS)</div>
              <div className="tabular-nums">
                {coverage.mainBoard.validationReady} · {coverage.mainBoard.validationCoveragePct}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">INTRADAY READY (≥{coverage.thresholds.intradaySessions} 5M SESSIONS)</div>
              <div className="tabular-nums">{coverage.mainBoard.intradayReady} — historical backfill + live accumulation</div>
            </div>
          </div>
          {/* THE trial-switch metric (owner, 2026-08-16): not a global %, but whether each
              family's own data requirement is met. Each row states its requirement and the gap. */}
          <div className="border-t border-border pt-2 overflow-x-auto" data-testid="coverage-family-readiness">
            <div className="text-muted-foreground text-[10px]">FAMILY-READY COVERAGE — NSE-QC-001, EACH AGAINST ITS OWN DECLARED REQUIREMENT</div>
            <table className="w-full text-[10px] tabular-nums">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="pr-2 font-normal">Family</th>
                  <th className="pr-2 font-normal">Requires</th>
                  <th className="pr-2 font-normal text-right">Ready</th>
                  <th className="pr-2 font-normal text-right">Coverage</th>
                  <th className="pr-2 font-normal text-right">Short on daily</th>
                  <th className="font-normal text-right">Short on 5m</th>
                </tr>
              </thead>
              <tbody>
                {familyData.map((row) => (
                  <tr key={row.familyId} data-testid="coverage-family-row">
                    <td className="pr-2 break-all">{row.name}</td>
                    <td className="pr-2" title={row.requirement.basis}>
                      {row.requirement.minDailyBars}d
                      {row.requirement.minIntradaySessions === null ? "" : ` + ${row.requirement.minIntradaySessions}×5m`}
                    </td>
                    <td className={`pr-2 text-right ${row.ready > 0 ? "text-gain" : ""}`}>{row.ready}</td>
                    <td className="pr-2 text-right">{row.coveragePct}%</td>
                    <td className="pr-2 text-right">{row.blockedOnDaily}</td>
                    <td className="text-right">{row.requirement.minIntradaySessions === null ? "—" : row.blockedOnIntraday}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fetch integrity: HTTP success is not a complete dataset. */}
          <div className="border-t border-border pt-2" data-testid="coverage-fetch-health">
            <div className="text-muted-foreground text-[10px]">FETCH INTEGRITY — REQUEST BESIDE RESPONSE</div>
            {fetchHealth === null ? (
              <div className="text-muted-foreground">
                ledger not registered — the pending migration awaits promotion (docs/plans/nse-data-coverage/pending-migration/); audits still travel in each ingest outcome
              </div>
            ) : fetchHealth.recorded === 0 ? (
              <div className="text-muted-foreground">no fetches recorded yet</div>
            ) : (
              <div className="tabular-nums">
                {Object.entries(fetchHealth.byCompleteness)
                  .map(([completeness, count]) => `${completeness} ${count}`)
                  .join(" · ")}
                {fetchHealth.unstatedIdentity > 0
                  ? ` · ${fetchHealth.unstatedIdentity} fetch(es) whose source stated no instrument identity`
                  : ""}
              </div>
            )}
          </div>

          <div className="grid gap-2 md:grid-cols-2 border-t border-border pt-2">
            <div data-testid="coverage-missing-reasons">
              <div className="text-muted-foreground text-[10px]">NOT YET RESEARCH-READY — BY TYPED REASON</div>
              {Object.entries(coverage.mainBoard.missingReasons)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => (
                  <div key={reason} className="flex justify-between gap-2">
                    <span>{reason}</span>
                    <span className="tabular-nums">{count}</span>
                  </div>
                ))}
              {Object.values(coverage.mainBoard.missingReasons).every((count) => count === 0) ? (
                <div className="text-muted-foreground">nothing missing — the main board is fully research-ready</div>
              ) : null}
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">SEGREGATED UNIVERSES (NEVER MERGED INTO NSE-QC RESEARCH)</div>
              <div className="tabular-nums">
                SME {coverage.tiers.SME} (its own future universe; {coverage.sme.researchReady} research-ready) ·
                surveillance-restricted {coverage.tiers.SURVEILLANCE_RESTRICTED} · ETF {coverage.tiers.ETF} ·
                REIT/InvIT {coverage.tiers.REIT_INVIT} · inactive {coverage.tiers.INACTIVE}
              </div>
              <div className="text-muted-foreground text-[10px] mt-1">
                BACKTEST READY (≥{coverage.thresholds.backtest} D BARS): <span className="tabular-nums">{coverage.mainBoard.backtestReady}</span> — validation floor is provisional until a live holdout definition supplies exact bars
              </div>
            </div>
          </div>
        </div>
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
