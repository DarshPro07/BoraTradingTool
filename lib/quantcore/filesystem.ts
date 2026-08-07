import fs from "node:fs";
import path from "node:path";
import {
  BoardSchema,
  ForwardOutcomesSchema,
  HealthSchema,
  RegimeSchema,
  TrialsSchema,
  UniverseSchema,
  failure,
  success,
  type QuantErrorCode,
  type QuantFailure,
  type QuantResource,
  type QuantResult,
  type ResourceData,
} from "./contract";

function failureAt(
  resource: QuantResource,
  code: QuantErrorCode,
  message: string,
  now: number,
  source?: string,
): QuantFailure {
  return { ...failure(resource, code, message, source), retrievedAt: new Date(now).toISOString() };
}

/**
 * Where quant-core artifacts are read from.
 *
 * Defaults to this repository's own `data/quantcore/`, not `E:/Trading_BOT`. The Python quant
 * core is not installed on this machine — the directory is absent, not empty — and the owner has
 * directed that this system stop reaching outside itself for it. `lib/quantcore/generate.ts`
 * produces the artifacts locally; a hand-supplied file dropped into the same layout is read
 * identically, because the reader cannot tell and should not care.
 *
 * `QUANT_CORE_ROOT` still overrides, so pointing this at a real quant core remains one
 * environment variable away.
 */
export function quantCoreRoot(): string {
  const configured = process.env.QUANT_CORE_ROOT?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), "data", "quantcore");
}

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJsonLines(filePath: string): unknown[] | null {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return null;
  }
}

const BOARD_FILENAME = /^(\d{4}-\d{2}-\d{2})_board_packet\.json$/;

interface BoardFile {
  absolutePath: string;
  relativePath: string;
  date: string;
}

/** Newest board packet by the date encoded in its filename. */
export function latestBoardFile(root = quantCoreRoot()): BoardFile | null {
  const directory = path.join(root, "reports", "board_history");
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return null;
  }

  const dated = entries
    .map((name) => ({ name, match: BOARD_FILENAME.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => b.match[1].localeCompare(a.match[1]));

  const newest = dated[0];
  if (!newest) return null;
  return {
    absolutePath: path.join(directory, newest.name),
    relativePath: `reports/board_history/${newest.name}`,
    date: newest.match[1],
  };
}

/**
 * The board packet's `generated_at` is a free-text field that has historically carried
 * placeholder strings such as "(stamp on write)". Fall back to the filename date rather
 * than reporting an unparseable value as the generation time.
 */
function boardGeneratedAt(packet: Record<string, unknown>, fileDate: string): string {
  const raw = typeof packet.generated_at === "string" ? packet.generated_at : "";
  return Number.isNaN(Date.parse(raw)) ? `${fileDate}T00:00:00Z` : raw;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    result[key] = typeof item === "string" ? item : JSON.stringify(item);
  }
  return result;
}

function asRequiredNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const CANDIDATE_VERDICTS = new Set(["RESEARCH_ONLY", "PAPER_CANDIDATE", "BLOCKED"]);

function mapCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    const verdict = typeof record.verdict === "string" ? record.verdict : "";
    return {
      symbol: typeof record.symbol === "string" ? record.symbol : "UNKNOWN",
      side: typeof record.side === "string" ? record.side : "UNKNOWN",
      setup: asNullableString(record.setup),
      score: asNullableNumber(record.score),
      // An unrecognised verdict is treated as BLOCKED. Never widen it to a tradable state.
      verdict: (CANDIDATE_VERDICTS.has(verdict) ? verdict : "BLOCKED") as
        | "RESEARCH_ONLY"
        | "PAPER_CANDIDATE"
        | "BLOCKED",
      blockers: Array.isArray(record.blockers) ? record.blockers.map(String) : [],
    };
  });
}

function readBoardPacket(root: string):
  | { packet: Record<string, unknown>; file: BoardFile }
  | { malformed: true; file: BoardFile }
  | null {
  const file = latestBoardFile(root);
  if (!file) return null;
  const raw = readJson(file.absolutePath);
  if (raw === null) return { malformed: true, file };
  return { packet: asRecord(raw), file };
}

