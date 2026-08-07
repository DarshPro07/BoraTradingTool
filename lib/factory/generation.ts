import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Candle } from "@/lib/providers/types";
import { compileStrategy, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { breedGeneration, logicIdentity } from "./breed";
import { screenPopulation } from "./screen";

/**
 * One turn of the factory: breed → screen → record survivors.
 *
 * The gauntlet is deliberately **not** here. Every gauntlet run permanently raises the statistical
 * bar for that strategy family, and running one on a fifteen-minute timer would burn the family's
 * budget on nobody's instruction. Breeding and screening cost nothing but compute; the gauntlet
 * costs evidence. Survivors land as `draft` and wait for the owner.
 *
 * ## The number that makes this honest
 *
 * `selectionCost` — how many candidates were evaluated to choose these survivors. Screening 100
 * and gauntleting the best is 100 trials, not one. It is recorded on the generation event so that
 * when the owner eventually runs the gauntlet, the denominator is a fact on the record rather than
 * a reconstruction. Losing it would make every subsequent deflated Sharpe an overstatement.
 *
 * No new table: `lib/db/migrate.ts` holds a hardcoded migration list and is owner-reviewed, so a
 * new migration would never be applied. `audit_events` already records governed decisions with
 * actor, action and timestamp, and a generation is exactly that — it spends trial budget.
 */

export const GENERATION_ACTION = "factory_generation";

/** Bred per generation. The reel this is modelled on shows 200; 100 keeps a cycle inside a minute. */
export const POPULATION = 100;

export interface GenerationReport {
  generation: number;
  bred: number;
  attempts: number;
  rediscovered: number;
  duplicates: number;
  screened: number;
  survivors: string[];
  /** The multiple-testing denominator these survivors were chosen from. */
  selectionCost: number;
  skipped: string | null;
}

function parseDsl(raw: string): StrategyDsl | null {
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Next generation number, read from the audit log rather than a counter that could drift. */
export function currentGeneration(): number {
  const last = getDb()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, GENERATION_ACTION))
    .orderBy(desc(schema.auditEvents.id))
    .limit(1)
    .all()[0];
  if (!last?.detail) return 0;
  try {
    const parsed = JSON.parse(last.detail) as { generation?: unknown };
    return typeof parsed.generation === "number" ? parsed.generation : 0;
  } catch {
    return 0;
  }
}

/**
 * Picks the longest series in the dataset to screen against.
 *
 * A single instrument, because screening is a *cheap pre-filter* whose only job is to rank a
 * hundred candidates before the expensive stage. Screening every candidate across every instrument
 * would cost more than the gauntlet it exists to protect. The survivors are re-evaluated across
 * the full universe during rehearsal, where the position cap actually binds.
 */
function referenceSeries(dataset: Readonly<Record<string, readonly Candle[]>>): readonly Candle[] {
  let longest: readonly Candle[] = [];
  for (const bars of Object.values(dataset)) {
    if (bars.length > longest.length) longest = bars;
  }
  return longest;
}

export interface RunGenerationOptions {
  dataset: Readonly<Record<string, readonly Candle[]>>;
  size?: number;
  now?: Date;
  /** Deterministic seed. Defaults to the generation number, so a pass can be replayed. */
  seed?: number;
}

export function runFactoryGeneration(options: RunGenerationOptions): GenerationReport {
  const db = getDb();
  const generation = currentGeneration() + 1;
  const size = options.size ?? POPULATION;
  const now = options.now ?? new Date();

  const empty: GenerationReport = {
    generation,
    bred: 0,
    attempts: 0,
    rediscovered: 0,
    duplicates: 0,
    screened: 0,
    survivors: [],
    selectionCost: 0,
    skipped: null,
  };

  const bars = referenceSeries(options.dataset);
  // Refused rather than run on a short series. Screening a hundred candidates against sixty bars
  // ranks them on noise, and the ranking is what decides who costs a gauntlet trial.
  if (bars.length < 250) {
    return {
      ...empty,
      skipped: `Only ${bars.length} bars available; a generation needs at least 250 to rank candidates on anything but noise.`,
    };
  }

  const specs = db.select().from(schema.strategySpecs).all();
  const parents: { name: string; dsl: StrategyDsl }[] = [];
  const buried = new Set<string>();
  const living = new Set<string>();

  for (const spec of specs) {
    const dsl = parseDsl(spec.dsl);
    if (!dsl) continue;
    const identity = logicIdentity(dsl);
    if (spec.status === "rejected") {
      buried.add(identity);
      continue;
    }
    living.add(identity);
    parents.push({ name: spec.name, dsl });
  }

  const bred = breedGeneration({
    parents,
    buriedIdentities: buried,
    livingIdentities: living,
    size,
    generation,
    seed: options.seed ?? generation,
  });

  if (bred.candidates.length === 0) {
    return { ...empty, attempts: bred.attempts, skipped: "Nothing new could be bred this pass." };
  }

  const screen = screenPopulation(bred.candidates, bars);

  const survivors: string[] = [];
  for (const winner of screen.survivors) {
    const candidate = bred.candidates.find((entry) => entry.id === winner.id);
    if (!candidate) continue;
    const compiled = compileStrategy(candidate.dsl);
    if (!compiled.ok) continue;

    const id = `spec_${logicIdentity(candidate.dsl).slice(0, 16)}`;
    db.insert(schema.strategySpecs)
      .values({
        id,
        hypothesisId: null,
        parentId: null,
        name: candidate.id,
        version: 1,
        dsl: JSON.stringify(candidate.dsl),
        dslHash: compiled.hash,
        // Draft, never promoted. Promotion requires the gauntlet, and the gauntlet is the owner's
        // deliberate act — it spends evidence that cannot be recovered.
        status: "draft",
        createdBy: `factory:gen${generation}`,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    survivors.push(id);
  }

  const report: GenerationReport = {
    generation,
    bred: bred.candidates.length,
    attempts: bred.attempts,
    rediscovered: bred.rediscovered,
    duplicates: bred.duplicates,
    screened: screen.scored.length,
    survivors,
    selectionCost: screen.selectionCost,
    skipped: null,
  };

  db.insert(schema.auditEvents)
    .values({
      actor: "strategy-factory",
      action: GENERATION_ACTION,
      decision: "allowed",
      subject: `gen${generation}`,
      detail: JSON.stringify(report),
      learningMode: "evolving",
      createdAt: now,
    })
    .run();

  return report;
}
