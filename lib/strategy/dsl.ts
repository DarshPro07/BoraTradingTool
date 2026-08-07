import { createHash } from "node:crypto";
import { z } from "zod";
import { stableStringify } from "@/lib/util/stable-json";

/**
 * Features that are knowable at decision time. The DSL is a closed vocabulary rather than
 * an expression language: a strategy cannot reference anything not on this list, which makes
 * lookahead a compile error instead of a subtle backtest bug.
 */
export const POINT_IN_TIME_FEATURES = [
  "close",
  "open",
  "high",
  "low",
  "volume",
  "sma20",
  "sma50",
  "sma200",
  "ema12",
  "ema26",
  "rsi14",
  "atr14",
  "rvol",
  "gap_pct",
  "momentum_20d",
  "momentum_60d",
  "distance_from_52w_high",
  "distance_from_52w_low",
  "sector_relative_strength",
  "earnings_surprise_pct",
  "days_since_earnings",
  "market_cap",
  "adv_20d",
  // Kronos forecast quantities (ADR 0004). Both are real numbers the forecast file supplies —
  // the predicted next-bar return, and the cumulative return across the forecast horizon —
  // derived from its bars against the last actual close.
  "forecast_return_1d",
  "forecast_return_5d",
] as const;
export type PointInTimeFeature = (typeof POINT_IN_TIME_FEATURES)[number];

/**
 * Permitted by the language, derivable by no engine here.
 *
 * These are legitimate quantities — a strategy that wants market cap is not confused — but
 * nothing in this deployment supplies them from price data. Compiling them silently is how a
 * strategy sits in `draft` looking untested when it was never testable, so `compileStrategy`
 * warns about them at authoring time.
 *
 * Declared here rather than imported from `lib/backtest/features.ts`, which imports *from* this
 * module and would make the dependency circular. `dsl.test.ts` pins the two lists together so
 * they cannot drift apart.
 */
export const UNSUPPORTED_BY_ENGINE = [
  "sector_relative_strength",
  "earnings_surprise_pct",
  "days_since_earnings",
  "market_cap",
  // Kronos forecasts are unsupported for a *different* reason than the four above, and the
  // difference matters. The others are missing a data source. These have one — but only for
  // **now**.
  //
  // A backtest needs the forecast that was available at each historical bar. The quant core
  // produces one file per instrument, holding the current prediction with a single `generatedAt`.
  // Reading it at every bar would apply today's forecast to last year's decisions, which is
  // lookahead of the purest kind (ADR 0004) — and unlike a missing feature, it would not fail.
  // It would silently produce a spectacular equity curve.
  //
  // These become derivable when the quant core keeps a point-in-time forecast archive: one
  // record per bar, each stamped with the time it was actually generated. Until then the DSL
  // accepts the idea and the compiler says plainly that it cannot be tested.
  "forecast_return_1d",
  "forecast_return_5d",
] as const satisfies readonly PointInTimeFeature[];

/**
 * Names that encode information from the future. Rejected explicitly so the error message
 * names the problem rather than reporting a generic unknown feature.
 */
export const LOOKAHEAD_FEATURES = [
  "future_return",
  "next_close",
  "next_open",
  "forward_return",
  "max_future_price",
  "min_future_price",
  "label",
  "target_return",
  "outcome",
  "realized_return",
  "final_pnl",
] as const;

/**
 * Bumped whenever compilation semantics change: a new operator, an altered feature
 * definition, a different rejection rule, a changed cost convention.
 *
 * It is folded into the strategy hash because the DSL text alone does not identify what was
 * actually run. The same JSON compiled under different semantics is a different strategy,
 * and without this a validation result recorded last month could be silently attributed to
 * a spec that now behaves differently.
 */
export const COMPILER_VERSION = "1.2.0";

const COMPARISONS = ["gt", "gte", "lt", "lte"] as const;

