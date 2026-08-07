import { DERIVABLE_FEATURES } from "@/lib/backtest/features";
import { compileStrategy, type StrategyDsl } from "@/lib/strategy/dsl";
import { strategyIdentity } from "@/lib/strategy/graveyard";
import type { Candidate } from "./screen";

/**
 * The breed step — the missing arrow in this system's loop.
 *
 * `screenPopulation` ranks a population, `runGauntlet` tests survivors, and the graveyard buries
 * failures with rediscovery prevention. Nothing generated the population. So the registry held a
 * handful of hand-written specs, the learning cycle rehearsed the same ones forever, and
 * `inspectMemory` reported "N hypotheses have no strategy implementing them" on every pass — the
 * system detecting the gap and unable to close it.
 *
 * ## Why this is dangerous, and what makes it safe here
 *
 * Genetic search overfits by construction: it keeps whatever scores highest on the training
 * window, which on financial data is usually noise. Breed a thousand candidates, gauntlet the
 * winner, report its Sharpe, and you have built a machine for manufacturing false positives.
 *
 * The defence is not in this file — it already exists. `screenPopulation` returns `selectionCost`
 * and `runGauntlet` requires it back, so breeding 100 candidates and testing the best costs 100
 * trials rather than one. That is what stops the search from hiding somewhere the accounting
 * cannot see. This module's job is to feed that accounting honestly, not to be clever.
 *
 * ## Determinism
 *
 * Seeded, so a generation can be replayed exactly. `Math.random` would make a suspicious
 * population impossible to reproduce, and "we cannot reconstruct which candidates were evaluated"
 * destroys the trial count that the whole statistical argument rests on.
 */

/**
 * Identity of a candidate's *logic*, with the name stripped.
 *
 * `strategyIdentity` hashes the whole DSL, `name` included — so two specs that differ only in
 * what they are called hash differently and the graveyard treats the second as new. Bred
 * candidates are named `f<generation>_<lineage>_<n>`, which means the name changes every
 * generation by construction: without this, **every buried candidate would be rediscovered on the
 * next pass**, forever, each rediscovery spending a trial to relearn a known failure.
 *
 * Kept local rather than changing `strategyIdentity`, whose semantics the graveyard and its tests
 * already depend on. The wider hole it implies — that renaming a rejected strategy defeats the
 * rediscovery check for hand-written specs too — is real and worth fixing deliberately, not as a
 * side effect of adding a breeder.
 */
export function logicIdentity(dsl: StrategyDsl): string {
  const { name: _name, ...logic } = dsl;
  return strategyIdentity(logic as StrategyDsl);
}

/** Features a bred candidate may reference. Anything else cannot be derived from price bars. */
const USABLE = DERIVABLE_FEATURES.filter(
  // Raw price levels are excluded as *thresholds*: `close > 100` means something different for
  // every instrument in the universe, so a bred candidate using one is not a strategy, it is an
  // accident of whichever symbol it was bred against.
  (feature) => !["close", "open", "high", "low", "volume", "adv_20d"].includes(feature),
);

/** Oscillators and percentages, with the ranges a threshold may sensibly fall in. */
const THRESHOLDS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  rsi14: [15, 85],
  rvol: [0.5, 4],
  gap_pct: [-8, 8],
  momentum_20d: [-15, 15],
  momentum_60d: [-25, 25],
  distance_from_52w_high: [-40, 0],
  distance_from_52w_low: [0, 120],
  atr14: [0.5, 8],
});

/** Pairs where a crossing event is meaningful — a moving-average relationship, not a coincidence. */
const CROSS_PAIRS: readonly (readonly [string, string])[] = Object.freeze([
  ["sma20", "sma50"],
  ["sma50", "sma200"],
  ["ema12", "ema26"],
  ["sma20", "sma200"],
]);

const OPS = ["gt", "gte", "lt", "lte"] as const;

/**
 * Mulberry32. Small, fast, and — the only property that matters here — reproducible from a seed,
 * so a generation and its trial count can be reconstructed from the audit log alone.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

type Condition = StrategyDsl["entry"];

function randomLeaf(random: () => number): Condition {
  // A third of leaves are crossings. A population of pure threshold rules cannot express "the
  // fast average just crossed the slow one", which is the shape most of the seeded registry uses.
  if (random() < 0.34) {
    const [left, right] = pick(random, CROSS_PAIRS);
    return random() < 0.5
      ? ({ crossover: [left, right] } as Condition)
      : ({ crossunder: [left, right] } as Condition);
  }

  const feature = pick(random, Object.keys(THRESHOLDS));
  const [low, high] = THRESHOLDS[feature];
  return {
    feature,
    op: pick(random, OPS),
    value: round(low + random() * (high - low)),
  } as Condition;
}

function randomEntry(random: () => number): Condition {
  const leaves = 1 + Math.floor(random() * 2);
  if (leaves === 1) return randomLeaf(random);
  // `all`, not `any`: a disjunction of two loose thresholds fires almost every bar, which floods
  // the screen with high-turnover candidates that are really just "be in the market".
  return { all: [randomLeaf(random), randomLeaf(random)] } as Condition;
}

/** Perturbs one numeric threshold. Structure-preserving, so a mutant stays in its family. */
function mutateCondition(condition: Condition, random: () => number): Condition {
  if ("feature" in condition) {
    const range = THRESHOLDS[condition.feature];
    if (!range) return condition;
    const [low, high] = range;
    // ±15% of the range. Large enough to matter, small enough that a mutant is recognisably a
    // descendant rather than an unrelated candidate wearing its parent's lineage.
    const shifted = condition.value + (random() - 0.5) * 0.3 * (high - low);
    return { ...condition, value: round(Math.min(high, Math.max(low, shifted))) };
  }
  if ("all" in condition) {
    return { all: condition.all.map((child) => mutateCondition(child as Condition, random)) } as Condition;
  }
  if ("any" in condition) {
    return { any: condition.any.map((child) => mutateCondition(child as Condition, random)) } as Condition;
  }
  return condition;
}

