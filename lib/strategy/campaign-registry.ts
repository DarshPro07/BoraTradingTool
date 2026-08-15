import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Registered research campaigns — the owner's model for serious quant work (2026-08-15):
 * a small set of EXPLICITLY declared strategy families, frozen BEFORE the first result, with
 * variants generated only inside each family's declared dimensions and every configuration
 * counted as a selection trial.
 *
 * The pin is mechanical, not procedural: each family's `declaration_hash` is the SHA-256 of its
 * canonical declaration. Re-registering an identical declaration is a no-op; re-registering a
 * CHANGED one is REFUSED loudly. "Don't silently alter the contract because early results look
 * poor" is therefore not a rule anyone has to remember — the registry cannot do it. The honest
 * paths after a disappointing result remain: declare a NEW family (its own id, its own trial
 * count) or a NEW campaign.
 */

export interface FamilyDeclaration {
  familyId: string;
  name: string;
  /** The causal claim — "why would this make money", never a parameterization. */
  economicHypothesis: string;
  mechanism: string;
  /** The box inside which a change is a variant; outside it, a new family. */
  allowedVariantDimensions: Record<string, string>;
}

export interface CampaignDeclaration {
  campaignId: string;
  name: string;
  question: string;
  families: FamilyDeclaration[];
}

export interface RegistrationReport {
  campaign: "created" | "unchanged" | "refused";
  families: { familyId: string; outcome: "created" | "unchanged" | "refused"; reason?: string }[];
  refusals: string[];
}

/** Canonical, key-ordered JSON — the hash must not depend on object-literal key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function familyDeclarationHash(campaignId: string, family: FamilyDeclaration): string {
  return createHash("sha256")
    .update(
      canonical({
        campaignId,
        familyId: family.familyId,
        name: family.name,
        economicHypothesis: family.economicHypothesis,
        mechanism: family.mechanism,
        allowedVariantDimensions: family.allowedVariantDimensions,
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
}

export function registerCampaignDeclaration(
  declaration: CampaignDeclaration,
  actor: string,
  now = new Date(),
): RegistrationReport {
  const db = getDb();
  const report: RegistrationReport = { campaign: "unchanged", families: [], refusals: [] };

  const existingCampaign = db
    .select()
    .from(schema.researchCampaigns)
    .where(eq(schema.researchCampaigns.id, declaration.campaignId))
    .get();
  if (!existingCampaign) {
    db.insert(schema.researchCampaigns)
      .values({
        id: declaration.campaignId,
        name: declaration.name,
        question: declaration.question,
        createdAt: now,
        createdBy: actor,
      })
      .run();
    report.campaign = "created";
  } else if (existingCampaign.name !== declaration.name || existingCampaign.question !== declaration.question) {
    report.campaign = "refused";
    report.refusals.push(
      `campaign ${declaration.campaignId} already exists with a DIFFERENT name/question — a ` +
        "campaign cannot be silently redefined; declare a new campaign id instead",
    );
    return report; // families of a refused campaign are not touched
  }

  for (const family of declaration.families) {
    const hash = familyDeclarationHash(declaration.campaignId, family);
    const existing = db
      .select()
      .from(schema.strategyFamilies)
      .where(eq(schema.strategyFamilies.id, family.familyId))
      .get();
    if (!existing) {
      db.insert(schema.strategyFamilies)
        .values({
          id: family.familyId,
          researchCampaignId: declaration.campaignId,
          name: family.name,
          economicHypothesis: family.economicHypothesis,
          mechanism: family.mechanism,
          allowedVariantDimensions: JSON.stringify(family.allowedVariantDimensions),
          declarationHash: hash,
          createdAt: now,
          createdBy: actor,
        })
        .run();
      report.families.push({ familyId: family.familyId, outcome: "created" });
      continue;
    }
    if (existing.declarationHash === hash && existing.researchCampaignId === declaration.campaignId) {
      report.families.push({ familyId: family.familyId, outcome: "unchanged" });
      continue;
    }
    const reason =
      existing.researchCampaignId !== declaration.campaignId
        ? `family ${family.familyId} already belongs to campaign ${existing.researchCampaignId}`
        : `family ${family.familyId} exists with declaration_hash ${existing.declarationHash}, ` +
          `this declaration hashes to ${hash} — a family cannot be silently redefined after ` +
          "experiments may have run; declare a NEW family id (its own trial count) instead";
    report.families.push({ familyId: family.familyId, outcome: "refused", reason });
    report.refusals.push(reason);
  }

  return report;
}
