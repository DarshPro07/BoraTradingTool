import { describe, expect, it } from "vitest";
import {
  PANEL_STATES,
  STATE_DESCRIPTORS,
  isActionable,
  isObservedZero,
  stateFromErrorCode,
  worstState,
  type PanelState,
} from "./panel-state";

describe("the vocabulary is complete and consistent", () => {
  it("describes every state it declares", () => {
    for (const state of PANEL_STATES) {
      const descriptor = STATE_DESCRIPTORS[state];
      expect(descriptor.state).toBe(state);
      expect(descriptor.label.length).toBeGreaterThan(0);
      // The meaning is what a panel shows instead of a blank box, so it has to say something.
      expect(descriptor.meaning.length).toBeGreaterThan(30);
    }
  });

  it("carries all fourteen states the architecture reference requires", () => {
    const required = [
      "loading", "streaming", "current", "delayed", "stale", "partial", "unavailable",
      "unsupported", "unauthorized", "invalid", "compute_error", "retrying", "offline", "empty",
    ];
    expect([...PANEL_STATES].sort()).toEqual([...required].sort());
  });
});

describe("the distinctions that actually matter", () => {
  it("treats only empty as an observed zero", () => {
    expect(isObservedZero("empty")).toBe(true);
    // The whole point: a ban list nobody could read must not render as "nothing was banned".
    expect(isObservedZero("unavailable")).toBe(false);
    expect(isObservedZero("unauthorized")).toBe(false);
    expect(isObservedZero("offline")).toBe(false);
    expect(isObservedZero("loading")).toBe(false);
  });

  it("permits action only where data is genuinely present", () => {
    expect(isActionable("current")).toBe(true);
    expect(isActionable("streaming")).toBe(true);
    // Delayed data is late by entitlement, not broken — it can still be acted on knowingly.
    expect(isActionable("delayed")).toBe(true);
    for (const state of ["stale", "partial", "unavailable", "invalid", "compute_error", "offline", "empty", "loading", "retrying", "unauthorized", "unsupported"] as PanelState[]) {
      expect(isActionable(state)).toBe(false);
    }
  });

  it("separates a data gap from a defect in our own code", () => {
    expect(STATE_DESCRIPTORS.compute_error.tone).toBe("bad");
    expect(STATE_DESCRIPTORS.compute_error.meaning).toMatch(/defect/);
    expect(STATE_DESCRIPTORS.unavailable.meaning).toMatch(/not a zero/);
  });

  it("does not mark any non-actionable state as good", () => {
    for (const state of PANEL_STATES) {
      const descriptor = STATE_DESCRIPTORS[state];
      if (descriptor.tone === "good") expect(descriptor.actionable).toBe(true);
    }
  });
});

describe("aggregating across sources", () => {
  it("reports the state that misleads most, not the one that sounds worst", () => {
    // Missing data outranks stale data: stale is wrong about when, missing invites a conclusion
    // drawn from nothing at all.
    expect(worstState(["current", "stale", "unavailable"])).toBe("unavailable");
    expect(worstState(["current", "stale"])).toBe("stale");
    expect(worstState(["current", "current"])).toBe("current");
  });

  it("lets a single failure dominate a panel of healthy sources", () => {
    expect(worstState(["current", "current", "current", "offline"])).toBe("offline");
  });

  it("does not treat streaming as worse than current", () => {
    expect(["current", "streaming"]).toContain(worstState(["current", "streaming"]));
  });

  it("calls an empty source list empty rather than current", () => {
    // Zero sources is not a healthy panel, and defaulting it to `current` would be a lie.
    expect(worstState([])).toBe("empty");
  });
});

describe("mapping contract failures into the language", () => {
  it("maps each refusal code to the state that means the same thing", () => {
    expect(stateFromErrorCode("RESOURCE_NOT_PROVIDED")).toBe("unavailable");
    expect(stateFromErrorCode("QUANT_CORE_UNAVAILABLE")).toBe("offline");
    expect(stateFromErrorCode("RESOURCE_STALE")).toBe("stale");
    expect(stateFromErrorCode("RESOURCE_MALFORMED")).toBe("invalid");
    expect(stateFromErrorCode("UNKNOWN_CHECKPOINT")).toBe("unsupported");
  });

  it("never defaults an unknown failure to a healthy state", () => {
    const state = stateFromErrorCode("SOMETHING_NOBODY_HAS_SEEN");
    expect(state).toBe("compute_error");
    expect(isActionable(state)).toBe(false);
  });

  it("never maps any failure code to current or streaming", () => {
    const codes = [
      "RESOURCE_NOT_PROVIDED", "QUANT_CORE_UNAVAILABLE", "RESOURCE_STALE", "RESOURCE_MALFORMED",
      "CONTRACT_VERSION_MISMATCH", "UNKNOWN_CHECKPOINT", "", "undefined",
    ];
    for (const code of codes) {
      expect(["current", "streaming"]).not.toContain(stateFromErrorCode(code));
    }
  });
});
