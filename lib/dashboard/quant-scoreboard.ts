import { getDb, schema } from "@/lib/db";
import { standings as realStandings, type Standing } from "@/lib/strategy/promotion";
import type { Stage } from "@/lib/strategy/lifecycle";

/**
 * The Quant Scoreboard — the primary question's read model (owner directive 2026-08-15):
 * "Can MarketPulse discover a repeatable NET positive NSE edge that survives independent
 * evidence?" One aggregation over the ledgers that already hold the answer's parts; nothing
 * here is stored, estimated, or fabricated.
 *
 * Honesty rules:
 *   - Every funnel count names its BASIS — the exact source it was counted from — because
 *     "universe scanned" from the securities master and "researched" from the agent-run ledger
 *     are different kinds of claim and must not blur.
 *   - Ladder rungs count from `standings()` — the evidence-DERIVED stage authority — never from
 *     a stored status field.
 *   - An empty database reads as zeros with the bases still stated; ratios over nothing are
 *     null, never 0 (a fake 0 expectancy would look like a measured break-even).
 *   - `trialsSpent` is the selection-trial ledger row count — the multiple-testing denominator
 *     DSR needs (every configuration tested, not just winners).
 */

export interface FunnelStageView {
  key: string;
  label: string;
  count: number;
  /** The exact counting source — the claim's basis, shown to the reader. */
  basis: string;
}

export interface SurvivorView {
  specId: string;
  name: string;
  deflatedSharpe: number | null;
  pbo: number | null;
  oosProfitFactor: number | null;
  costMultiplePf: number | null;
  evaluatedAt: string;
}

export interface QuantScoreboard {
  question: string;
  campaigns: { total: number; open: number };
  families: number;
  /** selection_trials rows — the DSR denominator: every configuration tested, ever. */
  trialsSpent: number;
  funnel: FunnelStageView[];
  /** trials with verdict=fail, grouped by stage kind, most frequent first. */
  gauntletRejections: { kind: string; count: number }[];
  graveyardCount: number;
  survivors: SurvivorView[];
  holdout: { generations: number; evaluations: number; passed: number };
  forward: { challengers: number; signals: number; resolved: number };
  paper: {
    closedPositions: number;
    grossPnl: number;
    fees: number;
    netPnl: number;
    /** netPnl / closedPositions; null when nothing closed — never a fake break-even 0. */
    netExpectancyPerTrade: number | null;
    /** fees / grossPnl; null when gross is 0 or negative (a share of nothing is not 0%). */
    costShareOfGross: number | null;
  };
}

export const SCOREBOARD_QUESTION =
  "Can MarketPulse discover a repeatable NET positive NSE edge that survives independent evidence?";

/** Ladder rungs at-or-beyond a stage, from the evidence-derived standings. */
const LADDER: Stage[] = ["draft", "rehearsed", "validated", "holdout_cleared", "paper_forward", "owner_review"];
function atOrBeyond(all: Standing[], stage: Stage): number {
  const floor = LADDER.indexOf(stage);
  return all.filter((s) => s.stage !== "graveyard" && LADDER.indexOf(s.stage) >= floor).length;
}

