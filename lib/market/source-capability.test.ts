import { describe, expect, it } from "vitest";
import {
  CAPABILITY_FRESHNESS_DAYS,
  canSatisfy,
  SOURCE_CAPABILITIES,
  sourcesFor,
} from "./source-capability";

const NOW = new Date("2026-08-16T00:00:00Z");

describe("source capability declarations", () => {
  it("answers the ORB-scale question YES for Yahoo and the deep-history question NO — the exact distinction that matters", () => {
    // 40 sessions of 5m sits inside the trailing window: the repaired accumulator satisfies it.
    expect(canSatisfy("yahoo", { resolution: "INTRADAY", lookbackDays: 55 }, NOW).answer).toBe("YES");
    // 18 months of 5m research does not — and the machine knows WITHOUT failing a request.
    const deep = canSatisfy("yahoo", { resolution: "INTRADAY", lookbackDays: 540 }, NOW);
    expect(deep.answer).toBe("NO");
    expect(deep.reason).toMatch(/only the most recent 60 days/);
    expect(deep.reason).toMatch(/deeper source is needed/);
  });

  it("knows Upstox could serve the deep requirement but is not accessible — capability and access are separate facts", () => {
    const answer = canSatisfy("upstox-v3", { resolution: "INTRADAY", lookbackDays: 540 }, NOW);
    expect(answer.answer).toBe("NO");
    expect(answer.reason).toMatch(/no owner credentials/);
    // The declared capability itself remains true and dated — it is the ACCESS that is missing.
    expect(SOURCE_CAPABILITIES["upstox-v3"]?.intradayHistoryFloor).toBe("2022-01-01");
  });

  it("refuses research datasets and non-authoritative sources for validation-grade requirements", () => {
    // USAGE RIGHTS outrank capability: Yahoo's terms make it research/backtest only, so that is
    // the refusal a caller sees. The capability layer's own validationAuthority=false remains as
    // the second guard beneath it — both must hold, and each states its own reason.
    expect(canSatisfy("yahoo", { resolution: "D", lookbackDays: 300, validationGrade: true }, NOW).reason).toMatch(
      /not permitted for VALIDATION/,
    );
    expect(SOURCE_CAPABILITIES.yahoo?.validationAuthority, "the capability guard still stands beneath").toBe(false);
    expect(canSatisfy("aeron7-archive", { resolution: "INTRADAY", lookbackDays: 30, validationGrade: true }, NOW).answer).toBe("NO");
    // A research dataset is refused for BACKTEST by its usage policy; the capability layer's own
    // research-only marker still stands beneath it.
    expect(canSatisfy("rajgmishra-dataset", { resolution: "INTRADAY", lookbackDays: 30 }, NOW).reason).toMatch(
      /not permitted for BACKTEST/,
    );
    expect(SOURCE_CAPABILITIES["rajgmishra-dataset"]?.disabledReason).toMatch(/research-only/);
  });

  it("keeps the probed-unhealthy and capability-limited sources out of every plan", () => {
    // These are refused on USAGE first (research-only), and their capability records still carry
    // the technical reasons — a source can be doubly ineligible and should say so precisely.
    expect(canSatisfy("openchart", { resolution: "INTRADAY", lookbackDays: 30 }, NOW).reason).toMatch(
      /not permitted for BACKTEST/,
    );
    expect(SOURCE_CAPABILITIES.openchart?.disabledReason).toMatch(/UNHEALTHY/);
    expect(canSatisfy("nsepython", { resolution: "D", lookbackDays: 300 }, NOW).answer).toBe("NO");
    expect(SOURCE_CAPABILITIES.nsepython?.disabledReason).toMatch(/NEVER historical equity/);
    expect(sourcesFor({ resolution: "INTRADAY", lookbackDays: 30 }, NOW)).toEqual(["yahoo"]);
  });

  it("reads a stale claim as UNKNOWN, never as truth", () => {
    const later = new Date(NOW.getTime() + (CAPABILITY_FRESHNESS_DAYS + 1) * 86_400_000);
    const answer = canSatisfy("yahoo", { resolution: "INTRADAY", lookbackDays: 10 }, later);
    expect(answer.answer).toBe("UNKNOWN");
    expect(answer.reason).toMatch(/Re-probe; a stale claim is not truth/);
    // An undeclared source is UNKNOWN too — absence of a claim is not a denial.
    expect(canSatisfy("external-csv", { resolution: "D", lookbackDays: 10 }, NOW).answer).toBe("UNKNOWN");
  });

  it("every declaration carries evidence and a verification date — the rule the wrong claim broke", () => {
    for (const capability of Object.values(SOURCE_CAPABILITIES)) {
      expect(capability!.claim.verifiedAt, `${capability!.sourceId} has no verifiedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        Boolean(capability!.claim.sourceCitation ?? capability!.claim.probeEvidence),
        `${capability!.sourceId} claims a capability with neither a citation nor a probe`,
      ).toBe(true);
    }
  });

  it("only the exchange's own files may define canonical identity", () => {
    const authorities = Object.values(SOURCE_CAPABILITIES).filter((capability) => capability!.canonicalIdentity);
    expect(authorities.map((capability) => capability!.sourceId)).toEqual(["nse-official"]);
  });
});