function baseDsl(name: string, entry: Condition, random: () => number, market: string): StrategyDsl {
  return {
    name,
    universe: { market, maxPositions: 10 },
    entry,
    exit: {
      afterDays: 3 + Math.floor(random() * 12),
      stopLossPct: round(1.5 + random() * 6),
    },
    sizing: { maxPositionPct: 10 },
    // Never zero. A candidate bred at zero cost is optimised against a market that does not
    // charge for trading, and it will out-screen every honest one in the population.
    costs: { commissionBps: 3, slippageBps: 7 },
  } as StrategyDsl;
}

export interface BreedInput {
  /** Existing specs to mutate and cross. May be empty on a cold start. */
  parents: readonly { name: string; dsl: StrategyDsl }[];
  /** Identities already buried, so the graveyard is not re-excavated. */
  buriedIdentities: ReadonlySet<string>;
  /** Identities already in the registry, so a generation does not re-propose what exists. */
  livingIdentities: ReadonlySet<string>;
  size: number;
  generation: number;
  seed: number;
  market?: string;
}

export interface BreedReport {
  candidates: Candidate[];
  /** Discarded because they matched a buried strategy — the graveyard doing its job. */
  rediscovered: number;
  /** Discarded because an identical candidate already exists or was already bred this pass. */
  duplicates: number;
  /** Discarded because the compiler refused them. */
  uncompilable: number;
  /** Attempts made. Higher than `candidates.length` whenever anything was discarded. */
  attempts: number;
}

/**
 * Breeds a generation.
 *
 * Discards are counted rather than silently retried into oblivion: a run that produced 12
 * candidates from 400 attempts is telling you the search space is exhausted, and a report that
 * only showed "12 candidates" would hide that.
 *
 * A discarded candidate is **not** a trial. It produced no statistic, so it could not have been
 * selected on the strength of one — the same reasoning `screenPopulation` uses to exclude refusals
 * from `selectionCost`.
 */
export function breedGeneration(input: BreedInput): BreedReport {
  const random = rng(input.seed);
  const market = input.market ?? "US";
  const report: BreedReport = {
    candidates: [],
    rediscovered: 0,
    duplicates: 0,
    uncompilable: 0,
    attempts: 0,
  };

  const seen = new Set<string>(input.livingIdentities);
  // Bounded, so an exhausted search space ends the pass instead of spinning. Ten attempts per
  // wanted candidate is generous; needing more means the space is genuinely mined out.
  const budget = input.size * 10;

  while (report.candidates.length < input.size && report.attempts < budget) {
    report.attempts += 1;

    const parent = input.parents.length > 0 ? pick(random, input.parents) : null;
    let entry: Condition;
    let lineage: string;

    const roll = random();
    if (parent && roll < 0.45) {
      entry = mutateCondition(parent.dsl.entry as Condition, random);
      lineage = "mut";
    } else if (input.parents.length >= 2 && roll < 0.65) {
      // Crossover: one parent's entry conjoined with another's. Both halves have already survived
      // being written down, which is a weak prior but a better one than noise.
      const other = pick(random, input.parents);
      entry = { all: [parent!.dsl.entry, other.dsl.entry] } as Condition;
      lineage = "cross";
    } else {
      entry = randomEntry(random);
      lineage = "gen";
    }

    const name = `f${input.generation}_${lineage}_${report.candidates.length + 1}`;
    const dsl = baseDsl(name, entry, random, market);

    // The compiler is the authority on what is a strategy — including the lookahead refusal. A
    // breeder that emitted specs the compiler would reject would be filling the registry with
    // rows that can never be evaluated.
    const compiled = compileStrategy(dsl);
    if (!compiled.ok) {
      report.uncompilable += 1;
      continue;
    }

    const identity = logicIdentity(dsl);
    if (input.buriedIdentities.has(identity)) {
      // Re-testing the dead is how a search convinces itself it has explored.
      report.rediscovered += 1;
      continue;
    }
    if (seen.has(identity)) {
      report.duplicates += 1;
      continue;
    }

    seen.add(identity);
    report.candidates.push({ id: name, dsl });
  }

  return report;
}
