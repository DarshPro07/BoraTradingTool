import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { buildResearchSnapshot } from "@/lib/market/service";
import { parseInstrument } from "@/lib/market/instruments";
import { buildEvidencePackage, assertValidCitations } from "./evidence";
import { getStoredEvidencePackage, persistEvidencePackage } from "./evidence-store";
import { analyzeInstrument, getAiStatus } from "./service";
import { ResearchAnalysisSchema } from "./schema";

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-ai-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "ai.db"));
  vi.stubEnv("MARKETPULSE_TEST_MODE", "1");
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("AI research boundary", () => {
  it("builds stable bounded evidence for US and India", async () => {
    for (const id of ["US:XNAS:AAPL", "IN:XNSE:RELIANCE"]) {
      const snapshot = await buildResearchSnapshot(parseInstrument(id));
      const first = buildEvidencePackage(snapshot);
      const second = buildEvidencePackage(snapshot);
      expect(first.snapshotHash).toBe(second.snapshotHash);
      expect(JSON.stringify(first).length).toBeLessThan(25_000);
      expect(first.items.some((item) => item.id === "quote")).toBe(true);
    }
  });

  it("rejects unknown citation IDs", () => {
    expect(() => assertValidCitations(
      { citations: [{ evidenceId: "invented" }] },
      { instrument: parseInstrument("AAPL"), generatedAt: "", snapshotHash: "hash", items: [] },
    )).toThrow(/Unknown evidence citation/);
  });

  it("normalizes fake Anthropic and OpenAI runs and stores no secrets", async () => {
    const results = await Promise.all([
      analyzeInstrument({ provider: "anthropic", instrumentId: "US:XNAS:AAPL", purpose: "DEEP_DIVE", question: "Review risk." }),
      analyzeInstrument({ provider: "openai", instrumentId: "IN:XNSE:RELIANCE", purpose: "THESIS_CHECK", question: "Challenge the thesis." }),
    ]);
    for (const result of results) {
      expect(ResearchAnalysisSchema.parse(result.analysis).verdict).toBe("HOLD");
      expect(result.analysis.disclaimer).toMatch(/not financial advice/i);
    }
    const rows = getDb().select().from(schema.aiRuns).all();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/api[_-]?key|Bearer\s|secret/i);
    expect(getAiStatus()).toMatchObject({ advisoryOnly: true, orderCapability: false });
  });

  it("rejects malformed analysis output", () => {
    expect(() => ResearchAnalysisSchema.parse({ verdict: "MAYBE" })).toThrow();
  });

  it("requires citations and invalidation for directional model output", () => {
    const base = {
      verdict: "BUY",
      confidence: 0.8,
      summary: "The observed setup supports a directional research conclusion.",
      bullCase: [],
      bearCase: [],
      risks: [],
      invalidationConditions: [],
      missingEvidence: [],
      citations: [],
      disclaimer: "Research only, not financial advice.",
    };
    expect(ResearchAnalysisSchema.safeParse(base).success).toBe(false);
    expect(
      ResearchAnalysisSchema.safeParse({
        ...base,
        invalidationConditions: ["Price closes below support."],
        citations: [{ evidenceId: "quote", claim: "The quote is above support." }],
      }).success,
    ).toBe(true);
  });

  it("persists the exact evidence package used for each completed run", async () => {
    const result = await analyzeInstrument({
      provider: "anthropic",
      instrumentId: "US:XNAS:AAPL",
      purpose: "RISK_REVIEW",
      question: "Persist this evidence.",
    });
    const row = getDb().select().from(schema.aiRuns).all()[0];
    const evidence = JSON.parse(row.evidenceJson ?? "null") as { snapshotHash?: string; items?: unknown[] } | null;
    expect(evidence?.snapshotHash).toBe(result.snapshotHash);
    expect(evidence?.items?.length).toBeGreaterThan(0);
    expect(getStoredEvidencePackage(result.snapshotHash)?.snapshotHash).toBe(result.snapshotHash);
  });

  it("rejects evidence packages with duplicate IDs", async () => {
    const snapshot = await buildResearchSnapshot(parseInstrument("US:XNAS:AAPL"));
    const evidence = buildEvidencePackage(snapshot);
    const duplicated = { ...evidence, items: [evidence.items[0], evidence.items[0]] };
    expect(() => persistEvidencePackage(duplicated)).toThrow(/duplicate/i);
  });
});
