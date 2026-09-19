/**
 * The autonomous paper fund's strategy mandates — FROZEN, hash-pinned, chosen from published rules.
 *
 * PRD: docs/plans/autonomous-fund/02-product.md. The owner wants the fund to "earn my trust" before
 * any real money moves; trust comes from a FORWARD record, so every mandate here is fixed before
 * any result on this data is seen, and changing a parameter makes a different mandate with a
 * different hash. Nothing in this file may be tuned against the fund's own record.
 *
 * Pure: no database, no network. `lib/fund/run.ts` feeds it bars.
 */
import { createHash } from "node:crypto";
import { isPlausibleSessionDate } from "@/lib/market/session-calendar";

export type MandateId = "FN1" | "FC1" | "FC2" | "IN1";

export interface MandateContract {
  id: MandateId;
  title: string;
  venue: "NSE" | "SOLANA";
  asset: { symbol: string; yahoo: string; instrumentId?: string; mint?: string };
  rule: { kind: "ABOVE_SMA"; sessions: number } | { kind: "TRAILING_RETURN_POSITIVE"; days: number };
  schedule: "MONTH_END_SESSION" | "WEEKLY_SUNDAY_UTC";
  /** Fraction of the book's starting cash this sleeve runs on. */
  sleevePct: number;
  /** Sleeve drawdown (fraction) that flattens and suspends the mandate. */
  killDrawdown: number;
  /** What the mandate claims to deliver against buy-and-hold — the T2 gate tests exactly this. */
  declaredBenefit: "DRAWDOWN" | "RETURN_AND_DRAWDOWN" | "POSITIVE_NET_RETURN";
  prior: string;
  sources: readonly string[];
}

export const MANDATES: readonly MandateContract[] = Object.freeze([
  Object.freeze({
    id: "FN1",
    title: "NIFTY trend core: NIFTYBEES above its 200-session SMA, else cash",
    venue: "NSE",
    asset: { symbol: "NIFTYBEES", yahoo: "NIFTYBEES.NS", instrumentId: "IN:XNSE:NIFTYBEES" },
    rule: { kind: "ABOVE_SMA", sessions: 200 },
    schedule: "MONTH_END_SESSION",
    // The risk kernel caps one position at 15% of the book; the sleeve is sized to fit inside it.
    sleevePct: 0.15,
    killDrawdown: 0.25,
    declaredBenefit: "DRAWDOWN",
    prior:
      "Lower drawdown than buy-and-hold, and probably lower return. A 2010-2022 Nifty 50 study found a " +
      "daily 50/200 crossover underperformed on return and cut drawdown only modestly; the monthly " +
      "check here (Faber 2007) exists to cut whipsaw, not to add return.",
    sources: Object.freeze([
      "Faber 2007, A Quantitative Approach to Tactical Asset Allocation",
      "https://zenodo.org/records/21308597",
    ]),
  }),
  Object.freeze({
    id: "FC1",
    title: "SOL trend: hold SOL while its trailing 28-day return is positive, else USDC",
    venue: "SOLANA",
    asset: { symbol: "SOL", yahoo: "SOL-USD", mint: "So11111111111111111111111111111111111111112" },
    rule: { kind: "TRAILING_RETURN_POSITIVE", days: 28 },
    schedule: "WEEKLY_SUNDAY_UTC",
    sleevePct: 0.25,
    killDrawdown: 0.5,
    declaredBenefit: "RETURN_AND_DRAWDOWN",
    prior:
      "Time-series momentum is documented for BTC (Liu & Tsyvinski 2021); its transfer to SOL is " +
      "UNPROVEN. Expected: smaller drawdowns than holding SOL; return advantage uncertain.",
    sources: Object.freeze(["Liu & Tsyvinski 2021, Risks and Returns of Cryptocurrency, RFS"]),
  }),
  Object.freeze({
    id: "FC2",
    title: "BTC trend: hold WBTC while BTC's trailing 28-day return is positive, else USDC",
    venue: "SOLANA",
    asset: { symbol: "WBTC", yahoo: "BTC-USD", mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh" },
    rule: { kind: "TRAILING_RETURN_POSITIVE", days: 28 },
    schedule: "WEEKLY_SUNDAY_UTC",
    sleevePct: 0.25,
    killDrawdown: 0.5,
    declaredBenefit: "RETURN_AND_DRAWDOWN",
    prior:
      "Documented for BTC (Liu & Tsyvinski 2021). Venue differs from the studies: a Solana wrapped " +
      "token (Portal WBTC) filled at Jupiter quotes.",
    sources: Object.freeze(["Liu & Tsyvinski 2021, Risks and Returns of Cryptocurrency, RFS"]),
  }),
] as MandateContract[]);

/** A changed parameter is a different mandate: the hash travels on every ledger row. */
export function mandateHash(mandate: MandateContract): string {
  return createHash("sha256").update(JSON.stringify(mandate)).digest("hex").slice(0, 16);
}

export interface Close {
  /** ISO date of the bar (IST session date for NSE, UTC day for crypto). */
  date: string;
  close: number;
}

export interface Signal {
  hold: boolean;
  inputs: Record<string, number | string>;
}

/**
 * The rule, on closes up to and including the decision date — the caller must not pass later bars.
 * Null when there is not enough history to evaluate: missing is not "out".
 */
export function signal(mandate: MandateContract, closes: readonly Close[]): Signal | null {
  const last = closes.at(-1);
  if (!last) return null;
  if (mandate.rule.kind === "ABOVE_SMA") {
    const window = closes.slice(-mandate.rule.sessions);
    if (window.length < mandate.rule.sessions) return null;
    const sma = window.reduce((sum, bar) => sum + bar.close, 0) / window.length;
    return { hold: last.close > sma, inputs: { date: last.date, close: last.close, sma } };
  }
  const cutoff = shiftDate(last.date, -mandate.rule.days);
  const past = [...closes].reverse().find((bar) => bar.date <= cutoff);
  if (!past) return null;
  const trailingReturn = last.close / past.close - 1;
  return {
    hold: trailingReturn > 0,
    inputs: { date: last.date, close: last.close, pastDate: past.date, pastClose: past.close, trailingReturn },
  };
}

/** Whether a bar date is one on which this mandate decides. */
export function isDecisionDate(mandate: MandateContract, date: string): boolean {
  if (mandate.schedule === "WEEKLY_SUNDAY_UTC") return new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
  // The last session of its month: the next plausible session falls in another month.
  let next = shiftDate(date, 1);
  for (let guard = 0; guard < 14 && !isPlausibleSessionDate(next); guard += 1) next = shiftDate(next, 1);
  return next.slice(0, 7) !== date.slice(0, 7);
}

export function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
