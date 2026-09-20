/**
 * Author the first intraday strategies this deployment can honestly test.
 *
 * ## Why these two, and why now
 *
 * Until this week the registry held eight strategies, all at daily resolution, for a product the
 * owner cannot afford: delivery needs ₹23,000 and the stated capital is ₹1,000. Intraday needs
 * ₹2,000 because it carries no flat DP charge. So every strategy in the system was for a market
 * its owner could not reach, and the 30,000 five-minute NSE bars sitting in the store could not be
 * used by anything.
 *
 * Three defects had to be closed before an intraday spec could mean anything:
 *   - the loader ignored the declared resolution and served daily bars to a 5-minute strategy;
 *   - the candle store held two clocks, so a session-relative rule read the wrong time of day;
 *   - the DSL could not express a square-off, so a backtest could hold past the broker's flat.
 *
 * All three are fixed. These are the first specs that could not have been written before.
 *
 * ## The parameters are chosen, not fitted
 *
 * Every number here was picked from the published description of the pattern *before* any backtest
 * was run, and none has been adjusted since. That matters more than whether they are optimal: a
 * parameter tuned against this history is a parameter this history can no longer test. The
 * fifteen-minute opening range, the ninety-minute entry window, the 1.2 relative-volume filter and
 * the first-hour window are all textbook values.
 *
 * They are also almost certainly not the best values, and that is the intended trade. Finding the
 * best ones is what the factory is for, and it spends multiple-testing budget to do it.
 *
 * ## The bar these must clear
 *
 * The declared cost is 29 bps a round trip — 5 commission + 7 slippage per side, plus a 5 bps
 * assumed spread. The owner's capital requires at least 24, so these are priced honestly and
 * slightly conservatively. A trade must clear 0.29% before it has earned anything at all.
 *
 * Usage:  npx tsx scripts/author-intraday-strategies.mts [--restore]
 *
 * `--restore` rewrites an existing row whose stored DSL can no longer be read back. That state was
 * real: the cost repair used to replace the whole `costs` object, dropping the `assumedSpreadBps`
 * the DSL requires at intraday resolution, and every cycle then refused the spec as unreadable.
 * Restoration is not invention — the definition here, with its stated 5 bps spread, is the source
 * these rows were authored from.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordAudit, recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema, compileStrategy } from "@/lib/strategy/dsl";
import { costStanding } from "@/lib/strategy/cost-gate";
import { impliedProduct } from "@/lib/strategy/cost-repair";
import { parseStrategyDefinition } from "@/lib/strategy/definition";
import { checkRediscovery } from "@/lib/strategy/graveyard";

const restore = process.argv.includes("--restore");

/**
 * Statutory + assumed cost at the owner's tradable capital (₹2,000 intraday, 4 positions).
 * Shared by both specs so neither can quietly price itself into a cheaper market than its sibling.
 */
const COSTS = { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 };

/** Four positions of ₹500 is what ₹2,000 supports under the 25% concentration cap. */
const UNIVERSE = { market: "NSE" as const, maxPositions: 4, resolution: "5m" as const };

const SPECS: unknown[] = [
  {
    name: "orb_nse_5m",
    description:
      "Opening-range breakout. Buys a close above the high of the session's first fifteen minutes, " +
      "inside the first ninety minutes, on above-average volume. Squared off by the broker's 15:20 " +
      "MIS flat, which this spec deliberately does not tighten — an ORB is meant to run until its " +
      "target, its stop, or the bell.",
    universe: UNIVERSE,
    entry: {
      all: [
        // The breakout itself. `opening_range_high` is only served once the range window has
        // closed, so the level cannot be moving on the bar that crosses it.
        { compare: ["close", "opening_range_high"], op: "gt" },
        // Not before the range is complete, and not in the afternoon — an "opening range"
        // breakout at 14:00 is a different pattern wearing the same name.
        { feature: "minutes_since_open", op: "gte", value: 15 },
        { feature: "minutes_since_open", op: "lte", value: 90 },
        // Volume confirmation. A breakout on thin volume is the one that reverses.
        { feature: "rvol", op: "gt", value: 1.2 },
      ],
    },
    exit: { stopLossPct: 0.5, takeProfitPct: 1.0 },
    sizing: { maxPositionPct: 25 },
    costs: COSTS,
  },
  {
    name: "first_hour_momentum_nse_5m",
    description:
      "First-hour momentum. Buys a close crossing above the 12-bar EMA within the first hour of a " +
      "session that gapped up. Flat by 15:00 — a momentum trade that has not worked inside a few " +
      "hours is not going to be rescued by the closing auction.",
    universe: UNIVERSE,
    entry: {
      all: [
        // A crossing event, not a state: without this it would fire on every bar the close spent
        // above the EMA, which is most of a trending morning.
        { crossover: ["close", "ema12"] },
        // After the first twenty minutes, so the opening auction's noise is not the signal.
        { feature: "minutes_since_open", op: "gte", value: 20 },
        { feature: "minutes_since_open", op: "lte", value: 60 },
        // Only in a session that opened higher. Momentum continuation, not reversal.
        { feature: "gap_pct", op: "gt", value: 0 },
      ],
    },
    exit: { stopLossPct: 0.4, takeProfitPct: 0.8, squareOffAt: "15:00" },
    sizing: { maxPositionPct: 25 },
    costs: COSTS,
  },
];

