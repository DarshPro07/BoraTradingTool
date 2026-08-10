import { describe, expect, it } from "vitest";
import { sessionOpenMinute } from "@/lib/market/calendar";
import {
  EXECUTION_PROFILES,
  describeExecution,
  executionContextFor,
  executionProfileFor,
  type BrokerExecutionProfile,
} from "./execution-profile";

/**
 * The profile table replaces a hardcoded 15:20 that was presented as Zerodha's square-off and was
 * not: the broker documents 15:25 for non-CAS equity. These tests pin the three properties the
 * review demanded — broker-dependent, product-dependent, date-dependent — and the fail-closed
 * behaviour for anything no record covers.
 */

const AT = new Date("2026-08-09T10:00:00Z");

describe("broker dependence — the same question, two brokers, two answers", () => {
  it("gives Zerodha 15:25 and Upstox 15:20 for the identical NSE equity MIS query", () => {
    const zerodha = executionProfileFor({ broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS", at: AT });
    const upstox = executionProfileFor({ broker: "UPSTOX", exchange: "NSE", segment: "EQ", product: "MIS", at: AT });

    expect(zerodha.available && zerodha.profile.mandatoryExitMinute).toBe(15 * 60 + 25);
    expect(upstox.available && upstox.profile.mandatoryExitMinute).toBe(15 * 60 + 20);
  });

  it("carries different provenance for the two, because their evidence differs", () => {
    const zerodha = executionProfileFor({ broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS", at: AT });
    const upstox = executionProfileFor({ broker: "UPSTOX", exchange: "NSE", segment: "EQ", product: "MIS", at: AT });
    if (!zerodha.available || !upstox.available) throw new Error("profiles missing");

    // Zerodha's page was fetched by this system; Upstox's figure comes from the owner's review.
    // Flattening both to one confidence level would overstate the weaker one.
    expect(zerodha.profile.sources[0].confidence).toBe("independently_fetched");
    expect(upstox.profile.sources[0].confidence).toBe("owner_review_reported");
    expect(zerodha.profile.verificationStatus).toBe("VERIFIED");
    expect(upstox.profile.verificationStatus).toBe("UNVERIFIED");
  });
});

describe("product dependence", () => {
  it("forces MIS flat and lets CNC hold overnight, same broker, same day", () => {
    const mis = executionProfileFor({ broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS", at: AT });
    const cnc = executionProfileFor({ broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "CNC", at: AT });

    expect(mis.available && mis.profile.mandatoryExitMinute).toBe(15 * 60 + 25);
    expect(cnc.available && cnc.profile.mandatoryExitMinute).toBeNull();
  });

  it("attaches the auto square-off charge only where a broker can force the close", () => {
    const mis = executionProfileFor({ broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS", at: AT });
    const cnc = executionProfileFor({ broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "CNC", at: AT });
    expect(mis.available && mis.profile.autoSquareOffCharge?.amount).toBe(50);
    expect(cnc.available && cnc.profile.autoSquareOffCharge).toBeNull();
  });
});

describe("date dependence", () => {
  it("refuses a date before any window opens, rather than applying today's policy backwards", () => {
    const result = executionProfileFor({
      broker: "ZERODHA",
      exchange: "NSE",
      segment: "EQ",
      product: "MIS",
      at: new Date("2020-06-01T10:00:00Z"),
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/No execution profile covers/);
  });

  it("selects by window when versions exist, proven with synthetic records", () => {
    // The shipped table holds one verified version per profile — history is not back-filled
    // without sources. The windowing logic still has to be right for the day two versions exist,
    // so it is proven here with synthetic data rather than fabricated broker claims.
    const base = EXECUTION_PROFILES.find((p) => p.id === "ZERODHA_NSE_EQ_MIS_NONCAS_2026_08")!;
    const versions: BrokerExecutionProfile[] = [
      { ...base, id: "v1", effectiveFrom: "2024-01-01", effectiveTo: "2025-12-31", mandatoryExitMinute: 15 * 60 + 20 },
      { ...base, id: "v2", effectiveFrom: "2026-01-01", effectiveTo: null, mandatoryExitMinute: 15 * 60 + 25 },
    ];

    const in2025 = executionProfileFor(
      { broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS", at: new Date("2025-06-01T10:00:00Z") },
      versions,
    );
    const in2026 = executionProfileFor(
      { broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS", at: new Date("2026-06-01T10:00:00Z") },
      versions,
    );

    expect(in2025.available && in2025.profile.id).toBe("v1");
    expect(in2026.available && in2026.profile.id).toBe("v2");
    expect(in2025.available && in2025.profile.mandatoryExitMinute).toBe(15 * 60 + 20);
    expect(in2026.available && in2026.profile.mandatoryExitMinute).toBe(15 * 60 + 25);
  });
});

describe("fail closed", () => {
  it("has no profile for BSE intraday, and says which profiles do exist", () => {
    // Before this table, a BSE intraday strategy silently inherited the IN constant. Now the
    // absence is a stated fact the engines turn into a refusal.
    const result = executionContextFor("BSE", "5m", AT);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/BSE/);
    expect(result.reason).toMatch(/Refused rather than defaulted/);
  });

  it("marks the US stand-in as assumed, so its weakness travels with it", () => {
    const result = executionContextFor("US", "5m", AT);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.profile.sources[0].confidence).toBe("assumed");
    expect(describeExecution(result.profile)).toMatch(/assumed/);
  });
});

describe("the owner's context resolves to the documented broker rules", () => {
  it("maps NSE intraday to Zerodha MIS and NSE daily to Zerodha CNC", () => {
    const intraday = executionContextFor("NSE", "5m", AT);
    const daily = executionContextFor("NSE", "D", AT);
    expect(intraday.available && intraday.profile.id).toBe("ZERODHA_NSE_EQ_MIS_NONCAS_2026_08");
    expect(daily.available && daily.profile.id).toBe("ZERODHA_NSE_EQ_CNC_2026_08");
  });
});

describe("internal consistency", () => {
  it("agrees with the market calendar about session opens, so two clocks cannot drift", () => {
    for (const profile of EXECUTION_PROFILES) {
      const market = profile.exchange === "XNAS" ? "US" : "IN";
      expect(profile.sessionOpenMinute).toBe(sessionOpenMinute(market));
    }
  });

  it("keeps every deadline inside its own session", () => {
    for (const profile of EXECUTION_PROFILES) {
      for (const minute of [profile.newEntryCutoffMinute, profile.rmsSquareOffStartMinute, profile.mandatoryExitMinute]) {
        if (minute === null) continue;
        expect(minute).toBeGreaterThan(profile.sessionOpenMinute);
        expect(minute).toBeLessThanOrEqual(profile.sessionCloseMinute);
      }
    }
  });

  it("states at least one assumption wherever a profile is weaker than VERIFIED", () => {
    // A weak source with no stated caveat reads as a strong one. The table must not permit that.
    for (const profile of EXECUTION_PROFILES) {
      if (profile.verificationStatus !== "VERIFIED") {
        expect(profile.assumptions.length, profile.id).toBeGreaterThan(0);
      }
    }
  });

  it("gives every profile at least one source, primary first", () => {
    for (const profile of EXECUTION_PROFILES) {
      expect(profile.sources.length, profile.id).toBeGreaterThan(0);
      expect(profile.sources[0].priority).toBe(1);
    }
  });

  it("describes provenance in one line, including the forced-close charge where it exists", () => {
    const mis = EXECUTION_PROFILES.find((p) => p.id === "ZERODHA_NSE_EQ_MIS_NONCAS_2026_08")!;
    const text = describeExecution(mis);
    expect(text).toMatch(/ZERODHA/);
    expect(text).toMatch(/15:25/);
    expect(text).toMatch(/fetched 2026-08-09/);
    expect(text).toMatch(/Rs 50/);
  });
});

describe("the CAS split is modelled as session structure, not a watchlist", () => {
  it("returns 15:10 for CAS equities from the regime's start date, and nothing before it", () => {
    const during = executionProfileFor({
      broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS",
      securityClass: "CAS", at: new Date("2026-08-09T10:00:00Z"),
    });
    expect(during.available && during.profile.mandatoryExitMinute).toBe(15 * 60 + 10);
    expect(during.available && during.profile.effectiveFrom).toBe("2026-08-03");

    // The Closing Auction Session regime began 2026-08-03; no CAS rule predates it, so a query
    // before that date must refuse rather than project the rule backwards.
    const before = executionProfileFor({
      broker: "ZERODHA", exchange: "NSE", segment: "EQ", product: "MIS",
      securityClass: "CAS", at: new Date("2026-07-01T10:00:00Z"),
    });
    expect(before.available).toBe(false);
  });

  it("resolves NON_CAS by default, with the assumption stated on the profile", () => {
    const context = executionContextFor("NSE", "5m", new Date("2026-08-09T10:00:00Z"));
    expect(context.available && context.profile.securityClass).toBe("NON_CAS");
    expect(context.available && context.profile.assumptions.join(" ")).toMatch(/assumed non-CAS/i);
  });
});

describe("a source conflict is recorded, never silently resolved", () => {
  const fo = () =>
    executionProfileFor({
      broker: "ZERODHA", exchange: "NSE", segment: "FO", product: "MIS",
      securityClass: "ANY", at: new Date("2026-08-09T10:00:00Z"),
    });

  it("marks the F&O deadline CONFLICTED and lists both disagreeing sources", () => {
    // Zerodha's own documentation disagrees with itself: general support says 15:26, the CAS
    // guidance effective 2026-08-03 says 15:25. The profile must carry the disagreement, not
    // an editorial choice presented as broker truth.
    const result = fo();
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.profile.verificationStatus).toBe("CONFLICTED");
    expect(result.profile.conflictingSourceIds?.length).toBe(2);
  });

  it("adopts the conservative value - the earliest stated exit - as the research assumption", () => {
    const result = fo();
    if (!result.available) throw new Error("profile missing");
    const stated = result.profile.sources
      .map((source) => source.statedExitMinute)
      .filter((minute): minute is number => minute !== undefined);
    expect(stated.length).toBeGreaterThanOrEqual(2);
    expect(result.profile.mandatoryExitMinute).toBe(Math.min(...stated));
  });

  it("says CONFLICTED out loud in the provenance line", () => {
    const result = fo();
    if (!result.available) throw new Error("profile missing");
    const text = describeExecution(result.profile);
    expect(text).toMatch(/CONFLICTED/);
    expect(text).toMatch(/research assumption/i);
  });

  it("keeps every CONFLICTED profile auditable: two or more sources with stated values", () => {
    for (const profile of EXECUTION_PROFILES) {
      if (profile.verificationStatus !== "CONFLICTED") continue;
      expect(profile.conflictingSourceIds?.length ?? 0, profile.id).toBeGreaterThanOrEqual(2);
      const stated = profile.sources.filter((source) => source.statedExitMinute !== undefined);
      expect(stated.length, profile.id).toBeGreaterThanOrEqual(2);
      // The adopted value must be the conservative one, provably.
      expect(profile.mandatoryExitMinute, profile.id).toBe(
        Math.min(...stated.map((source) => source.statedExitMinute!)),
      );
    }
  });
});
