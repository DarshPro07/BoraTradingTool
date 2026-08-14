import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { advanceStrategy, type Advance, type Stage, type StageEvidence } from "./lifecycle";
import { costStanding, type CostVerdict } from "./cost-gate";
import { CostModelError } from "@/lib/paper/cost-model";
import { checkRediscovery } from "./graveyard";
import { holdoutStanding } from "./holdout";
import { StrategyDslSchema } from "./dsl";

/**
 * Where each strategy actually stands, and what it needs next.
 *
 * ## Why the stage is derived rather than stored
 *
 * The obvious design is a `stage` column advanced by the cycle. It is wrong here. The stage is
 * entirely a function of evidence that already exists in other tables — trials, validation
 * results, the graveyard, forward observations — so storing it creates a second fact about the
 * same thing, and the two will eventually disagree. When they do, there is no way to tell which
 * lied: the column says `validated` and the trial ledger says nothing ever ran, and both are
 * "in the database".
 *
 * Deriving it costs a few reads per cycle and makes disagreement impossible. A strategy is at
 * the rung its evidence puts it at, always.
 */

export interface Standing {
  specId: string;
  name: string;
  stage: Stage;
  advance: Advance;
  /** What the owner would have to do for it to move, when the system cannot move it alone. */
  blockedOn: "rehearsal" | "gauntlet" | "holdout" | "forward_observations" | "owner" | null;
}

/**
 * The cost verdict, or a stated block when the fee engine cannot price this market at all.
 * Exported (with an injectable standing fn) so the fail-closed branch is directly testable.
 */
export function costVerdictOrBlocked(dslJson: string, standing: (d: string) => CostVerdict = costStanding): CostVerdict {
  try {
    return standing(dslJson);
  } catch (caught) {
    if (caught instanceof CostModelError) {
      return {
        declaredBps: 0,
        requiredBps: Number.NaN,
        understated: true,
        reason:
          `Realistic economics cannot be computed: ${caught.message} Promotion is blocked until a ` +
          "fee schedule covers this market — an unpriceable result must not climb the ladder.",
      };
    }
    throw caught;
  }
}

/** Evidence for one strategy, gathered from the tables that already hold it. */
export function evidenceFor(specId: string, dslJson: string): StageEvidence {
  const db = getDb();

  const validations = db
    .select()
    .from(schema.validationResults)
    .where(eq(schema.validationResults.strategySpecId, specId))
    .orderBy(desc(schema.validationResults.evaluatedAt))
    .all();

  const latest = validations[0];

  let rediscovered = false;
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(dslJson));
    if (parsed.success) rediscovered = checkRediscovery(parsed.data).rediscovered;
  } catch {
    // A spec whose DSL will not parse cannot be checked against the graveyard. Treated as not
    // buried rather than buried — a parse failure is not evidence that an idea was tried.
  }

  // The holdout rung. Until this was read, `holdoutCleared` was never populated by anything, so
  // `advanceStrategy` stopped every strategy at `validated` with "the sealed holdout has not been
  // queried" — permanently, however much evidence accumulated. `undefined` and `false` are kept
  // distinct here because the ladder treats them oppositely: unasked is a stay, failed is a burial.
  const holdout = holdoutStanding(specId);

  // The cost rung. Read from the spec's own DSL rather than from a validation row, because the
  // question is not "what did the gauntlet measure" but "what market did it measure against" —
  // and every strategy bred before `lib/paper/capital.ts` was measured against a cheaper one.
  // 13b economics rule: when realistic costs CANNOT be computed (no fee schedule in force for
  // this market), promotion fails closed. The inspector may abstain per-trade for display;
  // a promotion decision may not proceed on unpriceable evidence.
  const cost: CostVerdict = costVerdictOrBlocked(dslJson);

  // The rehearsal's own verdict, read from where the cycle now records it.
  //
  // This previously inferred the verdict from a validation row — "a validation row exists only
  // because the gauntlet ran, so its presence *is* the rehearsal evidence". True as far as it
  // went, and it meant a strategy that had *only* been rehearsed had `undefined` here and could
  // never leave `draft`. The rehearsal ran every cycle, judged it, and was discarded. The ladder
  // was built for these four verdicts and was never given one.
  const rehearsed = db
    .select()
    .from(schema.rehearsalOutcomes)
    .where(eq(schema.rehearsalOutcomes.strategySpecId, specId))
    .get();

  return {
    costUnderstated: cost.understated,
    costReason: cost.understated ? cost.reason : undefined,
    // Rediscovery wins: a buried idea is buried whatever the replay says about it. Otherwise the
    // recorded rehearsal verdict, falling back to a gauntlet row for strategies validated before
    // rehearsals were persisted.
    rehearsalVerdict: rediscovered
      ? "rediscovered"
      : (rehearsed?.verdict as StageEvidence["rehearsalVerdict"]) ?? (latest ? "would_pass" : undefined),
    // `passed` is stored as an integer flag, not a boolean. Compared explicitly rather than
    // coerced, so a future 2 or -1 reads as false instead of as truthy.
    gauntletPassed: latest ? latest.passed === 1 : undefined,
    outOfSampleProfitFactor: latest?.oosProfitFactor ?? undefined,
    deflatedSharpe: latest?.deflatedSharpe ?? undefined,
    holdoutCleared: holdout.cleared ?? undefined,
    holdoutExhausted: holdout.exhausted,
  };
}

