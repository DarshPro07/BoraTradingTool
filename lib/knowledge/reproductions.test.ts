import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { recordSource } from "./repository";
import { KnowledgeError } from "./types";
import {
  listReproductions,
  markReproductionError,
  recordObservation,
  registerReproduction,
  reproductionSummary,
} from "./reproductions";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-repro-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "repro.db");
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

function seedSource() {
  return recordSource({ kind: "paper", title: "A study", content: "Reported Sharpe of 1.20." }).id;
}

describe("reproductions", () => {
  it("refuses to register against an unknown source", () => {
    expect(() =>
      registerReproduction({ sourceId: "src_missing", language: "typescript", expected: {} }),
    ).toThrow(KnowledgeError);
  });

  it("starts pending until an observation is recorded", () => {
    const id = registerReproduction({
      sourceId: seedSource(),
      language: "typescript",
      expected: { sharpe: 1.2 },
    });
    expect(listReproductions()[0].status).toBe("pending");
    expect(id).toMatch(/^rep_/);
  });

  it("matches when the observation lands within tolerance", () => {
    const id = registerReproduction({
      sourceId: seedSource(),
      language: "typescript",
      expected: { sharpe: 1.2 },
      tolerance: 0.05,
    });
    const outcome = recordObservation(id, { sharpe: 1.23 });
    expect(outcome.status).toBe("match");
    expect(outcome.mismatches).toEqual([]);
  });

  it("reports a mismatch rather than quietly accepting a different number", () => {
    const id = registerReproduction({
      sourceId: seedSource(),
      language: "typescript",
      expected: { sharpe: 1.2 },
      tolerance: 0.01,
    });
    const outcome = recordObservation(id, { sharpe: 0.4 });
    expect(outcome.status).toBe("mismatch");
    expect(outcome.mismatches[0]).toMatch(/reported 1.2 but observed 0.4/);
  });

  it("flags a value the source reported but the reproduction never produced", () => {
    const id = registerReproduction({
      sourceId: seedSource(),
      language: "typescript",
      expected: { sharpe: 1.2, maxDrawdown: -0.15 },
    });
    const outcome = recordObservation(id, { sharpe: 1.2 });
    expect(outcome.status).toBe("mismatch");
    expect(outcome.mismatches.join(" ")).toMatch(/maxDrawdown.*nothing was observed/);
  });

  it("compares non-numeric values exactly", () => {
    const id = registerReproduction({
      sourceId: seedSource(),
      language: "prose",
      expected: { conclusion: "drift persists" },
    });
    expect(recordObservation(id, { conclusion: "drift persists" }).status).toBe("match");
  });

  it("treats a zero expectation against tolerance rather than as a ratio", () => {
    const id = registerReproduction({
      sourceId: seedSource(),
      language: "typescript",
      expected: { bias: 0 },
      tolerance: 0.01,
    });
    expect(recordObservation(id, { bias: 0.005 }).status).toBe("match");
    const second = registerReproduction({
      sourceId: seedSource(),
      language: "typescript",
      codePath: "other.ts",
      expected: { bias: 0 },
      tolerance: 0.01,
    });
    expect(recordObservation(second, { bias: 0.9 }).status).toBe("mismatch");
  });

  it("records an error when the reproduction could not run at all", () => {
    const id = registerReproduction({ sourceId: seedSource(), language: "python", expected: { x: 1 } });
    markReproductionError(id, "Source code is not published.");
    expect(listReproductions()[0].status).toBe("error");
    expect(listReproductions()[0].notes).toMatch(/not published/);
  });

  it("counts a source as verified only once a reproduction matches", () => {
    const sourceId = seedSource();
    const id = registerReproduction({ sourceId, language: "typescript", expected: { sharpe: 1.2 } });

    expect(reproductionSummary().verifiedSources).toBe(0);
    recordObservation(id, { sharpe: 0.2 });
    expect(reproductionSummary()).toMatchObject({ mismatch: 1, verifiedSources: 0 });

    const second = registerReproduction({
      sourceId,
      language: "typescript",
      codePath: "second.ts",
      expected: { sharpe: 1.2 },
      tolerance: 0.1,
    });
    recordObservation(second, { sharpe: 1.25 });
    expect(reproductionSummary()).toMatchObject({ match: 1, verifiedSources: 1 });
  });

  it("throws on an unknown reproduction id", () => {
    expect(() => recordObservation("rep_missing", {})).toThrow(KnowledgeError);
  });
});
