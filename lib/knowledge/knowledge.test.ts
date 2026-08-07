import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import {
  contentHash,
  countTrials,
  getArchivedSource,
  listAudit,
  recordAudit,
  recordClaim,
  recordConcept,
  recordFailure,
  recordHypothesis,
  recordLesson,
  recordSource,
  recordStrategySpec,
  recordTrial,
  setSourceStatus,
  traceBack,
  traceForward,
  verifyClaim,
} from "./repository";
import { KnowledgeError } from "./types";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-knowledge-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "knowledge.db");
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function seedChain() {
  const { id: sourceId } = recordSource({
    kind: "paper",
    title: "Post-earnings announcement drift in emerging markets",
    url: "https://example.org/pead",
    content: "Abstract: drift persists for 60 days after a positive surprise.",
    license: "CC-BY-4.0",
    authors: ["A. Researcher"],
  });

  const claimId = recordClaim({
    sourceId,
    statement: "Positive earnings surprises are followed by 60 days of positive drift.",
    locator: "p.4",
    epistemicStatus: "historically_observed",
    confidence: 0.6,
    indiaRelevant: true,
  });

  const hypothesisId = recordHypothesis({
    claimId,
    title: "PEAD on NSE large caps",
    statement: "NSE large caps exhibit drift after positive surprises above 5%.",
    market: "NSE",
    createdBy: "claude_interactive",
  });

  const specId = recordStrategySpec({
    hypothesisId,
    name: "pead_nse",
    version: 1,
    dsl: { entry: { surprise: { gt: 0.05 } }, exit: { days: 60 } },
    createdBy: "claude_interactive",
  });

  const trialId = recordTrial({
    strategySpecId: specId,
    kind: "replay",
    verdict: "fail",
    reason: "cost_failure",
    metrics: { profitFactor: 0.92 },
    actor: "autonomous_worker",
  });

  const lessonId = recordLesson({
    plane: "computational_finance",
    level: "quant",
    title: "Why PEAD dies after costs on NSE",
    body: "Drift magnitude is smaller than round-trip cost for the tested universe.",
    citations: [sourceId, claimId],
  });

  return { sourceId, claimId, hypothesisId, specId, trialId, lessonId };
}

