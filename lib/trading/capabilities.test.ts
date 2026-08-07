import { describe, expect, it } from "vitest";
import { executionCapabilities } from "./capabilities";

describe("execution capabilities", () => {
  it("keeps broker execution unavailable", () => {
    expect(executionCapabilities).toEqual({
      paper: true,
      confirmedLive: false,
      brokerAdapter: null,
      reason: "EXECUTION_ADAPTER_MISSING",
    });
    expect(Object.isFrozen(executionCapabilities)).toBe(true);
  });
});
