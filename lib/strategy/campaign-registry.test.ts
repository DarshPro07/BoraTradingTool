import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  familyDeclarationHash,
  registerCampaignDeclaration,
  type CampaignDeclaration,
} from "./campaign-registry";
import { NSE_QC_001 } from "./campaigns/nse-qc-001";

function declaration(): CampaignDeclaration {
  // A deep copy so tamper tests can mutate without touching the frozen module constant.
  return JSON.parse(JSON.stringify(NSE_QC_001)) as CampaignDeclaration;
}

describe("the campaign registry — the pin is mechanical", () => {
  useTemporaryDatabase();

  it("registers NSE-QC-001: one campaign, five families, each with its declaration hash", () => {
    const report = registerCampaignDeclaration(declaration(), "test-owner");
    expect(report.campaign).toBe("created");
    expect(report.families).toHaveLength(5);
    expect(report.families.every((family) => family.outcome === "created")).toBe(true);
    expect(report.refusals).toEqual([]);

    const rows = getDb().select().from(schema.strategyFamilies).all();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const declared = NSE_QC_001.families.find((family) => family.familyId === row.id)!;
      expect(row.researchCampaignId).toBe("camp_nse_qc_001");
      expect(row.declarationHash).toBe(familyDeclarationHash("camp_nse_qc_001", declared));
      expect(row.economicHypothesis.length).toBeGreaterThan(80);
    }
  });

  it("is idempotent: re-registering the identical declaration changes nothing", () => {
    registerCampaignDeclaration(declaration(), "test-owner");
    const second = registerCampaignDeclaration(declaration(), "test-owner");
    expect(second.campaign).toBe("unchanged");
    expect(second.families.every((family) => family.outcome === "unchanged")).toBe(true);
    expect(getDb().select().from(schema.strategyFamilies).all()).toHaveLength(5);
  });

  it("REFUSES a silently altered family — the owner's no-alteration rule as a mechanism", () => {
    registerCampaignDeclaration(declaration(), "test-owner");
    const tampered = declaration();
    // The exact failure mode the rule exists for: widening the search box after poor results.
    tampered.families[0].allowedVariantDimensions.range_window = "1m-240m";
    const report = registerCampaignDeclaration(tampered, "test-owner");
    const orb = report.families.find((family) => family.familyId === "fam_qc001_orb");
    expect(orb?.outcome).toBe("refused");
    expect(orb?.reason).toMatch(/cannot be silently redefined/);
    // The stored declaration is untouched.
    const row = getDb()
      .select()
      .from(schema.strategyFamilies)
      .all()
      .find((family) => family.id === "fam_qc001_orb")!;
    expect(row.declarationHash).toBe(familyDeclarationHash("camp_nse_qc_001", NSE_QC_001.families[0]));
    // Untampered siblings still register as unchanged, not refused.
    expect(report.families.filter((family) => family.outcome === "unchanged")).toHaveLength(4);
  });

  it("REFUSES a redefined campaign question, touching no families", () => {
    registerCampaignDeclaration(declaration(), "test-owner");
    const tampered = declaration();
    tampered.question = "a different, softer question";
    const report = registerCampaignDeclaration(tampered, "test-owner");
    expect(report.campaign).toBe("refused");
    expect(report.families).toHaveLength(0);
  });

  it("the hash is key-order independent but content sensitive", () => {
    const family = declaration().families[0];
    const reordered = {
      ...family,
      allowedVariantDimensions: Object.fromEntries(Object.entries(family.allowedVariantDimensions).reverse()),
    };
    expect(familyDeclarationHash("c", reordered)).toBe(familyDeclarationHash("c", family));
    expect(familyDeclarationHash("c", { ...family, mechanism: family.mechanism + "." })).not.toBe(
      familyDeclarationHash("c", family),
    );
  });
});