/**
 * The rung a strategy's evidence puts it at.
 *
 * Walks up from `draft` while the evidence permits, stopping at the first rung it cannot leave.
 * Bounded by the ladder's own length so a rule that ever returned "moved" without changing stage
 * could not spin here — a defect in `advanceStrategy` should surface as a wrong stage, never as
 * a hung cycle.
 */
export function currentStage(specId: string, dslJson: string): { stage: Stage; advance: Advance } {
  const evidence = evidenceFor(specId, dslJson);
  let stage: Stage = "draft";

  for (let step = 0; step < 8; step += 1) {
    const advance = advanceStrategy(stage, evidence, specId);
    if (!advance.moved) return { stage, advance };
    stage = advance.to;
    if (stage === "graveyard") return { stage, advance };
  }

  return { stage, advance: advanceStrategy(stage, evidence, specId) };
}

function blockedOn(stage: Stage, moved: boolean): Standing["blockedOn"] {
  if (moved) return null;
  switch (stage) {
    case "draft":
      return "rehearsal";
    case "rehearsed":
      return "gauntlet";
    case "validated":
      return "holdout";
    case "holdout_cleared":
    case "paper_forward":
      return "forward_observations";
    case "owner_review":
      return "owner";
    default:
      return null;
  }
}

/** Every strategy, with its rung and the reason it is there. */
export function standings(): Standing[] {
  const specs = getDb().select().from(schema.strategySpecs).all();

  return specs
    .map((spec) => {
      const { stage, advance } = currentStage(spec.id, spec.dsl);
      return {
        specId: spec.id,
        name: spec.name,
        stage,
        advance,
        blockedOn: blockedOn(stage, advance.moved),
      };
    })
    .sort((a, b) => {
      // Furthest along first — the ones nearest to being actionable are what the owner opened
      // the page to see. Graveyard entries sink.
      const rank = (standing: Standing) => (standing.stage === "graveyard" ? -1 : ORDER.indexOf(standing.stage));
      return rank(b) - rank(a);
    });
}

const ORDER: readonly Stage[] = [
  "draft",
  "rehearsed",
  "validated",
  "holdout_cleared",
  "paper_forward",
  "owner_review",
];

export interface PromotionPass {
  evaluated: number;
  /** Strategies whose evidence now puts them further along than `draft`. */
  advanced: { name: string; stage: Stage; because: string }[];
  buried: { name: string; because: string }[];
  /** What each stalled candidate is waiting for, counted. */
  waiting: Record<string, number>;
  /**
   * Gauntlet survivors with a NAMED next action: the durable `forward_enroll` job exists for
   * exactly these. Reported, never enqueued — the governance table has no autonomous action for
   * challenger activation, so starting the paper stage stays an explicit owner/API act.
   */
  forwardEnrollable: { specId: string; name: string }[];
  summary: string;
}

/**
 * Report the ladder for the whole registry — the cycle's contribution.
 *
 * Reports rather than mutates. Every rung this system can cross is crossed by evidence that
 * already gets written elsewhere (a validation row, a forward observation), so there is nothing
 * left for a promotion pass to persist. Its job is to say plainly what the evidence now means,
 * which is precisely what was missing when five strategies sat at `draft` and nothing said why.
 */
export function promotionPass(): PromotionPass {
  const all = standings();
  const advanced = all
    .filter((standing) => standing.stage !== "draft" && standing.stage !== "graveyard")
    .map((standing) => ({ name: standing.name, stage: standing.stage, because: standing.advance.because }));
  const buried = all
    .filter((standing) => standing.stage === "graveyard")
    .map((standing) => ({ name: standing.name, because: standing.advance.because }));

  const waiting: Record<string, number> = {};
  for (const standing of all) {
    if (standing.blockedOn === null) continue;
    waiting[standing.blockedOn] = (waiting[standing.blockedOn] ?? 0) + 1;
  }

  const waitingText = Object.entries(waiting)
    .map(([what, count]) => `${count} on ${what.replace(/_/g, " ")}`)
    .join(", ");

  // A `validated` stage IS the gauntlet-passed evidence (the ladder cannot reach it otherwise),
  // and `holdout_cleared` sits above it — both are enrollable; `activateChallenger` re-verifies
  // its own requirements at execution time.
  const forwardEnrollable = all
    .filter((standing) => standing.stage === "validated" || standing.stage === "holdout_cleared")
    .map((standing) => ({ specId: standing.specId, name: standing.name }));

  return {
    evaluated: all.length,
    advanced,
    buried,
    waiting,
    forwardEnrollable,
    summary:
      all.length === 0
        ? "No strategy exists to promote."
        : `${all.length} strategy(ies): ${advanced.length} past draft, ${buried.length} buried` +
          (waitingText ? `, waiting — ${waitingText}.` : "."),
  };
}