export function quantScoreboard(deps: { standings?: () => Standing[] } = {}): QuantScoreboard {
  const db = getDb();
  const ladder = (deps.standings ?? realStandings)();

  const campaigns = db.select().from(schema.researchCampaigns).all();
  const familyCount = db.select().from(schema.strategyFamilies).all().length;
  const trialsSpent = db.select().from(schema.selectionTrials).all().length;
  const universe = db.select().from(schema.nseSecurities).all().length;
  const researched = new Set(
    db
      .select({ instrumentId: schema.agentRuns.instrumentId, capability: schema.agentRuns.capability, status: schema.agentRuns.status })
      .from(schema.agentRuns)
      .all()
      .filter((row) => row.capability === "RESEARCH" && row.status === "COMPLETED")
      .map((row) => row.instrumentId)
      .filter((id): id is string => id !== null),
  ).size;
  const hypotheses = db.select().from(schema.researchHypotheses).all().length;
  const specs = db.select().from(schema.strategySpecs).all().length;

  const allTrials = db.select().from(schema.trials).all();
  const failCounts = new Map<string, number>();
  for (const trial of allTrials) {
    if (trial.verdict !== "fail") continue;
    failCounts.set(trial.kind, (failCounts.get(trial.kind) ?? 0) + 1);
  }

  const validations = db.select().from(schema.validationResults).all();
  const latestBySpec = new Map<string, (typeof validations)[number]>();
  for (const validation of validations) {
    const held = latestBySpec.get(validation.strategySpecId);
    if (!held || validation.evaluatedAt.getTime() > held.evaluatedAt.getTime()) {
      latestBySpec.set(validation.strategySpecId, validation);
    }
  }
  const specRows = db.select().from(schema.strategySpecs).all();
  const nameBySpec = new Map(specRows.map((spec) => [spec.id, spec.name]));
  const survivors: SurvivorView[] = [...latestBySpec.values()]
    .filter((validation) => validation.passed === 1)
    .map((validation) => ({
      specId: validation.strategySpecId,
      name: nameBySpec.get(validation.strategySpecId) ?? validation.strategySpecId,
      deflatedSharpe: validation.deflatedSharpe,
      pbo: validation.pbo,
      oosProfitFactor: validation.oosProfitFactor,
      costMultiplePf: validation.costMultiplePf,
      evaluatedAt: validation.evaluatedAt.toISOString(),
    }))
    .sort((a, b) => (b.deflatedSharpe ?? -Infinity) - (a.deflatedSharpe ?? -Infinity));

  const holdoutDefs = db.select().from(schema.holdoutDefinitions).all().length;
  const holdoutEvals = db.select().from(schema.holdoutResults).all();
  const challengers = db.select().from(schema.forwardChallengers).all().length;
  const signals = db.select().from(schema.forwardSignals).all().length;
  const resolved = db.select().from(schema.forwardSignalOutcomes).all().length;

  const positions = db.select().from(schema.paperPositionOutcomes).all();
  const grossPnl = positions.reduce((sum, p) => sum + p.grossPnl, 0);
  const fees = positions.reduce((sum, p) => sum + p.fees, 0);
  const netPnl = positions.reduce((sum, p) => sum + p.netPnl, 0);

  const funnel: FunnelStageView[] = [
    { key: "universe", label: "NSE universe scanned", count: universe, basis: "securities in the NSE master" },
    { key: "researched", label: "Research candidates", count: researched, basis: "distinct instruments with a COMPLETED research run" },
    { key: "hypotheses", label: "Hypotheses", count: hypotheses, basis: "research_hypotheses rows" },
    { key: "families", label: "Strategy families", count: familyCount, basis: "declared families across campaigns" },
    { key: "versions", label: "Strategy versions", count: specs, basis: "strategy_specs rows" },
    { key: "rehearsed", label: "Rehearsal pass", count: atOrBeyond(ladder, "rehearsed"), basis: "standings at rehearsed or beyond" },
    { key: "validated", label: "Gauntlet pass", count: atOrBeyond(ladder, "validated"), basis: "standings at validated or beyond" },
    { key: "holdout", label: "Sealed holdout pass", count: atOrBeyond(ladder, "holdout_cleared"), basis: "standings at holdout_cleared or beyond" },
    { key: "forward_enrolled", label: "Forward enrolled", count: challengers, basis: "forward challengers registered" },
    { key: "forward_resolved", label: "Forward resolved", count: resolved, basis: "forward signal outcomes" },
    { key: "paper", label: "Paper traded", count: positions.length, basis: "closed paper-forward positions" },
    { key: "net_positive", label: "Net positive evidence", count: atOrBeyond(ladder, "owner_review"), basis: "standings at owner_review — enough forward evidence to be worth the owner's attention" },
  ];

  return {
    question: SCOREBOARD_QUESTION,
    campaigns: { total: campaigns.length, open: campaigns.filter((c) => c.closedAt === null).length },
    families: familyCount,
    trialsSpent,
    funnel,
    gauntletRejections: [...failCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    graveyardCount: ladder.filter((s) => s.stage === "graveyard").length,
    survivors,
    holdout: {
      generations: holdoutDefs,
      evaluations: holdoutEvals.length,
      passed: holdoutEvals.filter((h) => h.passed === 1).length,
    },
    forward: { challengers, signals, resolved },
    paper: {
      closedPositions: positions.length,
      grossPnl,
      fees,
      netPnl,
      netExpectancyPerTrade: positions.length > 0 ? netPnl / positions.length : null,
      costShareOfGross: grossPnl > 0 ? fees / grossPnl : null,
    },
  };
}