function healthResource(root: string, now: number): QuantResult<ResourceData["health"]> {
  const found = readBoardPacket(root);
  if (!found) {
    // "The quant core is not installed on this machine" and "the quant core is installed but has
    // not produced a packet yet" are different facts with different remedies — one is a checkout,
    // the other is a run. Reporting both as "unreachable" sends someone debugging a service that
    // was never there, which is exactly what happened.
    const installed = fs.existsSync(root);
    return failureAt(
      "health",
      "QUANT_CORE_UNAVAILABLE",
      installed
        ? `The quant core at ${root} has produced no board packet under reports/board_history, and the HTTP transport did not respond. It is installed but has not run.`
        : `There is no quant core at ${root}. Nothing is installed there, so neither transport can succeed. Set QUANT_CORE_ROOT, or set QUANT_CORE_URL=off to stop asking.`,
      now,
    );
  }
  if ("malformed" in found) {
    return failureAt("health", "RESOURCE_MALFORMED", "The latest board packet is not valid JSON.", now, found.file.relativePath);
  }

  const { packet, file } = found;
  const safety = asRecord(packet.safety);
  const dataStatus = asRecord(packet.data_status);
  const candidate = {
    mode: typeof packet.mode === "string" ? packet.mode : "UNKNOWN",
    safety: {
      liveExecution: safety.live_execution === true,
      brokerEnabled: safety.broker_enabled === true,
      modelGate: typeof safety.model_gate === "string" ? safety.model_gate : "UNKNOWN",
    },
    dataStatus: {
      daily: asNullableString(dataStatus.daily),
      dailyRange: asNullableString(dataStatus.daily_range),
      intraday15m: asNullableString(dataStatus.intraday_15m),
      dataConfidence: asNullableNumber(dataStatus.data_confidence),
      primaryLimit: asNullableString(dataStatus.primary_limit),
    },
    lastRunAt: boardGeneratedAt(packet, file.date),
  };

  const parsed = HealthSchema.safeParse(candidate);
  if (!parsed.success) {
    return failureAt("health", "RESOURCE_MALFORMED", parsed.error.message, now, file.relativePath);
  }
  return success("health", "filesystem", file.relativePath, candidate.lastRunAt, parsed.data, now);
}

function boardResource(root: string, now: number): QuantResult<ResourceData["board"]> {
  const found = readBoardPacket(root);
  if (!found) {
    return failureAt("board", "QUANT_CORE_UNAVAILABLE", "No board packet found under reports/board_history.", now);
  }
  if ("malformed" in found) {
    return failureAt("board", "RESOURCE_MALFORMED", "The latest board packet is not valid JSON.", now, found.file.relativePath);
  }

  const { packet, file } = found;
  const audit = asRecord(packet.outcome_audit);
  const scenarios = asRecord(packet.scenarios);
  const candidate = {
    candidates: mapCandidates(packet.candidates),
    gates: asStringMap(packet.gates),
    strategies: asStringMap(packet.strategies),
    outcomeAudit: {
      historicalWins: asRequiredNumber(audit.historical_wins),
      historicalLosses: asRequiredNumber(audit.historical_losses),
      historicalExpired: asRequiredNumber(audit.historical_expired),
      liveResolved: asRequiredNumber(audit.live_resolved),
      labelMappingOk: audit.label_mapping_ok === true,
      mlGate: typeof audit.ml_gate === "string" ? audit.ml_gate : "UNKNOWN",
    },
    scenarios: {
      active: asRequiredNumber(scenarios.active),
      resolved: asRequiredNumber(scenarios.resolved),
      pending: asRequiredNumber(scenarios.pending),
    },
  };

  const parsed = BoardSchema.safeParse(candidate);
  if (!parsed.success) {
    return failureAt("board", "RESOURCE_MALFORMED", parsed.error.message, now, file.relativePath);
  }
  return success("board", "filesystem", file.relativePath, boardGeneratedAt(packet, file.date), parsed.data, now);
}

// Partial, so an unrecognised key types as undefined and the "open" fallback below is
// both reachable and type-checked. A plain Record would make that fallback dead code.
const OUTCOME_MAP: Readonly<Partial<Record<string, "win" | "loss" | "expired">>> = Object.freeze({
  WIN: "win",
  LOSS: "loss",
  EXPIRED: "expired",
  TARGET_HIT: "win",
  STOP_HIT: "loss",
});

