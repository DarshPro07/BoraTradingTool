/**
 * One pass of the autonomous paper fund: for every mandate, bars -> decide -> execute -> mark -> kill.
 *
 * Called by the scheduled cycle every 15 minutes (PRD journey 1). Idempotent: a decision date is
 * decided once, a bar date is marked once, and a pass that finds nothing due does nothing.
 *
 * Honesty rules this enforces:
 * - Decide only on bars up to the decision date; act on the NEXT opportunity (NSE: next session).
 * - Only the LATEST due decision date is decided. A date missed while the machine was off is not
 *   decided after the fact — its outcome already exists — and counts against T1 instead.
 * - A mandate that breaches its kill drawdown goes flat and stays suspended.
 */
import { ASSUMED_NETWORK_FEE_USDC } from "@/lib/crypto/paper";
import { isDecisionDate, mandateHash, MANDATES, signal, type Close, type MandateContract } from "./mandates";
import { appendFund, readFund, type DecisionRow, type ExecutionRow } from "./ledger";

export interface Execution {
  status: string;
  reason: string | null;
  quantityDelta: number;
  cashDelta: number;
  fillPrice: number | null;
  fees: number;
}

export interface FundDeps {
  /** Completed daily closes, oldest first. Must not include a bar still forming. */
  loadCloses(mandate: MandateContract, now: Date): Promise<Close[]>;
  /** Starting cash of the book the mandate's sleeve is carved from. */
  bookCapital(mandate: MandateContract): number;
  /** Whether an order can be placed now (NSE: regular session; crypto: always). */
  canExecute(mandate: MandateContract, now: Date): boolean;
  /** BUY: `amount` is cash to spend (NSE: an estimated share count is derived from `price`). SELL: quantity. */
  execute(mandate: MandateContract, side: "BUY" | "SELL", amount: number, price: number, key: string): Promise<Execution>;
  /** The venue's trade date for `now`. */
  tradeDate(mandate: MandateContract, now: Date): string;
}

export interface MandatePass {
  mandate: string;
  decided: { date: string; hold: boolean } | null;
  executed: { side: string; status: string; reason: string | null } | null;
  marked: number;
  killed: boolean;
  note: string | null;
}

function sleeve(capital: number, executions: readonly ExecutionRow[], throughDate?: string) {
  let cash = capital;
  let quantity = 0;
  for (const e of executions) {
    if (e.status !== "FILLED" || (throughDate && e.tradeDate > throughDate)) continue;
    cash += e.cashDelta;
    quantity += e.quantityDelta;
  }
  return { cash, quantity: Math.abs(quantity) < 1e-12 ? 0 : quantity };
}

export async function runFundPass(deps: FundDeps, now = new Date()): Promise<MandatePass[]> {
  const report: MandatePass[] = [];
  for (const mandate of MANDATES) {
    const pass: MandatePass = { mandate: mandate.id, decided: null, executed: null, marked: 0, killed: false, note: null };
    report.push(pass);
    try {
      await runMandate(mandate, deps, now, pass);
    } catch (caught) {
      pass.note = `failed: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`;
    }
  }
  return report;
}

async function runMandate(mandate: MandateContract, deps: FundDeps, now: Date, pass: MandatePass): Promise<void> {
  const hash = mandateHash(mandate);
  const closes = await deps.loadCloses(mandate, now);
  if (closes.length === 0) {
    pass.note = "no completed bars: missing is not zero, nothing decided";
    return;
  }
  const suspended = readFund("kill", mandate.id).length > 0;
  let decisions = readFund("decision", mandate.id);

  // 1. Decide — on the latest due date only, from bars up to it.
  if (!suspended) {
    const last = decisions.at(-1);
    const due = last
      ? [...closes].reverse().find((c) => c.date > last.decisionDate && isDecisionDate(mandate, c.date))?.date
      : closes.at(-1)!.date; // bootstrap: take a position from the current signal, then keep schedule
    if (due) {
      const upTo = closes.filter((c) => c.date <= due);
      const s = signal(mandate, upTo);
      if (s) {
        const row: DecisionRow = {
          mandate: mandate.id,
          hash,
          decisionDate: due,
          hold: s.hold,
          inputs: s.inputs,
          bootstrap: !last,
          capital: last?.capital ?? mandate.sleevePct * deps.bookCapital(mandate),
        };
        appendFund("decision", row, `decision:${due}`);
        decisions = [...decisions, row];
        pass.decided = { date: due, hold: s.hold };
      } else if (!last) {
        pass.note = "not enough history to evaluate the rule yet";
      }
    }
  }
  const current = decisions.at(-1);
  if (!current) return;

  // 2. Execute toward the target.
  let executions = readFund("execution", mandate.id);
  const state = sleeve(current.capital, executions);
  const target = suspended ? false : current.hold;
  const side = target && state.quantity === 0 ? "BUY" : !target && state.quantity > 0 ? "SELL" : null;
  if (side && deps.canExecute(mandate, now)) {
    const price = closes.at(-1)!.close;
    const amount = side === "BUY" ? state.cash : state.quantity;
    // The NSE engine accepts only [A-Za-z0-9_-]; the minute makes each retry a distinct attempt.
    const key = `fund-${mandate.id}-${current.decisionDate}-${side}-${now.toISOString().slice(0, 16)}`.replace(/[^A-Za-z0-9_-]/g, "_");
    const result = await deps.execute(mandate, side, amount, price, key);
    const tradeDate = deps.tradeDate(mandate, now);
    // One rejection row per reason per day: a stale quote at 09:15 should not write 25 rows.
    const repeat = executions.some(
      (e) => e.status === result.status && e.reason === result.reason && e.tradeDate === tradeDate && e.side === side,
    );
    if (result.status === "FILLED" || !repeat) {
      const row: ExecutionRow = {
        mandate: mandate.id,
        hash,
        decisionDate: current.decisionDate,
        side,
        tradeDate,
        at: now.toISOString(),
        ...result,
      };
      appendFund("execution", row, `execution:${current.decisionDate}:${side}`);
      executions = [...executions, row];
    }
    pass.executed = { side, status: result.status, reason: result.reason };
  }

  // 3. Mark every completed bar since the last mark, at the sleeve as it stood that day.
  const navs = readFund("nav", mandate.id);
  const start = decisions[0]!.decisionDate;
  const lastMarked = navs.at(-1)?.date ?? "";
  for (const bar of closes) {
    if (bar.date < start || bar.date <= lastMarked) continue;
    const s = sleeve(current.capital, executions, bar.date);
    appendFund(
      "nav",
      { mandate: mandate.id, hash, date: bar.date, nav: s.cash + s.quantity * bar.close, cash: s.cash, quantity: s.quantity, close: bar.close },
      `nav:${bar.date}`,
    );
    pass.marked += 1;
  }

  // 4. Kill rule.
  if (!suspended) {
    const series = readFund("nav", mandate.id).map((n) => n.nav);
    if (series.length === 0) return;
    const peak = Math.max(...series);
    const drawdown = peak > 0 ? 1 - series.at(-1)! / peak : 0;
    if (drawdown > mandate.killDrawdown) {
      appendFund("kill", { mandate: mandate.id, hash, date: closes.at(-1)!.date, drawdown }, `kill:${closes.at(-1)!.date}`);
      pass.killed = true;
    }
  }
}

/** Minimum cash left behind on a crypto buy, so the network fee is always covered. */
export const CRYPTO_BUY_RESERVE = ASSUMED_NETWORK_FEE_USDC + 0.01;