export type Condition =
  | { feature: string; op: (typeof COMPARISONS)[number]; value: number }
  | { compare: [string, string]; op: (typeof COMPARISONS)[number] }
  // Crossing is an *event* between two consecutive bars, not a state: comparing current
  // values cannot express "SMA20 just crossed above SMA50" without firing on every bar
  // it stays above. `crossover: [a, b]` fires on the bar where a moves from ≤b to >b.
  | { crossover: [string, string] }
  | { crossunder: [string, string] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const FeaturePairSchema = z.tuple([
  z.string().trim().min(1).max(60),
  z.string().trim().min(1).max(60),
]);

const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ feature: z.string().trim().min(1).max(60), op: z.enum(COMPARISONS), value: z.number().finite() }).strict(),
    z
      .object({
        compare: z.tuple([z.string().trim().min(1).max(60), z.string().trim().min(1).max(60)]),
        op: z.enum(COMPARISONS),
      })
      .strict()
      // Comparing a feature with itself is always tautological (gte) or impossible (gt):
      // the condition looks meaningful in the JSON but carries no information.
      .refine((c) => c.compare[0] !== c.compare[1], {
        message: "A feature cannot be compared with itself.",
        path: ["compare"],
      }),
    z
      .object({ crossover: FeaturePairSchema })
      .strict()
      .refine((c) => c.crossover[0] !== c.crossover[1], {
        message: "A feature cannot cross itself.",
        path: ["crossover"],
      }),
    z
      .object({ crossunder: FeaturePairSchema })
      .strict()
      .refine((c) => c.crossunder[0] !== c.crossunder[1], {
        message: "A feature cannot cross itself.",
        path: ["crossunder"],
      }),
    z.object({ all: z.array(ConditionSchema).min(1).max(10) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1).max(10) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
  ]),
);

