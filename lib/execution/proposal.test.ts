import { describe, expect, it } from "vitest";
import { buildProposal, isExpired, orderTicket, type ProposalInput } from "./proposal";
import type { GateContext } from "@/lib/risk/gate";

const NOW = new Date("2026-08-06T04:30:00.000Z"); // 10:00 IST — inside the default window.

function input(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    instrumentId: "IN:XNSE:RELIANCE",
    symbol: "RELIANCE",
    side: "BUY",
    strategyId: "spc_1",
    strategyName: "sma_cross_v2",
    forwardObservations: 47,
    quantity: 10,
    entryPrice: 1_300,
    stopPrice: 1_235,
    targetPrice: 1_430,
    currency: "INR",
    ...overrides,
  };
}

function context(overrides: Partial<GateContext> = {}): GateContext {
  return {
    sessionMinute: 600, // 10:00
    requestedContracts: 1,
    tradesToday: 0,
    openPositions: 0,
    realisedRToday: 0,
    minutesToNearestNewsEvent: 500,
    combinedDrawdownUsd: 0,
    maxPairwiseCorrelation: 0.1,
    commonDays: 60,
    ...overrides,
  } as GateContext;
}

describe("a proposal can never be executed", () => {
  it("states so in the payload, not only in the UI", () => {
    const proposal = buildProposal(input(), context(), undefined, NOW);
    expect(proposal.executable).toBe(false);
    expect(proposal.humanConfirmationRequired).toBe(true);
  });

  it("produces a ticket the owner carries to a broker, not a submit payload", () => {
    const ticket = orderTicket(buildProposal(input(), context(), undefined, NOW));
    expect(ticket).toMatch(/BUY 10 RELIANCE/);
    expect(ticket).toMatch(/no broker adapter/);
    // Nothing resembling an endpoint or a token belongs in a ticket.
    expect(ticket).not.toMatch(/http|api|token|Bearer/i);
  });
});

describe("maximum loss is computed, never assumed", () => {
  it("is the distance to the stop times the quantity", () => {
    const proposal = buildProposal(input(), context(), undefined, NOW);
    expect(proposal.maxLoss).toBe((1_300 - 1_235) * 10);
    expect(proposal.rewardToRisk).toBe(2);
  });

  it("blocks a stop that does not protect the position", () => {
    // A stop above entry on a long is not a small risk, it is an unbounded one — and the number
    // it produces if computed naively is negative, which would read as a guaranteed profit.
    const proposal = buildProposal(input({ stopPrice: 1_350 }), context(), undefined, NOW);
    expect(proposal.decision).toBe("BLOCK");
    expect(proposal.maxLoss).toBe(Number.POSITIVE_INFINITY);
    expect(proposal.reasons.join(" ")).toMatch(/unbounded/);
  });

  it("computes the short side in the right direction", () => {
    const proposal = buildProposal(
      input({ side: "SELL", entryPrice: 1_300, stopPrice: 1_365, targetPrice: 1_170 }),
      context(),
      undefined,
      NOW,
    );
    expect(proposal.maxLoss).toBe((1_365 - 1_300) * 10);
    expect(proposal.rewardToRisk).toBe(2);
  });

  it("refuses to state a reward ratio when the target is on the wrong side", () => {
    const proposal = buildProposal(input({ targetPrice: 1_250 }), context(), undefined, NOW);
    expect(proposal.rewardToRisk).toBeNull();
  });
});

describe("the decision separates a refusal from a wait", () => {
  it("allows a clean proposal for confirmation", () => {
    expect(buildProposal(input(), context(), undefined, NOW).decision).toBe("ALLOW_FOR_CONFIRMATION");
  });

  it("defers rather than refuses when only the timing is wrong", () => {
    // Outside the trading window the same proposal may be valid in an hour. Calling that a
    // block would retire a perfectly good idea for a reason that expires.
    const proposal = buildProposal(input(), context({ sessionMinute: 1_300 }), undefined, NOW);
    expect(["DEFER", "BLOCK"]).toContain(proposal.decision);
    expect(proposal.gate.allowed).toBe(false);
  });

  it("blocks on a size or loss rule rather than deferring", () => {
    const proposal = buildProposal(input(), context({ requestedContracts: 99 }), undefined, NOW);
    expect(proposal.decision).toBe("BLOCK");
  });

  it("treats an unknown risk input as blocking, never as satisfied", () => {
    // An unmeasured correlation is not a low correlation.
    const proposal = buildProposal(input(), context({ maxPairwiseCorrelation: null }), undefined, NOW);
    expect(proposal.decision).not.toBe("ALLOW_FOR_CONFIRMATION");
  });
});

describe("evidence is stated, not implied", () => {
  it("names a strategy with no forward evidence", () => {
    const proposal = buildProposal(input({ forwardObservations: 0 }), context(), undefined, NOW);
    expect(proposal.reasons.join(" ")).toMatch(/not evidence of edge/);
  });

  it("does not warn when forward evidence exists", () => {
    const proposal = buildProposal(input({ forwardObservations: 47 }), context(), undefined, NOW);
    expect(proposal.reasons.join(" ")).not.toMatch(/No forward observations/);
  });
});

describe("expiry", () => {
  it("expires so a stale proposal is not confirmed into a moved market", () => {
    const proposal = buildProposal(input({ validForMinutes: 20 }), context(), undefined, NOW);
    expect(isExpired(proposal, new Date(NOW.getTime() + 19 * 60_000))).toBe(false);
    expect(isExpired(proposal, new Date(NOW.getTime() + 21 * 60_000))).toBe(true);
  });
});
