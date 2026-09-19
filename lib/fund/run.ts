/**
 * One pass of the autonomous paper fund: for every mandate, bars -> decide -> mark -> kill -> execute.
 *
 * Called by the scheduled cycle every 15 minutes (PRD journey 1), under the cycle lease so passes
 * never overlap. Idempotent: a decision date is decided once, a bar date is marked once, and a pass
 * that finds nothing due does nothing.
 *
 * Honesty rules this enforces (each one a finding of the 2026-09-19 independent review):
 * - Decide only on bars up to the decision date, and only while that date is FRESH. A date whose
 *   outcome has already been running for days is not decided after the fact — not even the latest
 *   one — and counts as missed against T1.
 * - No sleeve is carved from a book whose capital is unknown: missing is not zero.
 * - A kill goes flat in the same pass, and a suspended mandate sells even when bars are missing.
 * - Before placing an order, a fill the ledger missed (order placed, ledger write lost) is
 *   recovered instead of bought twice.
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
  /** Starting cash of the book the sleeve is carved from; null when the book cannot be read. */
  bookCapital(mandate: MandateContract): number | null;
  /** Whether an order can be placed now (NSE: regular session; crypto: always). */
  canExecute(mandate: MandateContract, now: Date): boolean;
  /** BUY: `amount` is cash to spend (NSE derives a share count from `price`). SELL: quantity. */
  execute(mandate: MandateContract, side: "BUY" | "SELL", amount: number, price: number, key: string): Promise<Execution>;
  /** FILLED orders the engine holds under keys starting with `keyPrefix`. */
  findFilled(mandate: MandateContract, keyPrefix: string): { key: string; execution: Execution }[];
  /** The venue's trade date for `now`. */
  tradeDate(mandate: MandateContract, now: Date): string;
}

/** How long after its bar a decision date may still be decided. NSE spans a weekend plus a holiday. */
export const DECISION_FRESH_DAYS = { NSE: 5, SOLANA: 2 } as const;

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

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const targetSide = (target: boolean, quantity: number): "BUY" | "SELL" | null =>
  target && quantity === 0 ? "BUY" : !target && quantity > 0 ? "SELL" : null;

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
  const today = deps.tradeDate(mandate, now);
  const closes = await deps.loadCloses(mandate, now);
  let suspended = readFund("kill", mandate.id).length > 0;
  let decisions = readFund("decision", mandate.id);

  // 1. Decide — the latest due date only, from bars up to it, and only while it is fresh.
  if (closes.length === 0) {
    pass.note = "no completed bars: missing is not zero, nothing decided";
  } else if (!suspended) {
    const last = decisions.at(-1);
    const due = last
      ? [...closes].reverse().find((c) => c.date > last.decisionDate && isDecisionDate(mandate, c.date))?.date
      : closes.at(-1)!.date; // bootstrap: take a position from the current signal, then keep schedule
    const book = last ? null : deps.bookCapital(mandate);
    if (due && daysBetween(due, today) > DECISION_FRESH_DAYS[mandate.venue]) {
      pass.note = `missed decision date ${due} (${daysBetween(due, today)} days old): not decided after its outcome exists`;
    } else if (due && !last && !(book !== null && book > 0)) {
      pass.note = "book capital unavailable: no sleeve carved from an unknown amount";
    } else if (due) {
      const s = signal(mandate, closes.filter((c) => c.date <= due));
      if (s) {
        const row: DecisionRow = {
          mandate: mandate.id, hash, decisionDate: due, hold: s.hold, inputs: s.inputs, bootstrap: !last,
          capital: last ? last.capital : mandate.sleevePct * book!,
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
  let executions = readFund("execution", mandate.id);

  // 2. Mark every completed bar since the last mark, at the sleeve as it stood that day.
  const start = decisions[0]!.decisionDate;
  const lastMarked = readFund("nav", mandate.id).at(-1)?.date ?? "";
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

  // 3. Kill rule, before execution so a breach goes flat in this same pass.
  if (!suspended && closes.length > 0) {
    const series = readFund("nav", mandate.id).map((n) => n.nav);
    const peak = series.length ? Math.max(...series) : 0;
    const drawdown = peak > 0 ? 1 - series.at(-1)! / peak : 0;
    if (drawdown > mandate.killDrawdown) {
      appendFund("kill", { mandate: mandate.id, hash, date: closes.at(-1)!.date, drawdown }, `kill:${closes.at(-1)!.date}`);
      pass.killed = true;
      suspended = true;
    }
  }

  // 4. Execute toward the target.
  const target = suspended ? false : current.hold;
  let side = targetSide(target, sleeve(current.capital, executions).quantity);
  if (!side || !deps.canExecute(mandate, now)) return;

  // Recover a fill the engine holds but the ledger lost, rather than buying (or selling) twice.
  const prefix = `fund-${mandate.id}-${current.decisionDate}-${side}-`.replace(/[^A-Za-z0-9_-]/g, "_");
  const recorded = new Set(executions.map((e) => e.key));
  for (const found of deps.findFilled(mandate, prefix).filter((f) => !recorded.has(f.key))) {
    const row: ExecutionRow = {
      mandate: mandate.id, hash, decisionDate: current.decisionDate, side, key: found.key,
      tradeDate: today, at: now.toISOString(), recovered: true, ...found.execution,
    };
    appendFund("execution", row, `execution:${current.decisionDate}:${side}:recovered`);
    executions = [...executions, row];
  }
  const state = sleeve(current.capital, executions);
  side = targetSide(target, state.quantity);
  if (!side) return;

  const price = closes.at(-1)?.close ?? 0;
  if (side === "BUY" && !(price > 0)) return;
  // The minute makes each retry a distinct attempt; the NSE engine accepts only [A-Za-z0-9_-].
  const key = `${prefix}${now.toISOString().slice(0, 16)}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const result = await deps.execute(mandate, side, side === "BUY" ? state.cash : state.quantity, price, key);
  // One rejection row per reason per day: a stale quote at 09:15 should not write 25 rows.
  const repeat = executions.some(
    (e) => e.status === result.status && e.reason === result.reason && e.tradeDate === today && e.side === side,
  );
  if (result.status === "FILLED" || !repeat) {
    appendFund(
      "execution",
      { mandate: mandate.id, hash, decisionDate: current.decisionDate, side, key, tradeDate: today, at: now.toISOString(), ...result },
      `execution:${current.decisionDate}:${side}`,
    );
  }
  pass.executed = { side, status: result.status, reason: result.reason };
}

/** Minimum cash left behind on a crypto buy, so the network fee is always covered. */
export const CRYPTO_BUY_RESERVE = ASSUMED_NETWORK_FEE_USDC + 0.01;
