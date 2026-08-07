import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { INSTRUMENT_CATALOG } from "@/lib/market/catalog";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { classifyRegime } from "./regime";
import { scanForSignals, type ScannableSpec, type SignalScan } from "./signals";

/**
 * Produces the quant-core artifacts locally, from data this repository already holds.
 *
 * ## Why files rather than a new transport
 *
 * `lib/quantcore/contract.ts` is frozen and hook-protected: `QuantTransport` is `"http" |
 * "filesystem"` and a third member cannot be added. Rather than mislabel an in-process call as
 * one of those, this writes real artifacts to a real directory that the existing filesystem
 * transport already knows how to read. `transport: "filesystem"` stays literally true, `source`
 * is a genuine path, and `generatedAt` is a genuine timestamp.
 *
 * It also means a hand-supplied file and a generated one are indistinguishable to the reader,
 * which is the point: drop a real board packet into the same directory and it is picked up with
 * no code change. Generation is a *default*, not a monopoly.
 *
 * ## What this costs, stated plainly
 *
 * The Python quant core was a second, independently written implementation. Two engines built
 * separately agreeing on a result is evidence that neither's bugs produced it. A repository
 * supplying its own quant-core resources cannot provide that — it is one engine agreeing with
 * itself, and any "corroboration" read from these files is circular.
 *
 * The independent check that survives is `lib/backtest/parity.test.ts`, which runs the engine
 * against a hand-computed fixture and a separately written reference implementation. That is
 * real corroboration and it is unaffected by any of this.
 *
 * Nothing here fabricates. Where this repository cannot answer, no file is written, and the
 * contract reports `RESOURCE_NOT_PROVIDED` — which is true.
 */

/** Where generated artifacts live. Layout mirrors the contract's filesystem mapping exactly. */
export const LOCAL_QUANT_CORE_ROOT = path.join(process.cwd(), "data", "quantcore");

