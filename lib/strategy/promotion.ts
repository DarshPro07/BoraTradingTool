import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { advanceStrategy, type Advance, type Stage, type StageEvidence } from "./lifecycle";
import { checkRediscovery } from "./graveyard";
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

  return {
    // A validation row exists only because the gauntlet ran, so its presence *is* the rehearsal
    // evidence for anything that got that far.
    rehearsalVerdict: rediscovered ? "rediscovered" : latest ? "would_pass" : undefined,
    // `passed` is stored as an integer flag, not a boolean. Compared explicitly rather than
    // coerced, so a future 2 or -1 reads as false instead of as truthy.
    gauntletPassed: latest ? latest.passed === 1 : undefined,
    outOfSampleProfitFactor: latest?.oosProfitFactor ?? undefined,
    deflatedSharpe: latest?.deflatedSharpe ?? undefined,
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

  return {
    evaluated: all.length,
    advanced,
    buried,
    waiting,
    summary:
      all.length === 0
        ? "No strategy exists to promote."
        : `${all.length} strategy(ies): ${advanced.length} past draft, ${buried.length} buried` +
          (waitingText ? `, waiting — ${waitingText}.` : "."),
  };
}
