import { DEFAULT_RULES, evaluateGate, type GateContext, type GateVerdict, type RiskRules } from "@/lib/risk/gate";

/**
 * A trade proposal — everything the owner needs to place an order themselves, and nothing that
 * could place one.
 *
 * The reel package's risk design is explicit about the shape: `executable: false`,
 * `human_confirmation_required: true`, a short expiry, an immutable evidence snapshot, and
 * explicit quantity, price, stop, target and maximum loss. This type is that contract.
 *
 * The maximum loss is computed here rather than displayed from the strategy, because a proposal
 * whose worst case is left to the reader is the one that gets sized by optimism.
 */

export type ProposalDecision = "ALLOW_FOR_CONFIRMATION" | "BLOCK" | "DEFER";

export interface ProposalInput {
  instrumentId: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategyId: string;
  strategyName: string;
  /** Forward observations behind this strategy. Zero is a fact worth showing, not hiding. */
  forwardObservations: number;
  quantity: number;
  entryPrice: number;
  stopPrice: number;
  /**
   * Null when the strategy declares no take-profit — its exit is a time limit or a condition.
   *
   * Nullable rather than derived, because the obvious fallback (a 2R target, say) would be a
   * number nobody chose appearing on a ticket as though the strategy had produced it. A missing
   * target makes reward-to-risk incomputable, which is a fact about the strategy worth showing.
   */
  targetPrice: number | null;
  currency: string;
  /** Minutes the proposal stays valid. A stale proposal is a different trade. */
  validForMinutes?: number;
  evidenceSnapshotId?: string | null;
}

export interface Proposal extends ProposalInput {
  decision: ProposalDecision;
  gate: GateVerdict;
  /** Worst case if the stop fills exactly, in the instrument's currency. Always positive. */
  maxLoss: number;
  /** Reward-to-risk at the stated stop and target. Null when the stop is not below entry. */
  rewardToRisk: number | null;
  expiresAt: Date;
  createdAt: Date;
  /** Stated on every proposal, in the payload, so no consumer can treat it as executable. */
  executable: false;
  humanConfirmationRequired: true;
  reasons: string[];
}

export const DEFAULT_VALID_FOR_MINUTES = 20;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * @param context Risk-gate inputs. A null field means "not known", and the gate treats unknown
 *   as blocking rather than as satisfied — an unmeasured correlation is not a low one.
 */
export function buildProposal(
  input: ProposalInput,
  context: GateContext,
  rules: RiskRules = DEFAULT_RULES,
  now: Date = new Date(),
): Proposal {
  const gate = evaluateGate(context, rules, now);
  const reasons: string[] = [];

  const risePerUnit = input.side === "BUY" ? input.entryPrice - input.stopPrice : input.stopPrice - input.entryPrice;
  const rewardPerUnit =
    input.targetPrice === null
      ? null
      : input.side === "BUY"
        ? input.targetPrice - input.entryPrice
        : input.entryPrice - input.targetPrice;

  // A stop on the wrong side of entry is not a small risk, it is an unbounded one.
  const stopIsProtective = risePerUnit > 0;
  if (!stopIsProtective) {
    reasons.push(
      `Stop ${input.stopPrice} does not protect a ${input.side} at ${input.entryPrice}. Maximum loss is unbounded, so this cannot be confirmed.`,
    );
  }

  const maxLoss = stopIsProtective ? round(risePerUnit * input.quantity) : Number.POSITIVE_INFINITY;
  const rewardToRisk =
    stopIsProtective && rewardPerUnit !== null && rewardPerUnit > 0 ? round(rewardPerUnit / risePerUnit) : null;

  if (input.forwardObservations === 0) {
    reasons.push("No forward observations behind this strategy. Backtest performance is not evidence of edge.");
  }
  for (const blocked of gate.blockedBy) reasons.push(`Risk gate: ${blocked}`);

  const decision: ProposalDecision = !stopIsProtective
    ? "BLOCK"
    : gate.allowed
      ? "ALLOW_FOR_CONFIRMATION"
      : // A gate block on a *timing* rule is a defer, not a refusal: the same proposal may be
        // valid in ten minutes. A block on size or loss is a refusal.
        gate.blockedBy.every((rule) => rule === "trading_window" || rule === "news_blackout")
        ? "DEFER"
        : "BLOCK";

  return {
    ...input,
    decision,
    gate,
    maxLoss,
    rewardToRisk,
    createdAt: now,
    expiresAt: new Date(now.getTime() + (input.validForMinutes ?? DEFAULT_VALID_FOR_MINUTES) * 60_000),
    executable: false,
    humanConfirmationRequired: true,
    reasons,
  };
}

/** True once the proposal describes a market that has moved on. */
export function isExpired(proposal: Proposal, now: Date = new Date()): boolean {
  return now.getTime() >= proposal.expiresAt.getTime();
}

/**
 * The order ticket, as text the owner can carry to their broker.
 *
 * Deliberately plain text and deliberately not a link: there is no endpoint in this system that
 * accepts it, and generating something that looks like a submit payload would invite someone to
 * find one.
 */
export function orderTicket(proposal: Proposal): string {
  return [
    `${proposal.side} ${proposal.quantity} ${proposal.symbol}`,
    `Entry  ${proposal.entryPrice} ${proposal.currency} (limit)`,
    `Stop   ${proposal.stopPrice}`,
    proposal.targetPrice !== null
      ? `Target ${proposal.targetPrice}`
      : "Target none — this strategy exits on time or condition, not a price",
    Number.isFinite(proposal.maxLoss) ? `Max loss ${proposal.maxLoss} ${proposal.currency}` : "Max loss UNBOUNDED",
    proposal.rewardToRisk !== null ? `R:R ${proposal.rewardToRisk}` : "R:R not computable",
    `Strategy ${proposal.strategyName} · ${proposal.forwardObservations} forward observations`,
    `Valid until ${proposal.expiresAt.toISOString()}`,
    "Placed manually by the owner. This software has no broker adapter.",
  ].join("\n");
}
