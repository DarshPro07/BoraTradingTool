import { describe, expect, it } from "vitest";
import {
  SOURCE_USAGE_POLICIES,
  TERMS_FRESHNESS_DAYS,
  isCommercialDeployment,
  usagePermitted,
} from "./source-usage-policy";

/**
 * Usage rights are a first-class refusal reason. These tests pin the two questions apart: "can
 * this source deliver the bars?" and "may this system use them for this?" — a source may answer
 * yes to the first and no to the second, and the second must win.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

describe("source usage policy", () => {
  it("refuses the blocked NSE quote surface on RIGHTS, not on the 403", () => {
    const decision = usagePermitted("nse-equity-quote", "RESEARCH", { now: NOW });
    expect(decision.verdict).toBe("NOT_PERMITTED");
    expect(decision.code).toBe("SOURCE_USAGE_NOT_PERMITTED");
    expect(decision.reason).toMatch(/prohibits automated collection/);
    // The decisive sentence: the block is the answer, not a problem to solve.
    expect(SOURCE_USAGE_POLICIES["nse-equity-quote"]?.note).toMatch(
      /the ANSWER, not an obstacle: defeating it with a headless browser/,
    );
    expect(SOURCE_USAGE_POLICIES["nse-equity-quote"]?.allowedPurposes).toEqual([]);
  });

  it("permits Yahoo for research and backtest, and refuses it for validation and live trading", () => {
    expect(usagePermitted("yahoo", "RESEARCH", { now: NOW }).verdict).toBe("PERMITTED");
    expect(usagePermitted("yahoo", "BACKTEST", { now: NOW }).verdict).toBe("PERMITTED");

    const validation = usagePermitted("yahoo", "VALIDATION", { now: NOW });
    expect(validation.verdict).toBe("NOT_PERMITTED");
    expect(validation.reason).toMatch(/not permitted for VALIDATION/);
    expect(usagePermitted("yahoo", "LIVE_TRADING", { now: NOW }).verdict).toBe("NOT_PERMITTED");
  });

  it("REVOKES personal-research sources the moment the deployment declares itself commercial", () => {
    // Today: permitted. This is the guard that stops a research prototype becoming a product on
    // data it may not use commercially — the flip is one flag, and it takes rights away.
    expect(usagePermitted("yahoo", "BACKTEST", { now: NOW, commercial: false }).verdict).toBe("PERMITTED");
    const commercial = usagePermitted("yahoo", "BACKTEST", { now: NOW, commercial: true });
    expect(commercial.verdict).toBe("NOT_PERMITTED");
    expect(commercial.reason).toMatch(/may not be used commercially \(PERSONAL_RESEARCH_ONLY\)/);
    // Even NSE's own downloadable files need a licence for commercial market-data use.
    expect(usagePermitted("nse-official", "IDENTITY", { now: NOW, commercial: true }).verdict).toBe("NOT_PERMITTED");
    expect(usagePermitted("nse-official", "IDENTITY", { now: NOW, commercial: false }).verdict).toBe("PERMITTED");
  });

  it("classifies jugaad-data as research-only until usage rights are confirmed", () => {
    const policy = SOURCE_USAGE_POLICIES["jugaad-data"]!;
    expect(policy.allowedPurposes).toEqual(["RESEARCH"]);
    expect(policy.note).toMatch(/RESEARCH_ONLY_UNTIL_USAGE_RIGHTS_CONFIRMED/);
    expect(policy.note).toMatch(/never/i);
    // So it can never silently become a production fallback.
    expect(usagePermitted("jugaad-data", "BACKTEST", { now: NOW }).verdict).toBe("NOT_PERMITTED");
    expect(usagePermitted("jugaad-data", "VALIDATION", { now: NOW }).verdict).toBe("NOT_PERMITTED");
  });

  it("treats an unread or stale terms reading as UNKNOWN — never as a permission", () => {
    const undeclared = usagePermitted("external-csv", "RESEARCH", { now: NOW });
    expect(undeclared.verdict).toBe("UNKNOWN");
    expect(undeclared.code).toBe("SOURCE_TERMS_UNKNOWN");

    const later = new Date(NOW.getTime() + (TERMS_FRESHNESS_DAYS + 1) * 86_400_000);
    const stale = usagePermitted("yahoo", "RESEARCH", { now: later });
    expect(stale.verdict).toBe("UNKNOWN");
    expect(stale.code).toBe("SOURCE_TERMS_STALE");
    expect(stale.reason).toMatch(/a stale reading is not a permission/);
  });

  it("only the authenticated broker API is permitted for LIVE_TRADING", () => {
    const live = Object.values(SOURCE_USAGE_POLICIES).filter((policy) =>
      policy!.allowedPurposes.includes("LIVE_TRADING"),
    );
    expect(live.map((policy) => policy!.sourceId)).toEqual(["upstox-v3"]);
  });

  it("every policy carries its terms URL and the date they were read", () => {
    for (const policy of Object.values(SOURCE_USAGE_POLICIES)) {
      expect(policy!.termsVerifiedAt, `${policy!.sourceId}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(policy!.note.length).toBeGreaterThan(40);
    }
  });

  it("this deployment is not commercial unless the flag says so", () => {
    expect(isCommercialDeployment({})).toBe(false);
    expect(isCommercialDeployment({ MARKETPULSE_COMMERCIAL_USE: "1" })).toBe(true);
  });
});
