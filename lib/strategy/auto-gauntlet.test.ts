import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { evaluateAutonomousAction } from "@/lib/governance/policy";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema, type StrategyDsl } from "./dsl";
import {
  runAutonomousGauntlet,
  selectTrialCandidates,
  trialsSpentToday,
  type TrialCandidate,
} from "./auto-gauntlet";
import type { ResearchDatasetSource } from "@/lib/learning/rehearsal";

/**
 * The five guards, and the governance boundary they sit behind.
 *
 * A trial is permanent: it raises the statistical bar for every future candidate in the family, and
 * `delete_trial_record` is one of the eleven actions prohibited in every mode. So the interesting
 * assertions here are all about *refusing* — the code path that spends nothing is the one that runs
 * in production today, and it is the one a regression would silently break.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-autogauntlet-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "auto.db");
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

/** An intraday spec priced at the owner's real cost — the shape that clears every guard. */
function eligibleDsl(name = "orb_probe"): StrategyDsl {
  return StrategyDslSchema.parse({
    name,
    universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
    entry: { feature: "close", op: "gt", value: 0 },
    exit: { stopLossPct: 0.5, takeProfitPct: 1 },
    sizing: { maxPositionPct: 25 },
    costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
  });
}

/** A daily spec: needs delivery, which the owner's capital cannot fund. */
function dailyDsl(name = "daily_probe"): StrategyDsl {
  return StrategyDslSchema.parse({
    name,
    universe: { market: "NSE", maxPositions: 4, resolution: "D" },
    entry: { feature: "close", op: "gt", value: 0 },
    exit: { afterDays: 5, stopLossPct: 2 },
    sizing: { maxPositionPct: 25 },
    costs: { commissionBps: 5, slippageBps: 7 },
  });
}

function seed(dsl: StrategyDsl, verdict: string | null): string {
  const id = recordStrategySpec({ name: dsl.name, dsl, createdBy: "test" });
  if (verdict !== null) {
    getDb()
      .insert(schema.rehearsalOutcomes)
      .values({
        strategySpecId: id,
        verdict,
        reason: "seeded",
        trades: 40,
        instrumentsEvaluated: 6,
        rehearsedAt: new Date(),
      })
      .run();
  }
  return id;
}

const guard = (candidate: TrialCandidate, name: string) =>
  candidate.guards.find((entry) => entry.name === name);

const noData: ResearchDatasetSource = () => ({
  ok: false,
  code: "NO_STORED_DATA",
  message: "The canonical store holds no bars for this universe (test). Ingestion required.",
});

describe("the five guards", () => {
  it("passes every guard for a rehearsed, honestly priced, intraday candidate", () => {
    seed(eligibleDsl(), "would_pass");
    const [candidate] = selectTrialCandidates();

    expect(candidate.eligible).toBe(true);
    for (const entry of candidate.guards) expect(entry.passed).toBe(true);
  });

  it("refuses a candidate the rehearsal says would fail", () => {
    seed(eligibleDsl(), "would_fail");
    const [candidate] = selectTrialCandidates();

    expect(candidate.eligible).toBe(false);
    expect(guard(candidate, "rehearsal_would_pass")?.passed).toBe(false);
  });

  it("refuses a candidate that has never been rehearsed", () => {
    seed(eligibleDsl(), null);
    const [candidate] = selectTrialCandidates();

    expect(candidate.eligible).toBe(false);
    expect(guard(candidate, "rehearsal_would_pass")?.detail).toMatch(/Never rehearsed/);
  });

  it("refuses a daily strategy, because the owner's capital cannot fund delivery", () => {
    // ₹1,000 trades intraday only — delivery needs ₹23,000. Validating a strategy the account
    // cannot execute spends a permanent resource on a hypothetical one.
    seed(dailyDsl(), "would_pass");
    const [candidate] = selectTrialCandidates();

    expect(candidate.eligible).toBe(false);
    expect(guard(candidate, "tradable_at_capital")?.passed).toBe(false);
    expect(guard(candidate, "tradable_at_capital")?.detail).toMatch(/delivery/);
  });

  it("refuses a candidate whose declared cost is below what the owner pays", () => {
    const cheap = StrategyDslSchema.parse({
      name: "cheap_probe",
      universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { stopLossPct: 0.5 },
      sizing: { maxPositionPct: 25 },
      costs: { commissionBps: 1, slippageBps: 1, assumedSpreadBps: 0 },
    });
    seed(cheap, "would_pass");
    const [candidate] = selectTrialCandidates();

    expect(candidate.eligible).toBe(false);
    expect(guard(candidate, "cost_honest")?.passed).toBe(false);
  });

  it("refuses once the daily budget is spent", () => {
    const id = seed(eligibleDsl(), "would_pass");
    getDb()
      .insert(schema.trials)
      .values({
        strategySpecId: id,
        kind: "gauntlet",
        verdict: "pass",
        actor: "autonomous_worker",
        startedAt: new Date(),
      })
      .run();

    const [candidate] = selectTrialCandidates(new Date(), 1);
    expect(guard(candidate, "budget_available")?.passed).toBe(false);
    expect(candidate.eligible).toBe(false);
  });

  it("does not count yesterday's trials against today's budget", () => {
    const id = seed(eligibleDsl(), "would_pass");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    getDb()
      .insert(schema.trials)
      .values({
        strategySpecId: id,
        kind: "gauntlet",
        verdict: "pass",
        actor: "autonomous_worker",
        startedAt: yesterday,
      })
      .run();

    expect(trialsSpentToday(new Date())).toBe(0);
    expect(selectTrialCandidates()[0].eligible).toBe(true);
  });

  it("reports every guard, passed or failed, so a skipped candidate is explicable", () => {
    seed(dailyDsl(), "would_fail");
    const [candidate] = selectTrialCandidates();

    expect(candidate.guards.map((entry) => entry.name)).toEqual([
      "rehearsal_would_pass",
      "awaiting_gauntlet",
      "cost_honest",
      "tradable_at_capital",
      "budget_available",
    ]);
    for (const entry of candidate.guards) expect(entry.detail.length).toBeGreaterThan(0);
  });
});

