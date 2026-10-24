/**
 * The fund's ledger: every decision, execution, NAV mark and kill, appended to `audit_events`.
 *
 * `audit_events` carries a BEFORE DELETE trigger, so a row cannot be taken back. That is the
 * property the owner's trust rests on: a decision is on disk before its outcome exists, and a bad
 * month cannot be quietly removed.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MandateId } from "./mandates";

const ACTION = {
  decision: "fund_decision",
  execution: "fund_execution",
  nav: "fund_nav",
  kill: "fund_kill",
  missed: "fund_decision_missed",
} as const;
type Kind = keyof typeof ACTION;

interface Base {
  mandate: MandateId;
  hash: string;
}
export interface DecisionRow extends Base {
  decisionDate: string;
  hold: boolean;
  inputs: Record<string, number | string>;
  bootstrap: boolean;
  /** Sleeve capital, fixed at the first decision so a later book change cannot rebase the record. */
  capital: number;
  reason?: string;
}
export interface ExecutionRow extends Base {
  decisionDate: string;
  /** The engine idempotency key the order was placed under: how a lost ledger write is recovered. */
  key?: string;
  /** True when the row was reconstructed from an engine fill the ledger had missed. */
  recovered?: boolean;
  side: "BUY" | "SELL";
  status: string;
  reason: string | null;
  quantityDelta: number;
  cashDelta: number;
  fillPrice: number | null;
  fees: number;
  /** Trade date in the venue's convention (IST session for NSE, UTC day for crypto). */
  tradeDate: string;
  at: string;
}
export interface NavRow extends Base {
  date: string;
  nav: number;
  cash: number;
  quantity: number;
  close: number;
}
export interface KillRow extends Base {
  date: string;
  drawdown: number;
}
/** EC-6: a decision date that went stale before any pass could decide it. */
export interface MissedRow extends Base {
  decisionDate: string;
  daysLate: number;
  freshnessDays: number;
}
type RowOf = { decision: DecisionRow; execution: ExecutionRow; nav: NavRow; kill: KillRow; missed: MissedRow };

export function appendFund<K extends Kind>(kind: K, row: RowOf[K], key: string): void {
  const limited = kind === "kill" || (kind === "execution" && (row as ExecutionRow).status !== "FILLED");
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor: "fund",
      action: ACTION[kind],
      decision: limited ? "limited" : "allowed",
      subject: `${row.mandate}:${key}`,
      detail: JSON.stringify(row),
      createdAt: new Date(),
    })
    .run();
}

/** Rows of one kind for one mandate, oldest first. A malformed row is skipped, never guessed at. */
export function readFund<K extends Kind>(kind: K, mandate: MandateId): RowOf[K][] {
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, ACTION[kind]))
    .orderBy(asc(schema.auditEvents.id))
    .all()
    .flatMap((row) => {
      try {
        const parsed = JSON.parse(row.detail ?? "{}") as RowOf[K];
        return parsed.mandate === mandate ? [parsed] : [];
      } catch {
        return [];
      }
    });
}
