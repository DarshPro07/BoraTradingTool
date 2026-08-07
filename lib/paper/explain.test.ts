import { describe, expect, it } from "vitest";
import { BLAME_LABEL, explainRejection } from "./explain";

/**
 * The behaviour under test is the difference between a dead button and a system that teaches.
 *
 * Pressing "place order" produced `REJECTED · STALE` and nothing else. The refusal was correct;
 * the explanation was absent. The most important thing an explanation carries is **whose fault
 * it is** — a user who thinks their order was wrong keeps editing it, while a user who knows the
 * feed is unreachable goes and fixes the feed.
 */

describe("every explanation is actionable", () => {
  const codes = ["INELIGIBLE_QUOTE", "NO_QUOTE", "INSUFFICIENT_CASH", "INSUFFICIENT_POSITION", "POSITION_CAP", "DAILY_ORDER_CAP", "EXPIRED"];

  it("says what happened in one sentence", () => {
    for (const code of codes) {
      const explanation = explainRejection(code);
      expect(explanation.headline.length).toBeGreaterThan(15);
      expect(explanation.headline.length).toBeLessThan(70);
    }
  });

  it("says why the system refused, not merely that it did", () => {
    for (const code of codes) {
      expect(explainRejection(code).detail.length).toBeGreaterThan(60);
    }
  });

  it("assigns blame to something the reader can act on", () => {
    for (const code of codes) {
      const { blame } = explainRejection(code);
      expect(["your_order", "market_data", "risk_policy"]).toContain(blame);
      expect(BLAME_LABEL[blame]).toBeTruthy();
    }
  });
});

describe("the stale-quote case, which is the one that actually fires", () => {
  it("blames the feed rather than the order", () => {
    // The whole point. On a machine where the provider is unreachable, every order is refused,
    // and a user who believes their order was malformed will edit it forever.
    const explanation = explainRejection("INELIGIBLE_QUOTE");
    expect(explanation.blame).toBe("market_data");
    expect(explanation.remedy).toMatch(/nothing about the order itself is wrong/i);
  });

  it("explains why a stale fill would be worse than no fill", () => {
    const explanation = explainRejection("INELIGIBLE_QUOTE");
    expect(explanation.detail).toMatch(/never happened|invent/i);
  });

  it("points at the screen that shows the provider state", () => {
    expect(explainRejection("INELIGIBLE_QUOTE").href).toBe("/data-quality");
  });

  it("falls back on quote quality when the code is unrecognised", () => {
    // A reason this table has not seen still leaves the useful half knowable.
    const explanation = explainRejection("SOMETHING_NEW", "STALE");
    expect(explanation.blame).toBe("market_data");
    expect(explanation.headline).toMatch(/stale/i);
  });
});

describe("it never invents a cause", () => {
  it("admits an unknown code rather than guessing", () => {
    const explanation = explainRejection("WHAT_IS_THIS");
    expect(explanation.blame).toBe("unknown");
    expect(explanation.detail).toContain("WHAT_IS_THIS");
    expect(explanation.detail).toMatch(/does not have an explanation/i);
  });

  it("treats a missing reason as itself worth investigating", () => {
    const explanation = explainRejection(null);
    expect(explanation.blame).toBe("unknown");
    expect(explanation.detail).toMatch(/no reason/i);
  });

  it("offers no remedy where the reader controls nothing", () => {
    // A fabricated "try again" would be worse than silence.
    expect(explainRejection("WHAT_IS_THIS").remedy).toBeNull();
  });

  it("separates a risk block from a data problem", () => {
    // Both refuse. Conflating them sends someone to fix a feed that is working.
    expect(explainRejection("POSITION_CAP").blame).toBe("risk_policy");
    expect(explainRejection("NO_QUOTE").blame).toBe("market_data");
    expect(explainRejection("INSUFFICIENT_CASH").blame).toBe("your_order");
  });
});