let authored = 0;
let refused = 0;

for (const candidate of SPECS) {
  const parsed = StrategyDslSchema.safeParse(candidate);
  if (!parsed.success) {
    refused += 1;
    console.error(`SCHEMA_INVALID — ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    continue;
  }

  const compiled = compileStrategy(parsed.data);
  if (!compiled.ok) {
    refused += 1;
    console.error(`${compiled.code} — ${compiled.message}`);
    continue;
  }

  const rediscovery = checkRediscovery(parsed.data);
  if (rediscovery.rediscovered) {
    refused += 1;
    console.error(`ALREADY_BURIED — ${rediscovery.message}`);
    continue;
  }

  // Checked here rather than left to the promotion ladder. A spec authored below the owner's real
  // cost would sit in the registry looking testable and be blocked at every rung, and the reason
  // belongs at the moment it can still be changed cheaply.
  // Priced at the product this resolution implies. Measuring a 5m strategy against the DELIVERY
  // schedule charges it Zerodha's flat DP fee, which intraday never pays, and refused every
  // intraday spec this script has ever been asked to author.
  const authoredJson = JSON.stringify(parsed.data);
  const cost = costStanding(authoredJson, impliedProduct(authoredJson));
  if (cost.understated) {
    refused += 1;
    console.error(`COST_UNDERSTATED — ${cost.reason}`);
    continue;
  }

  let id: string;
  try {
    id = recordStrategySpec({
      name: parsed.data.name,
      dsl: parsed.data,
      createdBy: "claude-code:intraday-capability-2026-08-09",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (/UNIQUE constraint failed: strategy_specs/i.test(message)) {
      const existing = getDb()
        .select()
        .from(schema.strategySpecs)
        .where(eq(schema.strategySpecs.name, parsed.data.name))
        .get();
      const readable = existing ? parseStrategyDefinition(existing.dsl) : { ok: true as const };
      if (existing && !readable.ok && restore) {
        getDb()
          .update(schema.strategySpecs)
          .set({ dsl: authoredJson })
          .where(eq(schema.strategySpecs.id, existing.id))
          .run();
        recordAudit({
          actor: "claude-code:intraday-restore-2026-09-20",
          action: "strategy_spec_restored",
          decision: "allowed",
          subject: existing.id,
          detail:
            `${parsed.data.name} could not be read back (${readable.message}) after the cost repair ` +
            `dropped assumedSpreadBps. Restored to the definition this script authors, declaring ` +
            `${cost.declaredBps} bps against ${cost.requiredBps} required.`,
        });
        console.log(`${parsed.data.name} — RESTORED (was unreadable: ${readable.message})`);
        continue;
      }
      console.log(
        `${parsed.data.name} already exists at this version — left untouched` +
          (existing && !readable.ok ? `, but its stored DSL cannot be read (${readable.message}). Re-run with --restore.` : "."),
      );
      continue;
    }
    throw caught;
  }

  authored += 1;
  console.log(`\n${parsed.data.name} — ${id}`);
  console.log(`  hash      ${compiled.hash}`);
  console.log(`  features  ${compiled.features.join(", ")}`);
  console.log(`  cost      ${cost.declaredBps} bps declared against ${cost.requiredBps} required`);
  for (const warning of compiled.warnings) console.log(`  warning   ${warning}`);
}

console.log(`\n${authored} authored, ${refused} refused.`);
if (refused > 0) process.exit(1);
