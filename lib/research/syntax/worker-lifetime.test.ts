import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The worker must outlive the request.
 *
 * `authorFromHypotheses` took its resolver from a DEFAULT PARAMETER
 * (`= SpaCyDependencyResolver.fromEnv()`), and a default parameter expression is evaluated on every
 * call that omits the argument. So every `POST /api/research/hypotheses` built a new resolver,
 * spawned a new interpreter and reloaded `en_core_web_sm` — then killed it again in a `finally`.
 * MEASURED 2026-08-11: 17-22 seconds per call, no warm-up across three consecutive calls, including
 * calls that authored nothing. From the owner's chair the interpret control was simply dead.
 *
 * Every unit test passed throughout, because every unit test INJECTS a fixture resolver and
 * therefore never evaluates the default. The defect lived exactly in the gap the test seam created.
 *
 * These tests count spawns instead of trusting a comment. The interpreter is never really launched:
 * `node:child_process` is mocked, so a fake worker answers the readiness banner and every parse.
 */

const spawned: FakeWorker[] = [];

class FakeWorker extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid: number;
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;

    // The readiness banner the real worker prints once its model is loaded.
    queueMicrotask(() => {
      this.stdout.write(
        `${JSON.stringify({
          ready: true,
          parser: "spacy",
          parserVersion: "3.8.15",
          model: "en_core_web_sm",
          modelVersion: "3.8.0",
          python: "fake",
        })}\n`,
      );
    });

    // Answer each correlated request with an empty-but-valid parse. The verdict does not matter
    // here; only how many interpreters were started to produce it.
    this.stdin.on("data", (chunk: Buffer) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { requestId?: string; op?: string };
        if (message.op === "shutdown" || message.requestId === undefined) continue;
        this.stdout.write(
          `${JSON.stringify({ requestId: message.requestId, ok: true, sentences: [], tokens: [] })}\n`,
        );
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const worker = new FakeWorker(9000 + spawned.length);
    spawned.push(worker);
    return worker;
  }),
}));

const { sharedSyntaxResolver, disposeSharedSyntaxResolver, SpaCyDependencyResolver } = await import(
  "./resolver"
);
const { authorFromHypotheses } = await import("../hypothesis-author");
const { recordHypothesis } = await import("@/lib/knowledge/repository");
const { useTemporaryDatabase } = await import("@/lib/db/testing");

useTemporaryDatabase();

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  SYNTAX_PARSER_PYTHON: "C:/fake/python.exe",
  SYNTAX_PARSER_MODEL: "en_core_web_sm",
};

beforeEach(async () => {
  await disposeSharedSyntaxResolver();
  spawned.length = 0;
});

afterEach(async () => {
  await disposeSharedSyntaxResolver();
  vi.unstubAllEnvs();
});

describe("the syntax worker's lifetime", () => {
  it("starts one interpreter no matter how many callers ask for the parser", async () => {
    const first = sharedSyntaxResolver(ENV);
    const second = sharedSyntaxResolver(ENV);

    expect(second).toBe(first);

    await first.parse("close is above sma_20");
    await second.parse("rsi_14 is above 55");

    // THE ASSERTION. Two parses through two lookups, one model load.
    expect(spawned).toHaveLength(1);
  });

  it("reports the same pid to every caller, so 'warm' is observable rather than assumed", async () => {
    const before = await sharedSyntaxResolver(ENV).health();
    const after = await sharedSyntaxResolver(ENV).health();

    expect(before.pid).toBe(spawned[0].pid);
    expect(after.pid).toBe(before.pid);
  });

  it("does not let a borrower shut down the shared worker", async () => {
    // `authorFromHypotheses` disposed its resolver in a `finally`. Correct for one it created;
    // fatal for one it borrows — the next request would pay the model load all over again.
    const resolver = sharedSyntaxResolver(ENV);
    await resolver.parse("close is above sma_20");
    expect(spawned[0].killed).toBe(false);
  });

  it("replaces the worker when the configured model changes", async () => {
    await sharedSyntaxResolver(ENV).health();
    await sharedSyntaxResolver({ ...ENV, SYNTAX_PARSER_MODEL: "en_core_web_trf" }).health();

    // Serving the old worker here would answer with a model nobody asked for.
    expect(spawned).toHaveLength(2);
  });

  it("still refuses to guess the interpreter", async () => {
    // Ambient `python` on this machine is a virtualenv with no spaCy. Discovery would pick it.
    expect(() => sharedSyntaxResolver({ ...process.env, SYNTAX_PARSER_PYTHON: "" })).toThrow(
      /SYNTAX_PARSER_PYTHON/,
    );
    expect(spawned).toHaveLength(0);
  });

  it("survives two authoring requests on one model load", async () => {
    // THE REGRESSION TEST. It exercises the real production path — `authorFromHypotheses` with no
    // resolver argument, exactly as `app/api/research/hypotheses/route.ts` and `lib/learning/cycle.ts`
    // call it. Restore the default parameter and this fails with 2 spawns, which is what the owner
    // was paying 17-22 seconds for on every click.
    //
    // Stubbed because this path reads the real `process.env` — the interpreter is configuration,
    // and the test must supply it exactly as a deployment would.
    vi.stubEnv("SYNTAX_PARSER_PYTHON", "C:/fake/python.exe");
    vi.stubEnv("SYNTAX_PARSER_MODEL", "en_core_web_sm");

    recordHypothesis({
      title: "IN:XNSE:TCS — LONG SWING",
      statement: "Enter when rsi_14 is above 55 on the daily close, exiting on a close below sma_20.",
      market: "NSE",
      createdBy: "test",
    });
    await authorFromHypotheses("test");

    recordHypothesis({
      title: "IN:XNSE:SBIN — LONG SWING",
      statement: "Enter when rsi_14 is above 60 on the daily close, exiting after five sessions.",
      market: "NSE",
      createdBy: "test",
    });
    await authorFromHypotheses("test");

    expect(spawned).toHaveLength(1);
    expect(spawned[0].killed).toBe(false);
  });

  it("documents what the per-call construction actually did", async () => {
    // Not a hypothetical: this is the exact expression that sat in the default parameter.
    await SpaCyDependencyResolver.fromEnv(ENV).health();
    await SpaCyDependencyResolver.fromEnv(ENV).health();

    // Two interpreters, two model loads — 17-22 seconds each in production.
    expect(spawned).toHaveLength(2);
  });
});
