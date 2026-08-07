import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  EvidencePackageSchema,
  hasValidEvidenceHash,
  type EvidencePackage,
} from "./evidence";

export class EvidenceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceStoreError";
  }
}

export function persistEvidencePackage(input: EvidencePackage): EvidencePackage {
  const parsed = EvidencePackageSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceStoreError(`Invalid evidence package: ${parsed.error.message}`);
  const evidence = parsed.data as EvidencePackage;
  if (new Set(evidence.items.map((item) => item.id)).size !== evidence.items.length) {
    throw new EvidenceStoreError("Evidence package contains duplicate evidence IDs.");
  }
  if (!hasValidEvidenceHash(evidence)) throw new EvidenceStoreError("Evidence package hash does not match its content.");

  const db = getDb();
  const existing = db
    .select()
    .from(schema.evidenceSnapshots)
    .where(eq(schema.evidenceSnapshots.snapshotHash, evidence.snapshotHash))
    .get();
  const serialized = JSON.stringify(evidence);
  if (existing) {
    if (existing.evidenceJson !== serialized || existing.instrumentId !== evidence.instrument.id) {
      throw new EvidenceStoreError("Evidence snapshot hash already exists with different content.");
    }
    return evidence;
  }

  db.insert(schema.evidenceSnapshots).values({
    snapshotHash: evidence.snapshotHash,
    instrumentId: evidence.instrument.id,
    evidenceJson: serialized,
    generatedAt: new Date(evidence.generatedAt),
    createdAt: new Date(),
  }).run();
  return evidence;
}

export function getStoredEvidencePackage(snapshotHash: string): EvidencePackage | null {
  const row = getDb()
    .select()
    .from(schema.evidenceSnapshots)
    .where(eq(schema.evidenceSnapshots.snapshotHash, snapshotHash))
    .get();
  if (!row) return null;
  try {
    const parsed = EvidencePackageSchema.safeParse(JSON.parse(row.evidenceJson));
    if (!parsed.success) return null;
    const evidence = parsed.data as EvidencePackage;
    return hasValidEvidenceHash(evidence) && evidence.snapshotHash === row.snapshotHash ? evidence : null;
  } catch {
    return null;
  }
}
