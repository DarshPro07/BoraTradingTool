/**
 * Everything the owner reads about the fund, computed from the ledger alone — so every figure on
 * `/fund` or in `scripts/fund.mts report` traces back to recorded decisions and cited closes.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ORB_CONTRACT, ORB_HASH, orbDailyPnl, orbDrawdown, readOrb } from "@/lib/intraday/orb";
import { isPlausibleSessionDate } from "@/lib/market/session-calendar";
import { isDecisionDate, mandateHash, MANDATES, shiftDate, type MandateContract } from "./mandates";
import { readFund, type DecisionRow, type ExecutionRow } from "./ledger";
import { mandateMetrics, trustGates, type MandateMetrics, type NavPoint, type TrustGates } from "./metrics";

export interface MandateReport {
  /** What the page and the MCP report read; IN1 (intraday) has no daily rule, sleeve or schedule. */
  contract: Pick<MandateContract, "id" | "title" | "venue" | "prior" | "declaredBenefit"> & { asset: { symbol: string } };
  hash: string;
  suspended: boolean;
  holding: number;
  decisions: DecisionRow[];
  executions: ExecutionRow[];
  nav: NavPoint[];
  metrics: MandateMetrics;
  gates: TrustGates;
}

export function mandateReport(contract: MandateContract): MandateReport {
  const decisions = readFund("decision", contract.id);
  const executions = readFund("execution", contract.id);
  const navRows = readFund("nav", contract.id);
  const capital = decisions[0]?.capital ?? 0;
  const firstClose = navRows[0]?.close ?? 1;
  const nav: NavPoint[] = navRows.map((n) => ({ date: n.date, nav: n.nav, benchmark: (capital * n.close) / firstClose }));
  const metrics = mandateMetrics(nav, contract.venue === "NSE" ? 248 : 365);
  // Every scheduled date since the start, plus the bootstrap: a missed one lowers T1.
  const due = navRows.filter((n) => isDecisionDate(contract, n.date) && n.date !== decisions[0]?.decisionDate).length + (decisions.length ? 1 : 0);
  const gates = trustGates(contract, metrics, {
    decisionDatesDue: due,
    decisionDatesRecorded: decisions.length,
    unexplainedFailures: executions.filter((e) => e.status !== "FILLED" && !e.reason).length,
    decisionPoints: decisions.length,
  });
  return {
    contract,
    hash: mandateHash(contract),
    suspended: readFund("kill", contract.id).length > 0,
    // Current position from executions: the latest NAV row predates any fill made since its close.
    holding: executions.filter((e) => e.status === "FILLED").reduce((q, e) => q + e.quantityDelta, 0),
    decisions,
    executions,
    nav,
    metrics,
    gates,
  };
}

/** IN1's first session (PRD v2 TL-1). Its trust denominator counts from here, not from its first decision. */
export const IN1_ACTIVATED = "2026-09-21";

/** IN1, the intraday ORB trader, in the same shape — from its own ledger. Benchmark: cash. */
export function intradayReport(now = new Date()): MandateReport {
  const decisionRows = readOrb("decision");
  const executionRows = readOrb("execution");
  const book = getDb().select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, "INR")).get()?.startingCash ?? 0;
  let cumulative = book;
  const nav: NavPoint[] = orbDailyPnl().map((d) => ({ date: d.day, nav: (cumulative += d.pnl), benchmark: book }));
  const days = [...new Set(decisionRows.map((d) => d.day))].sort();
  const metrics = mandateMetrics(nav, 248);
  // TL-1: every session since activation, so a clock that never decided reads 0/N, not 0/0. Today
  // counts once decided or closed, so the ratio never dips before 09:20. Weekend special sessions
  // (Muhurat) are closed for IN1 (EC-7).
  const ist = new Date(now.getTime() + 330 * 60_000);
  const todayIst = ist.toISOString().slice(0, 10);
  const closedToday = ist.getUTCHours() * 60 + ist.getUTCMinutes() >= 15 * 60 + 30 || days.includes(todayIst);
  let due = 0;
  for (let d = IN1_ACTIVATED; d < todayIst || (d === todayIst && closedToday); d = shiftDate(d, 1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0 && isPlausibleSessionDate(d)) due += 1;
  }
  const gates = trustGates(ORB_CONTRACT, metrics, {
    decisionDatesDue: due,
    decisionDatesRecorded: days.length,
    unexplainedFailures: executionRows.filter((e) => e.status !== "FILLED" && !e.refusal).length,
    decisionPoints: days.length,
  });
  const today = days.at(-1);
  return {
    contract: { id: "IN1", title: ORB_CONTRACT.title, venue: "NSE", prior: ORB_CONTRACT.prior, declaredBenefit: ORB_CONTRACT.declaredBenefit, asset: { symbol: "shares (3 names)" } },
    hash: ORB_HASH,
    suspended: orbDrawdown(book) > ORB_CONTRACT.killDrawdown,
    holding: executionRows.filter((e) => e.status === "FILLED" && e.day === today).reduce((q, e) => q + (e.side === "BUY" ? e.quantity : -e.quantity), 0),
    decisions: decisionRows.map((d) => ({
      mandate: "IN1", hash: d.hash, decisionDate: d.day, hold: d.long, bootstrap: false, capital: book,
      inputs: { instrument: d.instrumentId, stop: d.stop, open: d.first.open, close: d.first.close },
    })),
    executions: executionRows.map((e) => ({
      mandate: "IN1", hash: e.hash, decisionDate: e.day, side: e.side, status: e.status, reason: e.refusal ?? `${e.reason} ${e.instrumentId}`,
      quantityDelta: e.side === "BUY" ? e.quantity : -e.quantity, cashDelta: e.cashDelta, fillPrice: e.fillPrice, fees: e.fees, tradeDate: e.day, at: e.at,
    })),
    nav,
    metrics,
    gates,
  };
}

export function fundReport(): MandateReport[] {
  return [...MANDATES.map(mandateReport), intradayReport()];
}
