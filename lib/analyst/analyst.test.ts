import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { evidenceSnapshotHash } from "@/lib/ai/evidence";
import { persistEvidencePackage } from "@/lib/ai/evidence-store";
import { parseInstrument } from "@/lib/market/instruments";
import { AnalystError, listAnalyses, listAnalysesForInstrument, recordAnalysis } from "./service";
import { epistemicProfile, validateAnalystRecord, type AnalystRecord } from "./schema";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-analyst-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "analyst.db");
  closeDbForTests();
  persistEvidencePackage(EVIDENCE_PACKAGE);
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const EVIDENCE_ITEMS = [
  {
    id: "quote",
    label: "Normalized quote",
    value: { price: 100 },
    quality: "LIVE" as const,
    sourceId: "fixture:quote",
  },
  {
    id: "history:drift",
    label: "Historical drift study",
    value: { days: 20 },
    quality: "CALCULATED" as const,
    sourceId: "src_history",
  },
];
const EVIDENCE_PACKAGE = {
  instrument: parseInstrument("IN:XNSE:RELIANCE"),
  generatedAt: "2026-08-05T12:00:00.000Z",
  snapshotHash: evidenceSnapshotHash("IN:XNSE:RELIANCE", EVIDENCE_ITEMS, "2026-08-05T12:00:00.000Z"),
  items: EVIDENCE_ITEMS,
};

const BULLISH: AnalystRecord = {
  instrumentId: "IN:XNSE:RELIANCE",
  question: "Is the breakout supported?",
  stance: "bullish",
  conviction: 0.6,
  summary: "Price holds above a rising 50-day average with sector confirmation and improving breadth.",
  debate: {
    bull: ["Price above rising SMA50", "Sector leading the index"],
    bear: ["Index divergence on the weekly"],
    neutral: ["Wait for the candle to complete"],
  },
  evidence: [
    { statement: "Close is 4% above the 50-day average.", epistemicStatus: "inferred", citation: "quote" },
    { statement: "Similar setups drifted for 20 days historically.", epistemicStatus: "inferred", citation: "history:drift" },
  ],
  risks: ["Sector rotation out of energy"],
  invalidation: ["A daily close below the 50-day average"],
  levels: { entry: 100, stop: 94, target: 118 },
  snapshotHash: EVIDENCE_PACKAGE.snapshotHash,
};

describe("analyst record validation", () => {
  it("accepts a well-formed bullish analysis", () => {
    expect(validateAnalystRecord(BULLISH, EVIDENCE_PACKAGE).ok).toBe(true);
  });

  it("rejects a directional stance built only on inference", () => {
    const weak: AnalystRecord = {
      ...BULLISH,
      evidence: [{ statement: "Momentum feels strong.", epistemicStatus: "inferred" }],
    };
    const validation = validateAnalystRecord(weak, EVIDENCE_PACKAGE);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("UNRESOLVED_CITATION");
  });

  it("rejects an analysis with no invalidation condition", () => {
    const validation = validateAnalystRecord({ ...BULLISH, invalidation: [] }, EVIDENCE_PACKAGE);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("NO_INVALIDATION");
  });

  it("rejects observed evidence without a resolvable citation", () => {
    const validation = validateAnalystRecord({
      ...BULLISH,
      evidence: [{ statement: "Observed without provenance.", epistemicStatus: "inferred" }],
    }, EVIDENCE_PACKAGE);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("UNRESOLVED_CITATION");
  });

  it("rejects unknown citations and instrument-mismatched evidence packages", () => {
    const unknown = validateAnalystRecord({
      ...BULLISH,
      evidence: [{ statement: "Unknown citation.", epistemicStatus: "inferred", citation: "invented" }],
    }, EVIDENCE_PACKAGE);
    expect(unknown.code).toBe("UNRESOLVED_CITATION");

    const mismatch = validateAnalystRecord(
      BULLISH,
      { ...EVIDENCE_PACKAGE, instrument: parseInstrument("US:XNAS:AAPL") },
    );
    expect(mismatch.code).toBe("EVIDENCE_INSTRUMENT_MISMATCH");
  });

  it("requires the opposing case to be recorded", () => {
    const validation = validateAnalystRecord({
      ...BULLISH,
      debate: { bull: ["only good news"], bear: [], neutral: [] },
    }, EVIDENCE_PACKAGE);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("MISSING_COUNTERCASE");
  });

  it("rejects a long stop placed above the entry", () => {
    const validation = validateAnalystRecord({ ...BULLISH, levels: { entry: 100, stop: 105 } }, EVIDENCE_PACKAGE);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("STOP_ABOVE_ENTRY");
  });

  it("rejects a short stop placed below the entry", () => {
    const validation = validateAnalystRecord({
      ...BULLISH,
      stance: "bearish",
      debate: { bull: ["support nearby"], bear: ["breaking down"], neutral: [] },
      levels: { entry: 100, stop: 95 },
    }, EVIDENCE_PACKAGE);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("STOP_BELOW_ENTRY");
  });

  it("lets abstain through without evidence requirements", () => {
    const abstain: AnalystRecord = {
      instrumentId: "IN:XNSE:RELIANCE",
      stance: "abstain",
      conviction: 0,
      summary: "Evidence is stale and conflicting; no view is warranted right now.",
      debate: { bull: [], bear: [], neutral: [] },
      evidence: [],
      risks: [],
      invalidation: [],
      snapshotHash: EVIDENCE_PACKAGE.snapshotHash,
    };
    expect(validateAnalystRecord(abstain, EVIDENCE_PACKAGE).ok).toBe(true);
  });

  it("summarises the epistemic profile", () => {
    const profile = epistemicProfile(BULLISH);
    expect(profile.known).toBe(0);
    expect(profile.historically_observed).toBe(0);
    expect(profile.inferred).toBe(2);
    expect(profile.conflicting).toBe(0);
  });
});

