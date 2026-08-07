/**
 * RiskGate — every order path passes through here, and it fails closed.
 *
 * The governing rule is that an unknown is a block, never an allowance. If the gate cannot
 * establish how many trades have already been taken today, it does not assume zero; it
 * refuses. Risk limits that silently pass when their input is missing are worse than no
 * limits at all, because they are believed.
 *
 * Rules are data, not code. They are supplied by the owner and evaluated wholesale so that a
 * verdict records every rule that was checked — including the ones that passed — rather than
 * short-circuiting on the first failure. A verdict listing one breach when four rules were
 * never evaluated is not an audit trail.
 */

export interface RiskRules {
  /** Maximum position units per order. */
  maxContracts: number;
  maxTradesPerDay: number;
  maxSimultaneousPositions: number;
  /** Daily loss ceiling expressed in R (multiples of the per-trade risk unit). */
  dailyLossLimitR: number;
  /** Exchange-local session window, "HH:MM". */
  tradingWindowStart: string;
  tradingWindowEnd: string;
  newsBlackoutMinutesBefore: number;
  newsBlackoutMinutesAfter: number;
  /** Correlation ceiling between an existing book and the proposed addition. */
  maxPairwiseCorrelation: number;
  maxCombinedDrawdownUsd: number;
  /** Overlapping history required before a correlation estimate is trusted at all. */
  minCommonDays: number;
}

export const DEFAULT_RULES: Readonly<RiskRules> = Object.freeze({
  maxContracts: 1,
  maxTradesPerDay: 1,
  maxSimultaneousPositions: 1,
  dailyLossLimitR: 1,
  tradingWindowStart: "09:30",
  tradingWindowEnd: "15:30",
  newsBlackoutMinutesBefore: 15,
  newsBlackoutMinutesAfter: 15,
  maxPairwiseCorrelation: 0.7,
  maxCombinedDrawdownUsd: 2_000,
  minCommonDays: 20,
});

export interface GateContext {
  /** Minutes since exchange-local midnight for the proposed order. */
  sessionMinute: number | null;
  requestedContracts: number | null;
  tradesToday: number | null;
  openPositions: number | null;
  /** Realised R today. Negative is a loss. */
  realisedRToday: number | null;
  /** Minutes to the nearest scheduled news event; negative means it has already passed. */
  minutesToNearestNewsEvent: number | null;
  combinedDrawdownUsd: number | null;
  /** Highest pairwise correlation between the book and the proposal, or null if unknown. */
  maxPairwiseCorrelation: number | null;
  /** Overlapping days behind that correlation estimate. */
  commonDays: number | null;
  killSwitchEngaged: boolean;
}

export type CheckStatus = "pass" | "block";

export interface RuleCheck {
  rule: string;
  status: CheckStatus;
  detail: string;
}