export const StrategyDslSchema = z
  .object({
    name: z.string().trim().min(3).max(80).regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits and underscores."),
    description: z.string().trim().max(500).optional(),
    universe: z
      .object({
        market: z.enum(["US", "NSE", "BSE"]),
        minAdv20d: z.number().finite().nonnegative().optional(),
        maxPositions: z.number().int().min(1).max(50).default(10),
        /**
         * Bar size. Defaults to daily so every strategy written before intraday existed keeps
         * its exact meaning — a silent switch would re-interpret stored specs.
         */
        resolution: z.enum(["D", "1m", "5m", "15m"]).default("D"),
      })
      .strict(),
    entry: ConditionSchema,
    exit: z
      .object({
        afterDays: z.number().int().min(1).max(250).optional(),
        stopLossPct: z.number().min(0.1).max(50).optional(),
        takeProfitPct: z.number().min(0.1).max(500).optional(),
        condition: ConditionSchema.optional(),
      })
      .strict()
      .refine(
        (exit) => exit.afterDays !== undefined || exit.stopLossPct !== undefined || exit.condition !== undefined,
        { message: "An exit needs at least a time limit, a stop, or a condition — otherwise positions never close." },
      ),
    sizing: z.object({ maxPositionPct: z.number().min(0.1).max(25) }).strict(),
    costs: z
      .object({
        commissionBps: z.number().min(0).max(200),
        slippageBps: z.number().min(0).max(500),
        /**
         * The bid-ask spread the strategy assumes it will cross, in basis points.
         *
         * **Declared, never measured.** This deployment has no bid/ask or depth data — the
         * schema has no quote table and the free feeds do not carry one. The engine decides on
         * bar close and fills at the next open, modelling no spread, no queue position and no
         * partial fill.
         *
         * On daily bars those omissions are small relative to the move. On 1-minute bars the
         * spread is frequently larger than the edge, so a backtest that ignores it is not
         * optimistic — it is measuring a different instrument. Requiring the number makes the
         * assumption visible and arguable instead of absent, which is the honest option
         * available without paying for microstructure data.
         */
        assumedSpreadBps: z.number().min(0).max(500).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((dsl, context) => {
    // The cross-field rule: intraday without a declared spread is refused outright rather than
    // defaulted. A default would be a number nobody chose, silently deciding whether the
    // strategy passes — and the whole point is that this figure is a claim someone makes.
    if (dsl.universe.resolution !== "D" && dsl.costs.assumedSpreadBps === undefined) {
      context.addIssue({
        code: "custom",
        path: ["costs", "assumedSpreadBps"],
        message:
          `A ${dsl.universe.resolution} strategy must declare assumedSpreadBps. This deployment cannot ` +
          "measure the bid-ask spread, and at intraday resolution it is often larger than the edge — " +
          "so it has to be stated as an assumption rather than left out.",
      });
    }
  });

export type StrategyDsl = z.infer<typeof StrategyDslSchema>;

export type CompileErrorCode =
  | "SCHEMA_INVALID"
  | "LOOKAHEAD_FEATURE"
  | "UNKNOWN_FEATURE"
  | "CONDITION_TOO_DEEP";

export interface CompileFailure {
  ok: false;
  code: CompileErrorCode;
  message: string;
}

export interface CompiledStrategy {
  ok: true;
  dsl: StrategyDsl;
  hash: string;
  features: string[];
  depth: number;
  warnings: string[];
}

export type CompileResult = CompiledStrategy | CompileFailure;

const MAX_DEPTH = 5;

function walkCondition(
  condition: Condition,
  features: Set<string>,
  depth: number,
): { depth: number } {
  if (depth > MAX_DEPTH) return { depth };

  if ("feature" in condition) {
    features.add(condition.feature);
    return { depth };
  }
  if ("compare" in condition) {
    features.add(condition.compare[0]);
    features.add(condition.compare[1]);
    return { depth };
  }
  if ("crossover" in condition) {
    features.add(condition.crossover[0]);
    features.add(condition.crossover[1]);
    return { depth };
  }
  if ("crossunder" in condition) {
    features.add(condition.crossunder[0]);
    features.add(condition.crossunder[1]);
    return { depth };
  }
  if ("not" in condition) return walkCondition(condition.not, features, depth + 1);

  const children = "all" in condition ? condition.all : condition.any;
  let deepest = depth;
  for (const child of children) {
    deepest = Math.max(deepest, walkCondition(child, features, depth + 1).depth);
  }
  return { depth: deepest };
}

export { stableStringify };

/**
 * Compiles a strategy specification, rejecting anything that could see the future or
 * that could hold a position indefinitely.
 */
export function compileStrategy(input: unknown): CompileResult {
  const parsed = StrategyDslSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      message: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; "),
    };
  }

  const dsl = parsed.data;
  const features = new Set<string>();
  let depth = walkCondition(dsl.entry, features, 1).depth;
  if (dsl.exit.condition) {
    depth = Math.max(depth, walkCondition(dsl.exit.condition, features, 1).depth);
  }

  if (depth > MAX_DEPTH) {
    return {
      ok: false,
      code: "CONDITION_TOO_DEEP",
      message: `Condition nesting exceeds ${MAX_DEPTH} levels; simplify the rule.`,
    };
  }

  const lookahead = [...features].filter((feature) =>
    (LOOKAHEAD_FEATURES as readonly string[]).includes(feature),
  );
  if (lookahead.length > 0) {
    return {
      ok: false,
      code: "LOOKAHEAD_FEATURE",
      message:
        `These features are not knowable at decision time: ${lookahead.join(", ")}. ` +
        "A strategy referencing them would be testing against information it could not have had.",
    };
  }

  const unknown = [...features].filter(
    (feature) => !(POINT_IN_TIME_FEATURES as readonly string[]).includes(feature),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "UNKNOWN_FEATURE",
      message: `Unknown features: ${unknown.join(", ")}. Permitted features: ${POINT_IN_TIME_FEATURES.join(", ")}.`,
    };
  }

  const warnings: string[] = [];

  // Features the DSL permits but no engine can supply. Compiling them cleanly and failing only
  // at replay time is how a strategy ends up sitting in `draft` for weeks looking merely
  // untested when it was never testable — which is exactly what happened to the two specs in
  // this database. Named here, at authoring time, where it can still be changed cheaply.
  const notDerivable = [...features].filter((feature) =>
    (UNSUPPORTED_BY_ENGINE as readonly string[]).includes(feature),
  );
  // Two different reasons, reported as two different warnings. "Find a data source" and "the
  // data exists but reading it historically would be lookahead" call for opposite actions, and
  // one message covering both would send the author looking for the wrong thing.
  const missingSource = notDerivable.filter((feature) => !feature.startsWith("forecast_"));
  const missingArchive = notDerivable.filter((feature) => feature.startsWith("forecast_"));

  if (missingSource.length > 0) {
    warnings.push(
      `No engine can derive these from price data: ${missingSource.join(", ")}. ` +
        "This strategy will compile but cannot be backtested until a source supplies them.",
    );
  }
  if (missingArchive.length > 0) {
    warnings.push(
      `Forecast features cannot be backtested yet: ${missingArchive.join(", ")}. ` +
        "The quant core publishes one current forecast per instrument, not one per historical bar. " +
        "Replaying it across history would apply today's prediction to past decisions — lookahead " +
        "that produces an excellent equity curve rather than an error. Needs a point-in-time " +
        "forecast archive first.",
    );
  }

  if (dsl.exit.stopLossPct === undefined) {
    warnings.push("No stop loss defined; the exit relies on time or condition alone.");
  }
  if (dsl.costs.commissionBps + dsl.costs.slippageBps === 0) {
    warnings.push("Zero modelled costs. Results will overstate a real edge.");
  }
  if (dsl.universe.resolution !== "D") {
    // `afterDays` counts *bars*, not calendar days. Harmless at daily resolution where the two
    // coincide; at 1-minute it means an exit ten minutes later while reading as ten days. The
    // field is not renamed because that would invalidate every stored spec — so it is named here.
    if (dsl.exit.afterDays !== undefined) {
      warnings.push(
        `afterDays counts bars, not calendar days: at ${dsl.universe.resolution} this exits after ` +
          `${dsl.exit.afterDays} bars, not ${dsl.exit.afterDays} days.`,
      );
    }
    if ((dsl.costs.assumedSpreadBps ?? 0) === 0) {
      warnings.push(
        "assumedSpreadBps is zero at intraday resolution. A zero spread is a claim that you cross " +
          "the book for free, which no venue offers.",
      );
    }
  }
  if (dsl.sizing.maxPositionPct > 15) {
    warnings.push(`Position size of ${dsl.sizing.maxPositionPct}% is concentrated.`);
  }

  return {
    ok: true,
    dsl,
    hash: createHash("sha256")
      .update(stableStringify({ compiler: COMPILER_VERSION, dsl }), "utf8")
      .digest("hex")
      .slice(0, 32),
    features: [...features].sort(),
    depth,
    warnings,
  };
}

/**
 * Round-trip cost in basis points, used by the engine and the cost-stress stage.
 *
 * The declared spread is charged **once per round trip**, not twice like commission and
 * slippage. Crossing the book to enter and again to exit costs the full spread each way — which
 * is two halves, so one whole spread per completed trade. Doubling it would overstate the cost
 * by 2×, and an intraday strategy that fails only because its costs were doubled has been
 * rejected for the wrong reason. Rejection has to be as honest as acceptance.
 *
 * A daily strategy that declares no spread charges none, so every existing spec keeps its exact
 * prior meaning and stored results stay comparable.
 */
export function roundTripCostBps(dsl: StrategyDsl, multiple = 1): number {
  const perSide = (dsl.costs.commissionBps + dsl.costs.slippageBps) * 2;
  return (perSide + (dsl.costs.assumedSpreadBps ?? 0)) * multiple;
}
