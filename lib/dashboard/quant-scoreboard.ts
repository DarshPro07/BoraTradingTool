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

/** One row of the owner's family-comparison table — which IDEA families deserve further work. */
export interface FamilyComparisonRow {
  familyId: string;
  name: string;
  campaignId: string;
  campaignName: string;
  /** selection_trials rows for this family — its share of the DSR denominator. */
  trials: number;
  /** Specs in this family whose LATEST validation passed. */
  gauntletPass: number;
  /** holdout_results passed for this family (family-level, one-shot per generation). */
  holdoutPass: number;
  /** Resolved forward-signal outcomes via this family's challengers. */
  forwardResolved: number;
  /** Sum of paper netPnl via this family's challengers; null when nothing closed ("—"). */
  paperNet: number | null;
  /** Worst holdout max-drawdown recorded for the family; null when never evaluated ("—"). */
  maxDrawdown: number | null;
}

/**
 * The owner's behavioral rule (2026-08-15), as a read model: "nothing survived" triggers
 * ANALYSIS of the typed rejection distribution, never parameter generation until something
 * passes. Each entry states its threshold and its evidence — a diagnosis the reader can check.
 */
export interface RejectionDiagnosis {
  signal: string;
  evidence: string;
  reading: string;
}

export function familyComparison(): FamilyComparisonRow[] {
  const db = getDb();
  const families = db.select().from(schema.strategyFamilies).all();
  if (families.length === 0) return [];
  const campaignNames = new Map(db.select().from(schema.researchCampaigns).all().map((c) => [c.id, c.name]));

  const trialsByFamily = new Map<string, number>();
  for (const trial of db.select().from(schema.selectionTrials).all()) {
    trialsByFamily.set(trial.strategyFamilyId, (trialsByFamily.get(trial.strategyFamilyId) ?? 0) + 1);
  }

  // Latest validation per spec → family via strategy_identity.
  const familyBySpec = new Map(
    db.select().from(schema.strategyIdentity).all().map((row) => [row.strategySpecId, row.strategyFamilyId]),
  );
  const latestBySpec = new Map<string, { passed: number; at: number }>();
  for (const validation of db.select().from(schema.validationResults).all()) {
    const held = latestBySpec.get(validation.strategySpecId);
    const at = validation.evaluatedAt.getTime();
    if (!held || at > held.at) latestBySpec.set(validation.strategySpecId, { passed: validation.passed, at });
  }
  const gauntletPassByFamily = new Map<string, number>();
  for (const [specId, latest] of latestBySpec) {
    if (latest.passed !== 1) continue;
    const familyId = familyBySpec.get(specId);
    if (!familyId) continue;
    gauntletPassByFamily.set(familyId, (gauntletPassByFamily.get(familyId) ?? 0) + 1);
  }

  const holdoutPassByFamily = new Map<string, number>();
  const worstDrawdownByFamily = new Map<string, number>();
  for (const result of db.select().from(schema.holdoutResults).all()) {
    if (result.passed === 1) {
      holdoutPassByFamily.set(result.strategyFamilyId, (holdoutPassByFamily.get(result.strategyFamilyId) ?? 0) + 1);
    }
    if (result.maxDrawdown !== null) {
      const held = worstDrawdownByFamily.get(result.strategyFamilyId);
      if (held === undefined || result.maxDrawdown > held) {
        worstDrawdownByFamily.set(result.strategyFamilyId, result.maxDrawdown);
      }
    }
  }

  const familyByChallenger = new Map(
    db.select().from(schema.forwardChallengers).all().map((row) => [row.id, row.strategyFamilyId]),
  );
  const challengerBySignal = new Map(
    db.select().from(schema.forwardSignals).all().map((row) => [row.id, row.challengerId]),
  );
  const forwardResolvedByFamily = new Map<string, number>();
  for (const outcome of db.select().from(schema.forwardSignalOutcomes).all()) {
    const challengerId = challengerBySignal.get(outcome.signalId);
    const familyId = challengerId ? familyByChallenger.get(challengerId) : undefined;
    if (!familyId) continue;
    forwardResolvedByFamily.set(familyId, (forwardResolvedByFamily.get(familyId) ?? 0) + 1);
  }

  const paperNetByFamily = new Map<string, number>();
  for (const position of db.select().from(schema.paperPositionOutcomes).all()) {
    const familyId = familyByChallenger.get(position.challengerId);
    if (!familyId) continue;
    paperNetByFamily.set(familyId, (paperNetByFamily.get(familyId) ?? 0) + position.netPnl);
  }

  return families
    .map((family) => ({
      familyId: family.id,
      name: family.name,
      campaignId: family.researchCampaignId,
      campaignName: campaignNames.get(family.researchCampaignId) ?? family.researchCampaignId,
      trials: trialsByFamily.get(family.id) ?? 0,
      gauntletPass: gauntletPassByFamily.get(family.id) ?? 0,
      holdoutPass: holdoutPassByFamily.get(family.id) ?? 0,
      forwardResolved: forwardResolvedByFamily.get(family.id) ?? 0,
      paperNet: paperNetByFamily.get(family.id) ?? null,
      maxDrawdown: worstDrawdownByFamily.get(family.id) ?? null,
    }))
    .sort(
      (a, b) =>
        b.gauntletPass - a.gauntletPass || b.trials - a.trials || a.name.localeCompare(b.name),
    );
}

/** Thresholds are the owner's (2026-08-15); each diagnosis prints its own evidence. */
export function rejectionDiagnosis(): RejectionDiagnosis[] {
  const db = getDb();
  const failed = db.select().from(schema.trials).all().filter((trial) => trial.verdict === "fail");
  const diagnoses: RejectionDiagnosis[] = [];

  if (failed.length >= 5) {
    const byKind = new Map<string, number>();
    for (const trial of failed) byKind.set(trial.kind, (byKind.get(trial.kind) ?? 0) + 1);
    const share = (kind: string) => (byKind.get(kind) ?? 0) / failed.length;
    if (share("cost_stress") >= 0.8) {
      diagnoses.push({
        signal: "cost-negative dominant",
        evidence: `${byKind.get("cost_stress")}/${failed.length} failed trials are cost_stress (threshold 80%)`,
        reading: "family economics probably weak — the edge does not clear the cost stack; do not re-parameterize",
      });
    }
    if (share("parameter_stability") >= 0.7) {
      diagnoses.push({
        signal: "parameter-instability dominant",
        evidence: `${byKind.get("parameter_stability")}/${failed.length} failed trials are parameter_stability (threshold 70%)`,
        reading: "the hypothesis may be fragile — neighboring configurations disagree; more tuning cannot fix that",
      });
    }
  }

  const validations = db.select().from(schema.validationResults).all();
  const highPbo = validations.filter((validation) => validation.pbo !== null && validation.pbo > 0.5);
  if (highPbo.length >= 2) {
    diagnoses.push({
      signal: "PBO repeatedly high",
      evidence: `${highPbo.length} validation(s) with PBO above the 0.5 gate`,
      reading: "the search process is too flexible — NARROW the search space; never widen it to find a survivor",
    });
  }

  const holdoutFails = db.select().from(schema.holdoutResults).all().filter((result) => result.passed !== 1);
  if (holdoutFails.length >= 1) {
    diagnoses.push({
      signal: "holdout degradation",
      evidence: `${holdoutFails.length} family-level holdout evaluation(s) failed after passing development`,
      reading: "development overfit — the answer is fewer trials and stricter gates, not more configurations",
    });
  }

  return diagnoses;
}

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
