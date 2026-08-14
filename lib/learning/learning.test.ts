import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { getLearningMode, setLearningMode } from "@/lib/governance/runtime";
import { linkConcepts, recordConcept } from "@/lib/knowledge/repository";
import { enqueue } from "@/lib/research/queue";
import { ProposalError, advanceProposal, attachEvidence, createProposal, getProposal, listProposals } from "./evolution";
import { masteryByPlane, nextCurriculum, recordQuizResult } from "./curriculum";
import { runLearningCycle } from "./cycle";
import { recentCycleRuns } from "./run-log";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;
let previousQuantRoot: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  previousQuantRoot = process.env.QUANT_CORE_ROOT;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-learning-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "learning.db");
  // Point at an empty root so cycles never depend on the operator's real quant core.
  process.env.QUANT_CORE_ROOT = path.join(directory, "empty-core");
  process.env.QUANT_CORE_URL = "off";
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  if (previousQuantRoot === undefined) delete process.env.QUANT_CORE_ROOT;
  else process.env.QUANT_CORE_ROOT = previousQuantRoot;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const PROPOSAL = {
  origin: "research" as const,
  actionId: "improve_dashboard_page",
  title: "Add stale badge to the scanner table",
  rationale: "Operators cannot currently tell whether scanner rows are from today.",
  touchedPaths: ["app/dashboard/page.tsx"],
};

function drivenToReviewed(): string {
  setLearningMode("evolving", "owner");
  const id = createProposal(PROPOSAL);
  advanceProposal(id, "tests_pending", "autonomous_worker");
  attachEvidence(id, { kind: "test", detail: "vitest run app", passed: true }, "owner");
  advanceProposal(id, "tests_passed", "autonomous_worker");
  advanceProposal(id, "reviewed", "owner", { reviewer: "code_reviewer" });
  return id;
}