describe("recordAnalysis", () => {
  it("persists and reads back a full analysis", () => {
    const stored = recordAnalysis(BULLISH);
    expect(stored.id).toBeGreaterThan(0);
    expect(stored.stance).toBe("bullish");
    expect(stored.snapshotHash).toHaveLength(64);
    const row = getDb().select().from(schema.aiRuns).all()[0];
    expect(JSON.parse(row.evidenceJson ?? "null").snapshotHash).toBe(stored.snapshotHash);

    const all = listAnalyses();
    expect(all).toHaveLength(1);
    expect(all[0].record.debate.bear).toContain("Index divergence on the weekly");
  });

  it("filters by instrument", () => {
    recordAnalysis(BULLISH);
    const aaplItems = EVIDENCE_ITEMS.map((item) => ({ ...item, sourceId: `fixture:aapl:${item.id}` }));
    const aaplPackage = {
      instrument: parseInstrument("US:XNAS:AAPL"),
      generatedAt: EVIDENCE_PACKAGE.generatedAt,
      snapshotHash: evidenceSnapshotHash("US:XNAS:AAPL", aaplItems, EVIDENCE_PACKAGE.generatedAt),
      items: aaplItems,
    };
    persistEvidencePackage(aaplPackage);
    recordAnalysis({ ...BULLISH, instrumentId: "US:XNAS:AAPL", snapshotHash: aaplPackage.snapshotHash });

    expect(listAnalysesForInstrument("IN:XNSE:RELIANCE")).toHaveLength(1);
    expect(listAnalysesForInstrument("US:XNAS:AAPL")).toHaveLength(1);
  });

  it("refuses a schema-invalid payload", () => {
    expect(() => recordAnalysis({ instrumentId: "X", stance: "moon" })).toThrow(AnalystError);
  });

  it("refuses an epistemically unsupported payload", () => {
    expect(() =>
      recordAnalysis({ ...BULLISH, evidence: [{ statement: "Vibes are good.", epistemicStatus: "inferred" }] }),
    ).toThrow(/cite an item|server evidence/i);
  });

  it("does not let a caller self-promote free-form evidence to known", () => {
    expect(() => recordAnalysis({
      ...BULLISH,
      evidence: [{ statement: "Caller says this is known.", epistemicStatus: "known", citation: "quote" }],
    })).toThrow(/free-form|inferred/i);
  });

  it("rejects unknown fields rather than silently dropping them", () => {
    expect(() => recordAnalysis({ ...BULLISH, orderQuantity: 100 })).toThrow(AnalystError);
  });

  it("rejects caller-fabricated and unknown evidence snapshots", () => {
    expect(() => recordAnalysis({ ...BULLISH, snapshotHash: "f".repeat(64) })).toThrow(/snapshot/i);
    expect(() => recordAnalysis({ ...BULLISH, evidencePackage: EVIDENCE_PACKAGE })).toThrow(AnalystError);
  });
});
