import { getDb, schema } from "@/lib/db";
import { getMarketSession, localParts } from "@/lib/market/calendar";
import type { Market } from "@/lib/market/types";
import { bookExposure, type ReturnPoint } from "@/lib/portfolio/correlation";
import { DEFAULT_RULES, type GateContext, type RiskRules } from "@/lib/risk/gate";

/**
 * The risk-gate context, built from what this deployment actually knows.
 *
 * `evaluateGate` has existed since the risk kernel was written and until now was only ever called
 * from a test. Nothing in production ever assembled a `GateContext` — which meant the gate was
 * enforced on no path at all, while looking, from the outside, exactly like a gate that had never
 * blocked anything.
 *
 * ## Null is a finding, and it is recorded as one
 *
 * The gate refuses on any unknown, deliberately. That makes it critical to distinguish *why* a
 * field is null, because two of them have completely different remedies: "the news calendar is
 * not part of this install" is a capability gap the owner can close by adding a source, while
 * "there is only one strategy so no pair exists" is a fact about the book that no amount of data
 * will change. A verdict that says only `blocked: news_blackout` sends the reader looking for a
 * risk breach that is not there.
 *
 * So every null carries a stated reason in `unavailable`, keyed by the gate rule that will refuse
 * on it. Nothing here substitutes a plausible number to make a rule pass.
 */

export interface BuiltContext {
  context: GateContext;
  /** Gate rule → why its input could not be established. Empty when everything was measurable. */
  unavailable: Record<string, string>;
}

function marketFor(universeMarket: "US" | "NSE" | "BSE"): Market {
  return universeMarket === "US" ? "US" : "IN";
}

/**
 * Realised R today.
 *
 * Returns 0 only when the ledger was read and had no entry dated today — that is a measurement,
 * not an assumption, and it is the normal case for an idle paper book. When there *was* activity,
 * this returns null: `paper_ledger` records CASH and POSITION movements, not realised profit, and
 * `paper_positions.realized_pnl` is cumulative with no per-day breakdown. Deriving a day's
 * realised P&L from either would be arithmetic on numbers that do not mean that.
 */
function realisedRToday(todayLocalDate: string, timezone: string): { value: number | null; reason?: string } {
  const rows = getDb().select().from(schema.paperLedger).all();
  const todays = rows.filter((row) => localParts(row.createdAt, timezone).date === todayLocalDate);
  if (todays.length === 0) return { value: 0 };
  return {
    value: null,
    reason:
      `${todays.length} paper ledger entr(ies) today, but the schema records CASH and POSITION ` +
      "movements rather than realised profit, so today's R cannot be computed from it.",
  };
}

/** Resolved forward observations per strategy, as a return series the correlation module accepts. */
export function bookReturnSeries(): Record<string, ReturnPoint[]> {
  const series: Record<string, ReturnPoint[]> = {};
  for (const row of getDb().select().from(schema.forwardOutcomes).all()) {
    if (row.outcome === "open" || row.rMultiple === null || row.strategySpecId === null) continue;
    const at = row.resolvedAt ?? row.openedAt;
    // Bucketed to the day so two strategies resolving on the same session align. The correlation
    // module matches on exact timestamps, and raw millisecond stamps would never collide — which
    // would report every pair as having zero overlap rather than as correlated.
    const time = Math.floor(at.getTime() / 86_400_000) * 86_400;
    (series[row.strategySpecId] ??= []).push({ time, value: row.rMultiple });
  }
  return series;
}

export interface ContextInput {
  universeMarket: "US" | "NSE" | "BSE";
  /** Units the proposal asks for. The gate refuses an unknown size outright. */
  requestedContracts: number;
  /** The strategy the proposal belongs to, so it is included in the correlation book. */
  strategySpecId: string;
  now?: Date;
  rules?: RiskRules;
}

export function buildGateContext(input: ContextInput): BuiltContext {
  const now = input.now ?? new Date();
  const rules = input.rules ?? DEFAULT_RULES;
  const unavailable: Record<string, string> = {};

  const market = marketFor(input.universeMarket);
  const session = getMarketSession(market, now);
  const local = localParts(now, session.timezone);

  const db = getDb();
  const positions = db.select().from(schema.paperPositions).all();
  const openPositions = positions.filter((position) => Math.abs(position.quantity) > 1e-9).length;

  const orders = db.select().from(schema.paperOrders).all();
  const tradesToday = orders.filter(
    (order) => order.filledAt !== null && localParts(order.filledAt, session.timezone).date === local.date,
  ).length;

  const realised = realisedRToday(local.date, session.timezone);
  if (realised.reason) unavailable.daily_loss_limit_r = realised.reason;

  // Equity against the starting line, summed across currencies. Mixing currencies is wrong in
  // general; it is recorded as a single figure here because the rule itself is a single USD
  // ceiling, and the accounts in this deployment are USD.
  const accounts = db.select().from(schema.paperAccounts).all();
  const positionValue = positions.reduce((total, position) => total + position.quantity * position.averageCost, 0);
  const combinedDrawdownUsd =
    accounts.length === 0
      ? 0
      : accounts.reduce((total, account) => total + (account.startingCash - account.cash), 0) - positionValue;

  // No source in this install. Left null rather than assumed clear — an earnings print inside the
  // blackout is exactly the event the rule exists for, and "we did not look" must not read as
  // "nothing scheduled".
  unavailable.news_blackout =
    "No economic or earnings calendar is wired into this deployment, so the blackout window cannot be checked.";

  const series = bookReturnSeries();
  const bookIds = Object.keys(series);
  const withProposed = new Set([...bookIds, input.strategySpecId]);
  let maxPairwiseCorrelation: number | null = null;
  let commonDays: number | null = null;

  if (withProposed.size < 2) {
    unavailable.max_pairwise_correlation =
      `Only ${withProposed.size} strateg${withProposed.size === 1 ? "y has" : "ies have"} a forward record, ` +
      "so no pair exists to correlate. This is the shape of the book, not a missing measurement — " +
      "the gate still refuses, because an unmeasurable correlation is not a low one.";
  } else {
    const exposure = bookExposure(series, rules.minCommonDays);
    maxPairwiseCorrelation = exposure.maxPairwiseCorrelation;
    commonDays = exposure.commonDays;
    if (maxPairwiseCorrelation === null) {
      unavailable.max_pairwise_correlation =
        `${exposure.pairs.length} pair(s) exist but none could be correlated: ` +
        `${[...new Set(exposure.pairs.map((pair) => pair.reason ?? "UNKNOWN"))].join(", ")}. ` +
        `Forward observations are resolved too rarely to reach ${rules.minCommonDays} overlapping days.`;
    }
  }

  if (session.session !== "REGULAR") {
    unavailable.trading_window = `The ${market} market is ${session.session} at ${session.localTime} ${session.timezone}.`;
  }

  return {
    context: {
      sessionMinute: local.minutes,
      requestedContracts: input.requestedContracts,
      tradesToday,
      openPositions,
      realisedRToday: realised.value,
      minutesToNearestNewsEvent: null,
      combinedDrawdownUsd,
      maxPairwiseCorrelation,
      commonDays,
      // There is no owner halt in force because there is no mechanism to engage one: nothing in
      // this codebase sets a kill switch, and there is no execution path for it to interrupt.
      // Reporting `true` would manufacture a halt nobody declared.
      killSwitchEngaged: false,
    },
    unavailable,
  };
}
