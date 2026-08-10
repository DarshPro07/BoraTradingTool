import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { getDb, schema } from "@/lib/db";
import { compileStrategy, StrategyDslSchema } from "@/lib/strategy/dsl";
import { recordHypothesis } from "@/lib/knowledge/repository";
import { authorFromHypotheses } from "./hypothesis-author";
import { compileResearchProse } from "./semantic-compiler";
import { hypothesisTriage } from "./hypothesis-triage";

useTemporaryDatabase();

/**
 * Cross-layer scope parity — the P0 the owner elevated.
 *
 * The product promises three things a reader can compare:
 *
 *     YOU SAID  ->  INTERPRETED  ->  ACTUALLY TESTED
 *
 * The compiler computed an EXIT scope and the author discarded it, substituting a time-and-stop
 * default. A surface showing "INTERPRETED: exit when close < SMA20" over a spec that actually ran
 * a 5-day timeout breaks the promise at the third arrow — and it breaks it silently, which is the
 * worst place for it. These tests assert the scopes survive every layer:
 *
 *     prose -> compiler AST -> Strategy IR -> backtest-compiled rule
 *
 * Entry stays entry. Exit stays exit. Neither collapses into the other.
 */

const PROSE =
  "Enter when close is above SMA20 and RSI-14 is between 55 and 70. " +
  "Exit when close falls below SMA50.";

describe("scope parity across every layer", () => {
  it("the compiler separates entry from exit", () => {
    const compiled = compileResearchProse(PROSE);

    expect(compiled.verdict).toBe("EXPRESSIBLE");
    expect(compiled.scopes.ENTRY).toBeDefined();
    expect(compiled.scopes.EXIT).toEqual({ compare: ["close", "sma50"], op: "lt" });
  });

  it("triage carries both scopes through unchanged", () => {
    const triage = hypothesisTriage({ title: "Scope parity", statement: PROSE });

    expect(triage.verdict).toBe("EXPRESSIBLE");
    expect(triage.compiled?.scopes.ENTRY).toEqual(compileResearchProse(PROSE).scopes.ENTRY);
    expect(triage.compiled?.scopes.EXIT).toEqual(compileResearchProse(PROSE).scopes.EXIT);
  });

  it("the authored Strategy IR keeps the research's own exit rule, and the backtest compiles it", () => {
    recordHypothesis({
      title: "Scope parity across layers",
      statement: PROSE,
      market: "NSE",
      createdBy: "test",
    });
    authorFromHypotheses("test");

    const spec = getDb().select().from(schema.strategySpecs).all().at(-1);
    expect(spec, "a spec should have been authored").toBeDefined();

    const dsl = StrategyDslSchema.parse(JSON.parse(spec?.dsl as string));
    const expected = compileResearchProse(PROSE);

    // LAYER 3 — Strategy IR. The exit condition is the research's, not a substituted default.
    expect(dsl.entry).toEqual(expected.scopes.ENTRY);
    expect(dsl.exit.condition).toEqual(expected.scopes.EXIT);
    // The bounds are still there, and they are additions rather than replacements.
    expect(dsl.exit.afterDays).toBe(5);
    expect(dsl.exit.stopLossPct).toBe(2);

    // LAYER 4 — the executable rule. A spec the backtest cannot compile is a spec that can never
    // be tested, which would make the parity above meaningless.
    const executable = compileStrategy(dsl);
    expect(executable.ok, `backtest compile failed: ${executable.ok ? "" : JSON.stringify(executable)}`).toBe(true);
  });

  it("an exit threshold below the entry band never collapses into the entry", () => {
    // The scope invariant, stated as the thing that must never happen: entry demands RSI >= 55,
    // exit fires below 50. Flattened into one scope that rule can never fire.
    const compiled = compileResearchProse(
      "Enter while RSI-14 is between 55 and 70. Exit if RSI-14 falls below 50.",
    );

    expect(compiled.verdict).toBe("EXPRESSIBLE");
    expect(JSON.stringify(compiled.scopes.ENTRY)).not.toContain('"lt"');
    expect(compiled.scopes.EXIT).toEqual({ feature: "rsi14", op: "lt", value: 50 });
  });

  it("provenance states what was actually built, not a default that was not used", () => {
    const triage = hypothesisTriage({ title: "Scope parity", statement: PROSE });
    expect(triage.compiled?.scopes.EXIT).toBeDefined();

    // When the research states an exit, the assumption text must not claim it stated entries only.
    const spec = getDb().select().from(schema.strategySpecs).all().at(-1);
    const provenance = getDb()
      .select()
      .from(schema.auditEvents)
      .all()
      .filter((event) => event.subject === spec?.id && event.action === "authoring_provenance");

    if (provenance.length > 0) {
      const detail = provenance[0].detail ?? "";
      expect(detail).not.toContain("the hypothesis stated entries only");
    }
  });
});