export interface GateVerdict {
  allowed: boolean;
  checks: RuleCheck[];
  /** Rules that blocked, in evaluation order. Empty when allowed. */
  blockedBy: string[];
  evaluatedAt: Date;
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function known(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Evaluates every rule and returns a complete verdict.
 *
 * `now` is injected rather than read from the clock so a verdict can be replayed exactly as
 * it was issued — a risk decision that cannot be reproduced cannot be reviewed.
 */
export function evaluateGate(
  context: GateContext,
  rules: RiskRules = DEFAULT_RULES,
  now: Date = new Date(),
): GateVerdict {
  const checks: RuleCheck[] = [];

  const check = (rule: string, ok: boolean, detail: string) => {
    checks.push({ rule, status: ok ? "pass" : "block", detail });
  };

  // The kill switch is a rule like any other so that it appears in the audit trail, rather
  // than an early return that leaves the record silent about everything else.
  check(
    "kill_switch",
    !context.killSwitchEngaged,
    context.killSwitchEngaged ? "Kill switch engaged; all trading halted." : "Kill switch clear.",
  );

  check(
    "max_contracts",
    known(context.requestedContracts) && context.requestedContracts <= rules.maxContracts && context.requestedContracts > 0,
    known(context.requestedContracts)
      ? `Requested ${context.requestedContracts}, limit ${rules.maxContracts}.`
      : "Requested size unknown — refused rather than assumed.",
  );

  check(
    "max_trades_per_day",
    known(context.tradesToday) && context.tradesToday < rules.maxTradesPerDay,
    known(context.tradesToday)
      ? `${context.tradesToday} taken today, limit ${rules.maxTradesPerDay}.`
      : "Today's trade count unknown — refused rather than assumed zero.",
  );

  check(
    "max_simultaneous_positions",
    known(context.openPositions) && context.openPositions < rules.maxSimultaneousPositions,
    known(context.openPositions)
      ? `${context.openPositions} open, limit ${rules.maxSimultaneousPositions}.`
      : "Open position count unknown — refused rather than assumed zero.",
  );

  check(
    "daily_loss_limit_r",
    known(context.realisedRToday) && context.realisedRToday > -rules.dailyLossLimitR,
    known(context.realisedRToday)
      ? `${context.realisedRToday.toFixed(2)}R realised today, floor -${rules.dailyLossLimitR}R.`
      : "Today's realised R unknown — refused rather than assumed flat.",
  );

  const windowStart = parseClock(rules.tradingWindowStart);
  const windowEnd = parseClock(rules.tradingWindowEnd);
  const windowValid = windowStart !== null && windowEnd !== null && windowStart < windowEnd;
  check(
    "trading_window",
    windowValid &&
      known(context.sessionMinute) &&
      context.sessionMinute >= windowStart &&
      context.sessionMinute <= windowEnd,
    !windowValid
      ? `Trading window "${rules.tradingWindowStart}-${rules.tradingWindowEnd}" is not a valid range.`
      : known(context.sessionMinute)
        ? `Session minute ${context.sessionMinute} against window ${rules.tradingWindowStart}-${rules.tradingWindowEnd}.`
        : "Session time unknown — refused rather than assumed in-window.",
  );

  const blackoutOk =
    known(context.minutesToNearestNewsEvent) === false
      ? false
      : context.minutesToNearestNewsEvent! > rules.newsBlackoutMinutesBefore ||
        context.minutesToNearestNewsEvent! < -rules.newsBlackoutMinutesAfter;
  check(
    "news_blackout",
    blackoutOk,
    known(context.minutesToNearestNewsEvent)
      ? `${context.minutesToNearestNewsEvent} minutes to nearest event; blackout -${rules.newsBlackoutMinutesAfter}..+${rules.newsBlackoutMinutesBefore}.`
      : "News calendar unavailable — refused rather than assumed clear.",
  );

  check(
    "max_combined_drawdown_usd",
    known(context.combinedDrawdownUsd) && Math.abs(context.combinedDrawdownUsd) < rules.maxCombinedDrawdownUsd,
    known(context.combinedDrawdownUsd)
      ? `Combined drawdown ${context.combinedDrawdownUsd.toFixed(2)}, ceiling ${rules.maxCombinedDrawdownUsd}.`
      : "Combined drawdown unknown — refused rather than assumed zero.",
  );

  // Correlation is only meaningful with enough overlapping history. Too few common days is a
  // block, not a pass: an unmeasurable correlation is not an uncorrelated one.
  const correlationMeasurable = known(context.commonDays) && context.commonDays >= rules.minCommonDays;
  check(
    "max_pairwise_correlation",
    correlationMeasurable &&
      known(context.maxPairwiseCorrelation) &&
      Math.abs(context.maxPairwiseCorrelation) <= rules.maxPairwiseCorrelation,
    !correlationMeasurable
      ? `Only ${context.commonDays ?? "unknown"} common days; ${rules.minCommonDays} needed before a correlation is trusted.`
      : known(context.maxPairwiseCorrelation)
        ? `Highest pairwise correlation ${context.maxPairwiseCorrelation.toFixed(2)}, ceiling ${rules.maxPairwiseCorrelation}.`
        : "Correlation unknown — refused rather than assumed independent.",
  );

  const blockedBy = checks.filter((item) => item.status === "block").map((item) => item.rule);
  return { allowed: blockedBy.length === 0, checks, blockedBy, evaluatedAt: now };
}

/** Rule identifiers the gate always evaluates, for UI and audit completeness checks. */
export const GATE_RULES = [
  "kill_switch",
  "max_contracts",
  "max_trades_per_day",
  "max_simultaneous_positions",
  "daily_loss_limit_r",
  "trading_window",
  "news_blackout",
  "max_combined_drawdown_usd",
  "max_pairwise_correlation",
] as const;