describe("evolution proposals", () => {
  it("refuses a proposal for a prohibited action", () => {
    setLearningMode("evolving", "owner");
    expect(() => createProposal({ ...PROPOSAL, actionId: "modify_risk_kernel" })).toThrow(ProposalError);
    expect(() => createProposal({ ...PROPOSAL, actionId: "place_order" })).toThrow(/not permitted/);
  });

  it("refuses a proposal that would touch a protected path", () => {
    setLearningMode("evolving", "owner");
    for (const protectedPath of ["lib/governance/policy.ts", "lib/paper/risk.ts", ".mcp.json", ".env.local"]) {
      expect(() => createProposal({ ...PROPOSAL, touchedPaths: [protectedPath] }), protectedPath).toThrow(
        ProposalError,
      );
    }
  });

  it("allows proposal creation in evolving mode (default)", () => {
    // System defaults to evolving — proposals are allowed.
    expect(getLearningMode()).toBe("evolving");
    const id = createProposal(PROPOSAL);
    expect(getProposal(id)?.status).toBe("draft");
  });

  it("creates a draft proposal in evolving mode", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    expect(getProposal(id)?.status).toBe("draft");
  });

  it("refuses to skip stages", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    expect(() => advanceProposal(id, "approved", "owner")).toThrow(/Cannot move a proposal/);
    expect(() => advanceProposal(id, "merged", "owner")).toThrow(ProposalError);
  });

  it("requires passing test evidence before the tests gate opens", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    advanceProposal(id, "tests_pending", "autonomous_worker");

    expect(() => advanceProposal(id, "tests_passed", "autonomous_worker")).toThrow(/Attach test evidence/);

    attachEvidence(id, { kind: "test", detail: "vitest run", passed: false }, "owner");
    expect(() => advanceProposal(id, "tests_passed", "autonomous_worker")).toThrow(/most recent test evidence failed/);

    // Fixing the code and re-running opens the gate, but the earlier failure stays on record.
    attachEvidence(id, { kind: "test", detail: "vitest run after fix", passed: true }, "owner");
    advanceProposal(id, "tests_passed", "autonomous_worker");
    expect(getProposal(id)?.status).toBe("tests_passed");

    const evidence = listProposals().find((proposal) => proposal.id === id)?.evidenceItems ?? [];
    expect(evidence.filter((item) => !item.passed)).toHaveLength(1);
  });

  it("rejects malformed evidence instead of treating truthy values as a passing run", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    expect(() =>
      attachEvidence(id, { kind: "test", detail: 7, passed: "yes" } as never, "owner"),
    ).toThrow(/evidence/i);
  });

  it("creates proposals in default autonomous mode", () => {
    // System defaults to evolving — proposal creation should work.
    expect(getLearningMode()).toBe("evolving");
    const id = createProposal(PROPOSAL);
    expect(id).toBeTruthy();
    const proposal = getProposal(id);
    expect(proposal).not.toBeNull();
    expect(proposal?.status).toBe("draft");
  });

  it("fails the test gate closed when persisted evidence is corrupt", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    advanceProposal(id, "tests_pending", "autonomous_worker");
    getDb()
      .update(schema.evolutionProposals)
      .set({ evidence: JSON.stringify([{ kind: "test", detail: 7, passed: "yes" }]) })
      .run();
    expect(() => advanceProposal(id, "tests_passed", "autonomous_worker")).toThrow(/Attach test evidence/);
  });

  it("forbids self-review", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    advanceProposal(id, "tests_pending", "autonomous_worker");
    attachEvidence(id, { kind: "test", detail: "vitest run", passed: true }, "owner");
    advanceProposal(id, "tests_passed", "autonomous_worker");

    expect(() =>
      advanceProposal(id, "reviewed", "owner", { reviewer: "owner" }),
    ).toThrow(/cannot be reviewed by the actor/);
  });

  it("does not let autonomous workers approve or merge their own proposals", () => {
    const id = drivenToReviewed();

    expect(() =>
      advanceProposal(id, "approved", "autonomous_worker", { reviewNotes: "Looks right." }),
    ).toThrow(/independent operator/);
    expect(getProposal(id)?.status).toBe("reviewed");

    advanceProposal(id, "approved", "owner", { reviewNotes: "Independent review accepted." });
    expect(getProposal(id)?.status).toBe("approved");

    expect(() => advanceProposal(id, "merged", "autonomous_worker")).toThrow(/independent operator/);

    advanceProposal(id, "merged", "owner");
    expect(getProposal(id)?.status).toBe("merged");
  });

  it("records every transition in the audit trail", () => {
    const id = drivenToReviewed();
    const actions = getDb().select().from(schema.auditEvents).all().map((event) => event.action);
    expect(actions).toContain("proposal_tests_passed");
    expect(actions).toContain("proposal_reviewed");
    expect(listProposals()[0].id).toBe(id);
  });

  it("allows rejection from any open stage", () => {
    setLearningMode("evolving", "owner");
    const id = createProposal(PROPOSAL);
    advanceProposal(id, "rejected", "owner", { reviewNotes: "Not worth the complexity." });
    expect(getProposal(id)?.status).toBe("rejected");
    expect(() => advanceProposal(id, "draft", "owner")).toThrow(/Cannot move a proposal/);
  });
});

describe("curriculum and mastery", () => {
  it("grows the review interval on success and collapses it on a miss", () => {
    const conceptId = recordConcept("computational_finance", "Realised volatility", "Sum of squared returns.");

    const first = recordQuizResult(conceptId, true);
    expect(first.score).toBe(1);

    const second = recordQuizResult(conceptId, true, new Date(Date.now() + 86_400_000));
    expect(second.interval).toBeGreaterThanOrEqual(first.interval);

    const missed = recordQuizResult(conceptId, false, new Date(Date.now() + 172_800_000));
    expect(missed.interval).toBe(1);
    expect(missed.score).toBeLessThan(1);
  });

  it("puts never-studied concepts in the study queue", () => {
    recordConcept("computational_finance", "Kelly criterion", "Optimal bet sizing.");
    const queue = nextCurriculum();
    expect(queue).toHaveLength(1);
    expect(queue[0].reason).toBe("never_studied");
  });

  it("schedules prerequisites before what depends on them", () => {
    const basics = recordConcept("computational_finance", "Variance", "Dispersion of returns.");
    const advanced = recordConcept("computational_finance", "Sharpe ratio", "Return per unit of variance.");
    linkConcepts(basics, advanced, "prerequisite_of");

    const queue = nextCurriculum();
    expect(queue[0].conceptId).toBe(basics);
  });

  it("summarises mastery per plane", () => {
    const finance = recordConcept("computational_finance", "Drawdown", "Peak-to-trough decline.");
    recordConcept("quantum_physics", "Superposition", "A state as a combination of basis states.");
    recordQuizResult(finance, true);

    const summary = masteryByPlane();
    const financeSummary = summary.find((entry) => entry.plane === "computational_finance");
    expect(financeSummary?.studied).toBe(1);
    expect(financeSummary?.averageScore).toBe(1);
    expect(summary.find((entry) => entry.plane === "quantum_physics")?.studied).toBe(0);
  });
});