describe("the governance boundary", () => {
  it("spends nothing, because run_gauntlet is not in the policy allowlist", async () => {
    // Two independent refusals guard this path. The research freeze was the outer one while the
    // identity repair was in flight; it is lifted, so the governance allowlist is the live gate
    // again — and it is the permanent one. `AUTONOMOUS_PERMITTED` is denied-by-default and
    // `lib/governance/policy.ts` is protected, so this module cannot grant itself the permission.
    seed(eligibleDsl(), "would_pass");
    const report = await runAutonomousGauntlet({ mode: "evolving", researchData: noData });

    expect(report.policyAllowed).toBe(false);
    expect(report.spent).toBeNull();
    expect(report.recommended?.name).toBe("orb_probe");
    expect(report.summary).toMatch(/AUTONOMOUS_PERMITTED/);
  });

  it("asks the policy directly, so the refusal is not an artefact of this module", async () => {
    const verdict = evaluateAutonomousAction("run_gauntlet", "autonomous_worker", "evolving");
    expect(verdict.allowed).toBe(false);
  });

  it("still evaluates every guard while refused, so the recommendation is fully checked", async () => {
    seed(eligibleDsl(), "would_pass");
    seed(dailyDsl(), "would_pass");
    const report = await runAutonomousGauntlet({ mode: "evolving", researchData: noData });

    expect(report.candidates).toHaveLength(2);
    expect(report.candidates.filter((candidate) => candidate.eligible)).toHaveLength(1);
    expect(report.budget.perDay).toBe(1);
  });

  it("recommends nothing when no candidate is eligible, rather than the least-bad one", async () => {
    seed(dailyDsl(), "would_fail");
    const report = await runAutonomousGauntlet({ mode: "evolving", researchData: noData });

    expect(report.recommended).toBeNull();
    expect(report.spent).toBeNull();
    expect(report.summary).toMatch(/none eligible/);
  });

  it("reports nothing to consider on an empty registry", async () => {
    const report = await runAutonomousGauntlet({ mode: "evolving", researchData: noData });
    expect(report.candidates).toHaveLength(0);
    expect(report.summary).toMatch(/No strategy exists/);
  });
});

describe("the ordering the owner reads", () => {
  it("puts eligible candidates first, then those failing fewest guards", () => {
    seed(dailyDsl("far_off"), null); // fails rehearsal + tradability
    seed(eligibleDsl("ready"), "would_pass"); // fails nothing
    seed(eligibleDsl("nearly"), "would_fail"); // fails rehearsal only

    const order = selectTrialCandidates().map((candidate) => candidate.name);
    expect(order[0]).toBe("ready");
    expect(order[1]).toBe("nearly");
    expect(order[2]).toBe("far_off");
  });
});

describe("a data outage is not a verdict", () => {
  it("spends no trial when the store cannot serve the universe", async () => {
    // Reachable only once policy permits the spend; asserted now so the guard is already in place
    // when that day comes, rather than being discovered by a wasted trial.
    seed(eligibleDsl(), "would_pass");
    const report = await runAutonomousGauntlet({ mode: "evolving", researchData: noData });
    expect(report.spent).toBeNull();
  });
});

/** Sanity: the source type is exercised, so a signature drift fails here rather than in production. */
describe("the injected dataset source", () => {
  it("is asked for the strategy's own market and resolution — or not at all under refusal", async () => {
    const seen: { market: string; resolution: string }[] = [];
    const spying: ResearchDatasetSource = (market, resolution) => {
      seen.push({ market, resolution });
      return noData(market, resolution);
    };
    seed(eligibleDsl(), "would_pass");
    await runAutonomousGauntlet({ mode: "evolving", researchData: spying });
    // Policy refuses before the source is reached today. When it stops refusing, this records what
    // the source is asked for — and the assertion below is what will change, visibly.
    expect(seen).toHaveLength(0);
  });
});
