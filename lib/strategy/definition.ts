import type { CrossSectionalStrategy } from "@/lib/backtest/cross-sectional";
import { StrategyDslSchema, type StrategyDsl } from "./dsl";

/**
 * The two shapes a stored strategy can take, and how to tell them apart.
 *
 * ## Why there are two
 *
 * Four of NSE-QC-001's five declared families are per-instrument rules: "is the close beyond the
 * opening range?" is answerable for one symbol in isolation. The fifth ranks the universe — "hold
 * the top 10 by 60-day return" — which is a statement about a symbol's position RELATIVE to every
 * other symbol at the same instant, and no per-symbol predicate can carry it.
 *
 * The alternative to a second representation was approximating the rank with an absolute threshold
 * (`momentum_60d > 15`). That selects everything above a line rather than the best N, so the
 * position count varies with the market's mood instead of being the fixed, capacity-bounded
 * portfolio the family declares. It would have been a different strategy wearing the family's name.
 *
 * ## Why dispatch, not dual-parsing
 *
 * Every downstream reader used to `StrategyDslSchema.safeParse` the stored JSON and skip on
 * failure. That is safe — nothing misparses — but it is also silent: a cross-sectional spec would
 * simply never appear in a rehearsal, a funnel or a family count, and its absence would look like
 * a strategy that had not been tried rather than one the reader could not read.
 *
 * So the persistence boundary is typed. `kind` is the discriminator, and its ABSENCE means
 * `INSTRUMENT` — every row written before this existed is a DSL, and rewriting them to add a field
 * would edit history to make a parser's life easier.
 */

export type StrategyKind = "INSTRUMENT" | "CROSS_SECTIONAL";

export type StrategyDefinition =
  | { kind: "INSTRUMENT"; dsl: StrategyDsl }
  | { kind: "CROSS_SECTIONAL"; strategy: CrossSectionalStrategy };

export interface DefinitionRefusal {
  ok: false;
  code: "UNREADABLE_DEFINITION";
  message: string;
}

export type DefinitionResult = { ok: true; definition: StrategyDefinition } | DefinitionRefusal;

/** The marker written into stored JSON for a cross-sectional strategy. */
export const CROSS_SECTIONAL_KIND = "CROSS_SECTIONAL";

/**
 * Minimal structural check for the cross-sectional IR.
 *
 * Deliberately not a Zod schema mirroring every field: the IR is produced in this repository and
 * consumed here, so the risk being guarded is "an INSTRUMENT row was mislabelled", not "a
 * malicious payload". What must be certain is that the fields the engine dereferences exist.
 */
function readCrossSectional(value: Record<string, unknown>): CrossSectionalStrategy | null {
  const numeric = ["lookbackDays", "skipRecentDays", "topN", "rebalanceDays"] as const;
  for (const key of numeric) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) return null;
  }
  if (value.ranking !== "RAW_RETURN" && value.ranking !== "VOL_SCALED_RETURN") return null;
  if (value.direction !== "TOP" && value.direction !== "BOTTOM") return null;
  const universe = value.universe as { market?: unknown; resolution?: unknown } | undefined;
  if (!universe || typeof universe.market !== "string") return null;
  const costs = value.costs as { commissionBps?: unknown; slippageBps?: unknown } | undefined;
  if (!costs || typeof costs.commissionBps !== "number" || typeof costs.slippageBps !== "number") {
    return null;
  }
  return value as unknown as CrossSectionalStrategy;
}

/**
 * Read a stored strategy definition.
 *
 * Returns a typed refusal rather than throwing: an unreadable row is a fact about that row, and
 * one bad spec must not take down a rehearsal pass over all the others.
 */
export function parseStrategyDefinition(json: string): DefinitionResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, code: "UNREADABLE_DEFINITION", message: "stored definition is not valid JSON" };
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, code: "UNREADABLE_DEFINITION", message: "stored definition is not an object" };
  }

  const record = value as Record<string, unknown>;
  if (record.kind === CROSS_SECTIONAL_KIND) {
    const strategy = readCrossSectional(record);
    if (strategy === null) {
      return {
        ok: false,
        code: "UNREADABLE_DEFINITION",
        message:
          "row is marked CROSS_SECTIONAL but does not carry the fields the ranking engine needs " +
          "(lookbackDays, skipRecentDays, topN, rebalanceDays, ranking, direction, universe, costs)",
      };
    }
    return { ok: true, definition: { kind: "CROSS_SECTIONAL", strategy } };
  }

  // No marker means INSTRUMENT: every row written before the discriminator existed is a DSL.
  const parsed = StrategyDslSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      code: "UNREADABLE_DEFINITION",
      message: `not a valid instrument DSL: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  return { ok: true, definition: { kind: "INSTRUMENT", dsl: parsed.data as StrategyDsl } };
}

/** The JSON to persist for a cross-sectional strategy: the IR plus its discriminator. */
export function crossSectionalRecord(strategy: CrossSectionalStrategy): Record<string, unknown> {
  return { ...strategy, kind: CROSS_SECTIONAL_KIND };
}

/** The kind of a stored row, for callers that only need to route. */
export function strategyKindOf(json: string): StrategyKind | null {
  const result = parseStrategyDefinition(json);
  return result.ok ? result.definition.kind : null;
}