function forwardOutcomesResource(root: string, now: number): QuantResult<ResourceData["forwardOutcomes"]> {
  const relativePath = "data/forward_journal.jsonl";
  const lines = readJsonLines(path.join(root, relativePath));
  if (!lines) {
    return failureAt(
      "forwardOutcomes",
      "RESOURCE_NOT_PROVIDED",
      "data/forward_journal.jsonl is not present in the quant core.",
      now,
      relativePath,
    );
  }

  const mapped = lines.map((line) => {
    const record = asRecord(line);
    const actual = typeof record.actual_outcome === "string" ? record.actual_outcome.toUpperCase() : "";
    return {
      id: typeof record.id === "string" ? record.id : JSON.stringify(record.id ?? ""),
      symbol: typeof record.symbol === "string" ? record.symbol : "UNKNOWN",
      strategy: asNullableString(record.strategy),
      openedAt: typeof record.date === "string" ? record.date : "",
      resolvedAt: asNullableString(record.resolved_at),
      outcome: OUTCOME_MAP[actual] ?? ("open" as const),
      // pnl_after_costs is currency, not an R multiple. Reporting it as R would be a
      // fabrication, so it stays null until the quant core emits a real r_multiple.
      rMultiple: asNullableNumber(record.r_multiple),
    };
  });

  // The journal is append-only and re-appends an observation each time its state is
  // re-evaluated, so the same id occurs many times. Counting raw lines overstates forward
  // evidence — the one number in this system that must never be inflated. Collapse to the
  // last append per id, which is that observation's most recent known state.
  const byId = new Map<string, (typeof mapped)[number]>();
  for (const observation of mapped) byId.set(observation.id, observation);
  const observations = [...byId.values()];

  const candidate = {
    resolved: observations.filter((observation) => observation.outcome !== "open").length,
    pending: observations.filter((observation) => observation.outcome === "open").length,
    observations,
  };

  const parsed = ForwardOutcomesSchema.safeParse(candidate);
  if (!parsed.success) {
    return failureAt("forwardOutcomes", "RESOURCE_MALFORMED", parsed.error.message, now, relativePath);
  }

  const newest = observations.map((observation) => observation.openedAt).filter(Boolean).sort().pop();
  const generatedAt = newest ? `${newest}T00:00:00Z` : null;
  return success("forwardOutcomes", "filesystem", relativePath, generatedAt, parsed.data, now);
}

function simpleJsonResource<R extends "universe" | "regime">(
  resource: R,
  relativePath: string,
  root: string,
  now: number,
): QuantResult<ResourceData[R]> {
  const raw = readJson(path.join(root, relativePath));
  if (!raw) {
    return failureAt(
      resource,
      "RESOURCE_NOT_PROVIDED",
      `${relativePath} is not produced by the quant core yet (bridge request open).`,
      now,
      relativePath,
    );
  }
  const schema = resource === "universe" ? UniverseSchema : RegimeSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return failureAt(resource, "RESOURCE_MALFORMED", parsed.error.message, now, relativePath);
  }
  const generatedAt =
    resource === "regime" ? ((parsed.data as { asOf?: string }).asOf ?? null) : null;
  return success(resource, "filesystem", relativePath, generatedAt, parsed.data as ResourceData[R], now);
}

function trialsResource(root: string, now: number): QuantResult<ResourceData["trials"]> {
  const relativePath = "data/trial_ledger.jsonl";
  const lines = readJsonLines(path.join(root, relativePath));
  if (!lines) {
    return failureAt(
      "trials",
      "RESOURCE_NOT_PROVIDED",
      "data/trial_ledger.jsonl is not produced by the quant core yet (bridge request 0003).",
      now,
      relativePath,
    );
  }

  const trials = lines.map((line) => {
    const record = asRecord(line);
    return {
      id: (typeof record.id === "string" || typeof record.id === "number" ? record.id : "") as string | number,
      strategy: typeof record.strategy === "string" ? record.strategy : "UNKNOWN",
      verdict: typeof record.verdict === "string" ? record.verdict : "UNKNOWN",
      reason: asNullableString(record.reason),
      recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : "",
    };
  });

  const parsed = TrialsSchema.safeParse({ total: trials.length, trials });
  if (!parsed.success) {
    return failureAt("trials", "RESOURCE_MALFORMED", parsed.error.message, now, relativePath);
  }
  const newest = trials.map((trial) => trial.recordedAt).filter(Boolean).sort().pop() ?? null;
  return success("trials", "filesystem", relativePath, newest, parsed.data, now);
}

export function readFromFilesystem<R extends QuantResource>(
  resource: R,
  root = quantCoreRoot(),
  now = Date.now(),
): QuantResult<ResourceData[R]> {
  switch (resource) {
    case "health":
      return healthResource(root, now) as QuantResult<ResourceData[R]>;
    case "board":
      return boardResource(root, now) as QuantResult<ResourceData[R]>;
    case "forwardOutcomes":
      return forwardOutcomesResource(root, now) as QuantResult<ResourceData[R]>;
    case "universe":
      return simpleJsonResource("universe", "data/universe.json", root, now) as QuantResult<ResourceData[R]>;
    case "regime":
      return simpleJsonResource("regime", "data/regime_state.json", root, now) as QuantResult<ResourceData[R]>;
    case "trials":
      return trialsResource(root, now) as QuantResult<ResourceData[R]>;
    default:
      return failureAt(resource, "RESOURCE_NOT_PROVIDED", `Unknown resource "${resource}".`, now);
  }
}
