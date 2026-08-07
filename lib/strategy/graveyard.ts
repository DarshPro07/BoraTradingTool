import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { stableStringify } from "@/lib/util/stable-json";
import { StrategyDslSchema, type StrategyDsl } from "./dsl";

/**
 * The Strategy Graveyard — rejected strategies, why they died, and prevention of rediscovery.
 *
 * A graveyard that only lists the dead is a memorial. The part that earns its place is the
 * rediscovery check: proposing a strategy that is byte-for-byte one already rejected spends a
 * trial to learn something the system already knew, and every trial permanently raises the
 * statistical bar for that strategy family. Re-testing the dead is how a search process
 * convinces itself it has explored.
 *
 * No new table. A rejected `strategySpecs` row plus its failing `trials` rows already contain
 * every fact this needs, and deriving it means the graveyard cannot drift out of sync with the
 * ledger that is the actual source of truth.
 */

export interface GraveEntry {
  specId: string;
  name: string;
  version: number;
  /** Compiler-independent identity — see `strategyIdentity`. */
  identity: string;
  buriedAt: Date | null;
  /** The failing stages, as recorded in the trial ledger. */
  reasons: string[];
  /** How many trials this strategy consumed before it was rejected. */
  trialsSpent: number;
}

export type RediscoveryCheck =
  | { rediscovered: false }
  | {
      rediscovered: true;
      /** What to tell the proposer instead of running the gauntlet again. */
      message: string;
      entry: GraveEntry;
    };

/**
 * Identity of a strategy, independent of the compiler that produced it.
 *
 * `compileStrategy` hashes `{ compiler: COMPILER_VERSION, dsl }`, which is correct for
 * reproducibility — a stored result belongs to the compiler that produced it. It is wrong for
 * *identity*: bumping the compiler changes every stored hash, so a graveyard keyed on it would
 * empty itself on the next release and every buried strategy would look new.
 *
 * A strategy is the same strategy whatever compiled it, so identity hashes the DSL alone.
 */
export function strategyIdentity(dsl: StrategyDsl): string {
  return createHash("sha256").update(stableStringify(dsl), "utf8").digest("hex").slice(0, 32);
}

function parseDsl(raw: string): StrategyDsl | null {
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Statuses that mean "this was tried and did not survive". */
const BURIED_STATUSES = new Set(["rejected", "retired", "degraded"]);

export function listGraveyard(limit = 200): GraveEntry[] {
  const db = getDb();
  const specs = db
    .select()
    .from(schema.strategySpecs)
    .all()
    .filter((row) => BURIED_STATUSES.has(row.status));

  if (specs.length === 0) return [];

  const trials = db.select().from(schema.trials).orderBy(desc(schema.trials.id)).all();
  const bySpec = new Map<string, typeof trials>();
  for (const trial of trials) {
    const list = bySpec.get(trial.strategySpecId);
    if (list) list.push(trial);
    else bySpec.set(trial.strategySpecId, [trial]);
  }

  // Completed evaluations, not trial rows. A gauntlet run writes one trial row per gate, so
  // counting rows would report a strategy rejected in one run as having cost eight trials —
  // and it is the same distinction `countSelectionTrials` makes for the multiple-testing
  // denominator. Trial rows still supply the *reasons*; they just do not supply the count.
  const evaluations = new Map<string, number>();
  for (const row of db.select().from(schema.validationResults).all()) {
    evaluations.set(row.strategySpecId, (evaluations.get(row.strategySpecId) ?? 0) + 1);
  }

  return specs
    .map((spec) => {
      const own = bySpec.get(spec.id) ?? [];
      const failures = own.filter((trial) => trial.verdict === "fail");
      const dsl = parseDsl(spec.dsl);
      return {
        specId: spec.id,
        name: spec.name,
        version: spec.version,
        // A spec whose DSL no longer parses keeps its stored hash as identity. It cannot be
        // matched against a fresh proposal, and reporting that honestly beats a hash of "".
        identity: dsl ? strategyIdentity(dsl) : `unparseable:${spec.dslHash}`,
        buriedAt: own.map((trial) => trial.startedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        reasons: failures.map((trial) => trial.reason ?? trial.kind).filter(Boolean),
        trialsSpent: evaluations.get(spec.id) ?? 0,
      };
    })
    .sort((a, b) => (b.buriedAt?.getTime() ?? 0) - (a.buriedAt?.getTime() ?? 0))
    .slice(0, limit);
}

/**
 * Has this exact strategy already been buried?
 *
 * Takes the DSL rather than a hash so the caller cannot accidentally pass the compiler-bound
 * `dslHash` and get a permanent "no".
 */
export function checkRediscovery(dsl: StrategyDsl, graveyard = listGraveyard()): RediscoveryCheck {
  const identity = strategyIdentity(dsl);
  const entry = graveyard.find((grave) => grave.identity === identity);
  if (!entry) return { rediscovered: false };

  const when = entry.buriedAt ? ` on ${entry.buriedAt.toISOString().slice(0, 10)}` : "";
  const why = entry.reasons.length > 0 ? ` Rejected for: ${entry.reasons.join("; ")}.` : "";
  return {
    rediscovered: true,
    entry,
    message: `Identical to "${entry.name}" v${entry.version}, buried${when} after ${entry.trialsSpent} trial(s).${why} Re-testing it would spend another trial to learn what the ledger already records.`,
  };
}