export interface GenerationReport {
  root: string;
  /** Artifacts written this pass, as paths relative to the root. */
  written: string[];
  /** Resources deliberately not written, with the reason. These become RESOURCE_NOT_PROVIDED. */
  skipped: { resource: string; reason: string }[];
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonLines(root: string, relativePath: string, rows: readonly unknown[]): void {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The tradable universe.
 *
 * `liquid` reports catalog membership, which is a curated list of large-capitalisation names and
 * major ETFs — not a measured average daily volume. That is a weaker claim than the contract's
 * field name suggests, so it is stated here rather than left for someone to discover. `sector` is
 * null because this repository genuinely does not store sectors; inventing them from the ticker
 * would be the exact failure mode the evidence rules forbid.
 */
function universeArtifact(market: "US" | "IN") {
  const instruments = INSTRUMENT_CATALOG.filter((instrument) => instrument.market === market);
  return {
    market: market === "IN" ? "NSE" : "US",
    count: instruments.length,
    instruments: instruments.map((instrument) => ({
      symbol: instrument.providerSymbol,
      sector: null,
      liquid: true,
    })),
  };
}

/** Every gauntlet attempt, including the failures — which is what multiple-testing correction needs. */
function trialRows(): { rows: unknown[]; count: number } {
  const db = getDb();
  const trials = db.select().from(schema.trials).orderBy(desc(schema.trials.id)).all();
  const specNames = new Map(
    db
      .select({ id: schema.strategySpecs.id, name: schema.strategySpecs.name })
      .from(schema.strategySpecs)
      .all()
      .map((row) => [row.id, row.name]),
  );

  const rows = trials.map((trial) => ({
    id: trial.id,
    strategy: specNames.get(trial.strategySpecId) ?? trial.strategySpecId,
    verdict: trial.verdict,
    reason: trial.reason,
    // `completedAt` is null while a trial is still running; the start is the honest stamp then.
    recordedAt: (trial.completedAt ?? trial.startedAt).toISOString(),
  }));
  return { rows, count: rows.length };
}

interface ForwardCounts {
  wins: number;
  losses: number;
  expired: number;
  resolved: number;
  pending: number;
}

function forwardRows(): { rows: unknown[]; counts: ForwardCounts } {
  const rows = getDb().select().from(schema.forwardOutcomes).orderBy(schema.forwardOutcomes.openedAt).all();
  const counts: ForwardCounts = { wins: 0, losses: 0, expired: 0, resolved: 0, pending: 0 };

  const mapped = rows.map((row) => {
    if (row.outcome === "win") counts.wins += 1;
    else if (row.outcome === "loss") counts.losses += 1;
    else if (row.outcome === "expired") counts.expired += 1;

    if (row.outcome === "open") counts.pending += 1;
    else counts.resolved += 1;

    return {
      id: row.id,
      symbol: row.instrumentId,
      strategy: row.strategySpecId,
      // The reader expects a date string, and re-parses it. Dates, not timestamps, because a
      // forward observation is dated by the session it opened in.
      date: isoDate(row.openedAt),
      resolved_at: row.resolvedAt ? isoDate(row.resolvedAt) : null,
      actual_outcome: row.outcome.toUpperCase(),
      r_multiple: row.rMultiple,
    };
  });

  return { rows: mapped, counts };
}

/**
 * The board packet, in the snake_case shape `lib/quantcore/filesystem.ts` parses.
 *
 * `outcome_audit` carries **this repository's** numbers, not the Python core's. Its historical
 * counts come from the trial ledger — gauntlet verdicts — and `live_resolved` from forward
 * outcomes. Those are real measurements of real work, but they are a different population from
 * the 4,917 observations the old packet reported, and they will be far smaller. `primary_limit`
 * says so on the artifact itself, because a number that looks like a familiar one but counts
 * something else is worse than no number at all.
 */
function boardArtifact(
  trials: { rows: unknown[]; count: number },
  forward: ForwardCounts,
  generatedAt: Date,
  scan: SignalScan | null,
) {
  const db = getDb();
  const specs = db.select().from(schema.strategySpecs).all();

  const verdicts = (trials.rows as { verdict: string }[]).reduce(
    (totals, trial) => {
      const verdict = trial.verdict.toUpperCase();
      if (verdict === "PASS") totals.pass += 1;
      else if (verdict === "FAIL") totals.fail += 1;
      else totals.other += 1;
      return totals;
    },
    { pass: 0, fail: 0, other: 0 },
  );

  return {
    generated_at: generatedAt.toISOString(),
    mode: "PAPER_ONLY",
    safety: {
      // Structural, not configured: `/api/trade/place` returns EXECUTION_ADAPTER_MISSING and there
      // is no broker adapter in the repository at all.
      live_execution: false,
      broker_enabled: false,
      model_gate: "CLOSED",
    },
    data_status: {
      daily: specs.length > 0 ? "PASS" : "NO_STRATEGIES",
      daily_range: null,
      intraday_15m: null,
      data_confidence: null,
      primary_limit:
        "SELF_GENERATED: produced by this repository from its own trial ledger and forward " +
        "outcomes. Not an independent second implementation, so agreement with local backtests " +
        "is circular and must not be read as corroboration.",
    },
    // Empty when no bars were supplied. An invented candidate list would be the one thing worse
    // than none, and "the scan did not run" must not render as "nothing fired".
    candidates: scan?.candidates ?? [],
    gates: Object.fromEntries(
      specs.map((spec) => [spec.name, spec.status.toUpperCase()]),
    ),
    strategies: Object.fromEntries(
      specs.map((spec) => [spec.name, `v${spec.version} ${spec.status}`]),
    ),
    outcome_audit: {
      historical_wins: verdicts.pass,
      historical_losses: verdicts.fail,
      historical_expired: verdicts.other,
      live_resolved: forward.resolved,
      label_mapping_ok: true,
      // There is no machine-learning model in this system, so a gate over one cannot pass or fail.
      ml_gate: "NOT_APPLICABLE",
    },
    scenarios: {
      active: forward.pending,
      resolved: forward.resolved,
      pending: forward.pending,
    },
  };
}

export interface GenerateOptions {
  root?: string;
  now?: Date;
  /** Daily bars of a reference instrument for the regime read. Omit and regime is not written. */
  referenceCandles?: readonly Candle[];
  /**
   * Bars per instrument id, for the live signal scan behind `board.candidates`. Omit and the
   * board carries no candidates — which is the honest result of a scan that never ran.
   */
  dataset?: Readonly<Record<string, readonly Candle[]>>;
  market?: "US" | "IN";
}

/** Instrument ids are internal (`US:XNAS:AAPL`); the board speaks provider symbols (`AAPL`). */
function providerSymbol(instrumentId: string): string {
  return INSTRUMENT_CATALOG.find((instrument) => instrument.id === instrumentId)?.providerSymbol ?? instrumentId;
}

/** A spec stored under an older compiler is a fact to report, not a crash. */
function parseDsl(raw: string): StrategyDsl | null {
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Strategies worth scanning: everything except the ones already buried. */
function scannableSpecs(): ScannableSpec[] {
  return getDb()
    .select()
    .from(schema.strategySpecs)
    .all()
    .flatMap((spec) => {
      const parsed = parseDsl(spec.dsl);
      // A spec whose stored DSL no longer parses against the current compiler cannot be scanned.
      // Skipped rather than guessed at — a strategy is its DSL, and a repaired approximation is a
      // different strategy wearing the same name.
      if (!parsed) return [];
      return [{ id: spec.id, name: spec.name, status: spec.status, dsl: parsed }];
    });
}

export function generateQuantCoreArtifacts(options: GenerateOptions = {}): GenerationReport {
  const root = options.root ?? LOCAL_QUANT_CORE_ROOT;
  const now = options.now ?? new Date();
  const written: string[] = [];
  const skipped: { resource: string; reason: string }[] = [];

  const universePath = "data/universe.json";
  writeJson(root, universePath, universeArtifact(options.market ?? "US"));
  written.push(universePath);

  const trials = trialRows();
  const trialsPath = "data/trial_ledger.jsonl";
  writeJsonLines(root, trialsPath, trials.rows);
  written.push(trialsPath);

  const forward = forwardRows();
  const forwardPath = "data/forward_journal.jsonl";
  writeJsonLines(root, forwardPath, forward.rows);
  written.push(forwardPath);

  const specs = scannableSpecs();
  const scan = options.dataset ? scanForSignals(specs, options.dataset, providerSymbol) : null;
  if (scan) {
    for (const refusal of scan.refusals) {
      skipped.push({ resource: "board.candidates", reason: refusal });
    }
  } else {
    skipped.push({
      resource: "board.candidates",
      reason: "No bars were supplied to this pass, so no strategy was evaluated against live prices.",
    });
  }

  const boardPath = `reports/board_history/${isoDate(now)}_board_packet.json`;
  writeJson(root, boardPath, boardArtifact(trials, forward.counts, now, scan));
  written.push(boardPath);

  const reading = options.referenceCandles ? classifyRegime(options.referenceCandles) : null;
  if (reading) {
    const regimePath = "data/regime_state.json";
    writeJson(root, regimePath, {
      state: reading.state,
      asOf: reading.asOf,
      confidence: reading.confidence,
      // Not "walk_forward". Nothing here has been walk-forward validated, and borrowing the
      // contract example's string to look established would be a fabrication.
      calibration: `realised_vol_percentile_${reading.barsUsed}b`,
    });
    written.push(regimePath);
  } else {
    skipped.push({
      resource: "regime",
      // `.length`, not truthiness. An empty array is truthy, so this reported "not enough history
      // to rank" — a statement about the *distribution* — when the actual failure was that zero
      // bars ever arrived. Two different faults with two different fixes, printed identically.
      reason: options.referenceCandles?.length
        ? `Only ${options.referenceCandles.length} reference bar(s); not enough to rank this window against. No regime was written rather than defaulting to NORMAL.`
        : "No reference bars reached this pass, so volatility was never measured.",
    });
  }

  return { root, written, skipped };
}