/**
 * Cycles here must not reach the network.
 *
 * At `learning` and above the cycle regenerates the quant-core artifacts, which needs bars — and
 * with the real provider that is a dozen HTTP requests per call. Under parallel load those
 * timeouts turned a queue-draining assertion into a five-second failure that said nothing about
 * queue draining. Injected empty, so every consumer takes its documented no-data path.
 */
const offline = async () => ({ dataset: {}, reference: [], references: {} });
/**
 * Intake is stubbed for the same reason `offline` exists: the real producer fetches from arXiv,
 * and a cycle test that silently pulls five live papers is measuring the network rather than the
 * cycle. It reported six processed jobs against the one the test enqueued.
 */
const noIntake = async () => ({
  enqueued: 0,
  deduped: 0,
  rejected: 0,
  failed: false,
  reason: "Research intake stubbed for this test.",
});

const cycle = (workerId?: string) => runLearningCycle(workerId, undefined, offline, noIntake);

// A cycle opens a database, runs migrations, seeds the quiz bank and writes five artifacts. Under
// the full suite's parallelism that has exceeded the 5s default on this machine, and a timeout
// asserts nothing about the code. `vitest.config.ts` is owner-reviewed, so it is set here.
vi.setConfig({ testTimeout: 30_000 });

describe("learning cycle", () => {
  it("does nothing while learning mode is off", async () => {
    setLearningMode("off", "owner");
    const report = await cycle();
    expect(report.mode).toBe("off");
    expect(report.worker).toBeNull();
    expect(report.skipped.join(" ")).toMatch(/off/);
  });

  it("runs the full cycle in default (evolving) mode", async () => {
    // System is always RUN — evolving mode drains queue and runs all lanes.
    expect(getLearningMode()).toBe("evolving");
    enqueue({
      kind: "ingest_paper",
      payload: { kind: "paper", title: "Momentum study", content: "Momentum persists." },
    });

    const report = await cycle();
    // In evolving mode, the worker processes the queued job.
    expect(report.worker).not.toBeNull();
    expect(report.mode).toBe("evolving");
  });

  it("reports off mode correctly without running the cycle", async () => {
    setLearningMode("off", "owner");
    expect(getLearningMode()).toBe("off");
    const report = await cycle();
    // In off mode, the cycle returns early after checking quant core status.
    expect(report.mode).toBe("off");
    expect(report.worker).toBeNull();
    // Quant core is always checked (before mode gate), but no work is done.
    expect(report.quantCore).not.toBeNull();
    expect(report.skipped.join(" ")).toMatch(/off/i);
  });

  it("refuses a second concurrent cycle instead of racing the first", async () => {
    setLearningMode("learning", "owner");
    const [first, second] = await Promise.all([
      cycle("scheduler"),
      cycle("daemon"),
    ]);

    const blocked = [first, second].filter((report) => report.blockedBy);
    const ran = [first, second].filter((report) => !report.blockedBy);
    expect(ran).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.skipped.join(" ")).toMatch(/did nothing/);
    // Nothing was measured, so nothing is claimed — not even a zero.
    expect(blocked[0]?.quantCore).toBeNull();
    expect(blocked[0]?.openFailures).toBeNull();
  });

  it("does not record a refused cycle in the run log", async () => {
    setLearningMode("learning", "owner");
    const before = recentCycleRuns(50).length;
    await Promise.all([cycle("scheduler"), cycle("daemon")]);
    // Two calls, one cycle. A no-op logged as a cycle would inflate "cycles today" with work
    // that never happened — the exact dishonesty the run log exists to end.
    expect(recentCycleRuns(50).length).toBe(before + 1);
  });

  it("enables proposal work only in evolving mode", async () => {
    setLearningMode("evolving", "owner");
    const report = await cycle();
    expect(report.actions.join(" ")).toMatch(/only the owner can approve or merge/i);
  });
});