describe("source ingestion", () => {
  it("deduplicates by content hash instead of creating a second row", () => {
    const first = recordSource({ kind: "paper", title: "A", content: "identical body" });
    const second = recordSource({ kind: "paper", title: "A duplicate title", content: "identical body" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("hashes content stably", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });

  it("archives exact source content and verifies its hash on retrieval", () => {
    const content = "Exact source text, including punctuation and spacing.";
    const { id } = recordSource({ kind: "report", title: "Stored report", content });
    const source = getArchivedSource(id);
    expect(source?.content).toBe(content);
    expect(source?.contentHash).toBe(contentHash(content));
  });

  it("fails closed when archived content is missing or no longer matches its hash", () => {
    const { id } = recordSource({ kind: "report", title: "Stored report", content: "original" });
    getDb().update(schema.knowledgeSources).set({ content: "tampered" }).run();
    expect(getArchivedSource(id)).toBeNull();
    expect(() => recordClaim({ sourceId: id, statement: "Cannot cite corrupt content." })).toThrow(/archived source/i);
  });

  it("rejects oversized source content at the repository boundary", () => {
    expect(() =>
      recordSource({ kind: "web", title: "Too large", content: "x".repeat(200_001) }),
    ).toThrow(/200000/);
  });

  it("records rejection with a reason", () => {
    const { id } = recordSource({ kind: "web", title: "Blog", content: "unsourced claims" });
    setSourceStatus(id, "rejected", "no methodology");
    const row = getDb().select().from(schema.knowledgeSources).all()[0];
    expect(row.status).toBe("rejected");
    expect(row.rejectionReason).toBe("no methodology");
  });

  it("does not resurrect rejected or downgrade verified duplicate sources", () => {
    const rejected = recordSource({ kind: "web", title: "Rejected", content: "same rejected content" });
    setSourceStatus(rejected.id, "rejected", "no methodology");
    recordSource({ kind: "web", title: "Duplicate rejected", content: "same rejected content" });
    expect(getDb().select().from(schema.knowledgeSources).all().find((row) => row.id === rejected.id)).toMatchObject({
      status: "rejected",
      rejectionReason: "no methodology",
    });

    const verified = recordSource({ kind: "paper", title: "Verified", content: "same verified content" });
    setSourceStatus(verified.id, "verified");
    recordSource({ kind: "paper", title: "Duplicate verified", content: "same verified content" });
    expect(getDb().select().from(schema.knowledgeSources).all().find((row) => row.id === verified.id)?.status).toBe("verified");
  });

  it("refuses a claim against an unknown source", () => {
    expect(() => recordClaim({ sourceId: "src_missing", statement: "x" })).toThrow(KnowledgeError);
  });
});

describe("claims and epistemic status", () => {
  it("defaults to inferred and can be promoted on verification", () => {
    const { id: sourceId } = recordSource({ kind: "paper", title: "P", content: "body" });
    const claimId = recordClaim({ sourceId, statement: "something might hold" });

    let claim = getDb().select().from(schema.knowledgeClaims).all()[0];
    expect(claim.epistemicStatus).toBe("inferred");

    verifyClaim(claimId, "quant_validator", "known");
    claim = getDb().select().from(schema.knowledgeClaims).all()[0];
    expect(claim.epistemicStatus).toBe("known");
    expect(claim.verifiedBy).toBe("quant_validator");
    expect(claim.verifiedAt).not.toBeNull();
  });
});

describe("lessons require resolvable citations", () => {
  it("rejects a lesson citing something that does not exist", () => {
    expect(() =>
      recordLesson({
        plane: "computational_finance",
        level: "beginner",
        title: "Unsourced",
        body: "trust me",
        citations: ["src_doesnotexist"],
      }),
    ).toThrow(/does not resolve/);
  });

  it("accepts a lesson citing a real source and claim", () => {
    const { lessonId } = seedChain();
    expect(lessonId).toMatch(/^les_/);
  });
});

describe("the memory chain", () => {
  it("links source to claim to hypothesis to strategy to trial to lesson", () => {
    const { sourceId, claimId, hypothesisId, specId, lessonId } = seedChain();
    const trace = traceForward(sourceId);

    const ids = trace.nodes.map((node) => node.id);
    expect(ids).toContain(claimId);
    expect(ids).toContain(hypothesisId);
    expect(ids).toContain(specId);
    expect(ids).toContain(lessonId);
    expect(ids.some((id) => id.startsWith("trl_"))).toBe(true);

    expect(trace.edges).toContainEqual({ from: sourceId, to: claimId, relation: "asserts" });
    expect(trace.edges).toContainEqual({ from: claimId, to: hypothesisId, relation: "motivates" });
    expect(trace.edges).toContainEqual({ from: hypothesisId, to: specId, relation: "implemented_as" });
  });

  it("walks back from a trial to the source that justifies it", () => {
    const { sourceId, claimId, hypothesisId, specId, trialId } = seedChain();
    const trace = traceBack(`trl_${trialId}`);

    const ids = trace.nodes.map((node) => node.id);
    expect(ids).toContain(specId);
    expect(ids).toContain(hypothesisId);
    expect(ids).toContain(claimId);
    expect(ids).toContain(sourceId);
    expect(trace.root.type).toBe("trial");
    expect(trace.root.status).toBe("fail");
  });

  it("walks back from a strategy to its source", () => {
    const { sourceId, specId } = seedChain();
    const trace = traceBack(specId);
    expect(trace.nodes.map((node) => node.id)).toContain(sourceId);
  });

  it("preserves the failing verdict in the trace", () => {
    const { sourceId } = seedChain();
    const trial = traceForward(sourceId).nodes.find((node) => node.type === "trial");
    expect(trial?.status).toBe("fail");
    expect(trial?.detail).toBe("cost_failure");
  });

  it("rejects an unrecognised node id", () => {
    expect(() => traceBack("nope_123")).toThrow(KnowledgeError);
  });
});

describe("trial accounting", () => {
  it("counts every attempt, including failures", () => {
    const { specId } = seedChain();
    recordTrial({ strategySpecId: specId, kind: "walk_forward", verdict: "fail", actor: "autonomous_worker" });
    recordTrial({ strategySpecId: specId, kind: "monte_carlo", verdict: "pass", actor: "autonomous_worker" });

    expect(countTrials(specId)).toBe(3);
  });

  it("refuses a trial against an unknown strategy", () => {
    expect(() =>
      recordTrial({ strategySpecId: "stg_missing", kind: "replay", verdict: "pass", actor: "x" }),
    ).toThrow(KnowledgeError);
  });

  it("cannot delete a losing trial", () => {
    const { specId } = seedChain();
    expect(() => getDb().delete(schema.trials).where(undefined).run()).toThrow(/append-only/i);
    expect(countTrials(specId)).toBe(1);
  });
});

describe("concepts and failures", () => {
  it("returns the same id for a repeated concept", () => {
    const first = recordConcept("computational_finance", "Realised volatility", "Sum of squared returns.");
    const second = recordConcept("computational_finance", "Realised volatility", "Different summary.");
    expect(second).toBe(first);
  });

  it("keeps separate concepts per plane", () => {
    const finance = recordConcept("computational_finance", "Entropy", "Dispersion measure.");
    const physics = recordConcept("quantum_physics", "Entropy", "Von Neumann entropy.");
    expect(finance).not.toBe(physics);
  });

  it("records failure memory with a lesson", () => {
    const id = recordFailure("strategy", "cost_failure", "PF fell below 1 at 2x costs", "stg_x", "Model costs first.");
    expect(id).toBeGreaterThan(0);
  });
});

describe("audit trail", () => {
  it("records allowed and denied decisions", () => {
    recordAudit({ actor: "autonomous_worker", action: "discover_source", decision: "allowed", learningMode: "learning" });
    recordAudit({
      actor: "autonomous_worker",
      action: "place_order",
      decision: "denied",
      denialCode: "ACTION_PROHIBITED",
      detail: "Orders are placed manually by the owner.",
    });

    const events = listAudit();
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe("place_order");
    expect(events[0].decision).toBe("denied");
    expect(events[0].denialCode).toBe("ACTION_PROHIBITED");
  });
});
