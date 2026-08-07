import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { listAudit } from "@/lib/knowledge/repository";
import { GovernanceDenied, authorize, getLearningMode, requireAuthorization, setLearningMode } from "./runtime";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-governance-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "governance.db");
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

describe("learning mode", () => {
  it("defaults to off", () => {
    expect(getLearningMode()).toBe("off");
  });

  it("round-trips a mode change and audits it", () => {
    setLearningMode("learning", "owner");
    expect(getLearningMode()).toBe("learning");

    const events = listAudit();
    expect(events[0].action).toBe("set_learning_mode");
    expect(events[0].subject).toBe("learning");
  });

  it("rejects an unknown mode", () => {
    expect(() => setLearningMode("turbo" as never, "owner")).toThrow(/Unknown learning mode/);
  });

  it("rejects non-owner mode changes without changing state", () => {
    expect(() => setLearningMode("evolving", "autonomous_worker")).toThrow(GovernanceDenied);
    expect(getLearningMode()).toBe("off");
  });
});

describe("authorize", () => {
  it("denies everything while learning mode is off", () => {
    const decision = authorize("discover_source", "autonomous_worker");
    expect(decision.allowed).toBe(false);
  });

  it("allows a permitted action once the mode is high enough", () => {
    setLearningMode("learning", "owner");
    expect(authorize("extract_claim", "autonomous_worker").allowed).toBe(true);
  });

  it("denies a prohibited action even in the highest mode", () => {
    setLearningMode("evolving", "owner");
    const decision = authorize("place_order", "autonomous_worker", "RELIANCE.NS");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("ACTION_PROHIBITED");
  });

  it("writes an audit row for a denial, including the subject", () => {
    setLearningMode("evolving", "owner");
    authorize("modify_risk_kernel", "autonomous_worker", "lib/paper/risk.ts");

    const denial = listAudit().find((event) => event.action === "modify_risk_kernel");
    expect(denial?.decision).toBe("denied");
    expect(denial?.denialCode).toBe("ACTION_PROHIBITED");
    expect(denial?.subject).toBe("lib/paper/risk.ts");
    expect(denial?.learningMode).toBe("evolving");
  });

  it("audits allowed actions too, so the trail is complete", () => {
    setLearningMode("evolving", "owner");
    authorize("run_monte_carlo", "autonomous_worker");
    authorize("place_order", "autonomous_worker");

    const actions = listAudit().map((event) => event.action);
    expect(actions).toContain("run_monte_carlo");
    expect(actions).toContain("place_order");
  });
});

describe("requireAuthorization", () => {
  it("throws GovernanceDenied on a prohibited action", () => {
    setLearningMode("evolving", "owner");
    expect(() => requireAuthorization("add_broker_mutation_tool", "autonomous_worker")).toThrow(GovernanceDenied);
  });

  it("returns silently when allowed", () => {
    setLearningMode("learning", "owner");
    expect(() => requireAuthorization("write_test", "autonomous_worker")).not.toThrow();
  });
});
