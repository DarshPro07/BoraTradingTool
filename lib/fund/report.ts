/**
 * Everything the owner reads about the fund, computed from the ledger alone — so every figure on
 * `/fund` or in `scripts/fund.mts report` traces back to recorded decisions and cited closes.
 */
import { isDecisionDate, mandateHash, MANDATES, type MandateContract } from "./mandates";
import { readFund, type DecisionRow, type ExecutionRow } from "./ledger";
import { mandateMetrics, trustGates, type MandateMetrics, type NavPoint, type TrustGates } from "./metrics";

export interface MandateReport {
  contract: MandateContract;
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

export function fundReport(): MandateReport[] {
  return MANDATES.map(mandateReport);
}
