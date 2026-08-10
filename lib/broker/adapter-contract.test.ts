import { describe, expect, it } from "vitest";
import {
  BROKER_CONTRACT_TEST_CATEGORIES,
  BrokerAdapterError,
  PAPER_ADAPTER_DECLARATION,
  requireCapability,
} from "./adapter-contract";

/**
 * The contract's own invariants. Adapter implementations get their full per-category suites when
 * they exist (WS1b paper first); this pins the seam itself.
 */

describe("broker adapter contract", () => {
  it("refuses an undeclared capability loudly, with the honest error code", () => {
    expect(() => requireCapability(PAPER_ADAPTER_DECLARATION, "websocket_orders")).toThrowError(
      BrokerAdapterError,
    );
    try {
      requireCapability(PAPER_ADAPTER_DECLARATION, "gtt");
    } catch (caught) {
      expect((caught as BrokerAdapterError).code).toBe("CAPABILITY_UNDECLARED");
    }
  });

  it("passes a declared capability through silently", () => {
    expect(() => requireCapability(PAPER_ADAPTER_DECLARATION, "paper_fills")).not.toThrow();
  });

  it("the paper adapter never claims live-market or GTT powers it does not have", () => {
    for (const capability of ["realtime_quotes", "depth_l5", "gtt", "websocket_orders"] as const) {
      expect(PAPER_ADAPTER_DECLARATION.capabilities).not.toContain(capability);
    }
    // And no credential: the paper broker must be runnable with nothing secret at all.
    expect(PAPER_ADAPTER_DECLARATION.credentialSource).toBe("none");
  });

  it("the contract-test category list cannot quietly shrink", () => {
    // Ten categories from the audit. A future edit that drops one fails here, visibly, and has
    // to argue its case in this file rather than by omission.
    expect(BROKER_CONTRACT_TEST_CATEGORIES).toHaveLength(10);
    expect(BROKER_CONTRACT_TEST_CATEGORIES).toContain("order reconciliation");
    expect(BROKER_CONTRACT_TEST_CATEGORIES).toContain("session rollover");
  });

  it("broker errors preserve the raw broker detail beside the normalized code", () => {
    const error = new BrokerAdapterError("RATE_LIMITED", "Throttled.", "KITE:TooManyRequests");
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.brokerDetail).toBe("KITE:TooManyRequests");
  });
});
