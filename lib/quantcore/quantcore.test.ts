import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchQuantResource, quantCoreStatus } from "./client";
import { latestBoardFile, readFromFilesystem } from "./filesystem";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const BOARD_PACKET = {
  generated_at: "(stamp on write)",
  mode: "PAPER_ONLY",
  safety: { live_execution: false, broker_enabled: false, model_gate: "CLOSED" },
  data_status: {
    daily: "PASS",
    daily_range: "2016-01-01 .. 2026-07-17",
    intraday_15m: "108 symbols, ~60d (recent-only)",
    data_confidence: 100,
    primary_limit: "DATA_LIMITED_FORWARD_OUTCOMES",
  },
  outcome_audit: {
    historical_wins: 582,
    historical_losses: 1038,
    historical_expired: 3297,
    live_resolved: 11,
    label_mapping_ok: true,
    ml_gate: "PASS",
  },
  strategies: { gap_up_rvol_gte_1_5: "0/50 OPEN_COLLECTING" },
  gates: { gap_up_forward: "23/50", model_gate: "CLOSED" },
  scenarios: { active: 23, resolved: 0, pending: 0 },
  candidates: [
    {
      symbol: "TMPV.NS",
      side: "PAPER_LONG_CANDIDATE",
      setup: "gap_up_continuation",
      score: null,
      verdict: "RESEARCH_ONLY",
      blockers: ["forward_gate_not_open"],
    },
  ],
};

function makeRoot(options: { board?: unknown; boardDate?: string; journal?: unknown[] } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quantcore-"));
  temporaryDirectories.push(root);

  if (options.board !== undefined) {
    const directory = path.join(root, "reports", "board_history");
    fs.mkdirSync(directory, { recursive: true });
    const date = options.boardDate ?? "2026-08-05";
    fs.writeFileSync(path.join(directory, `${date}_board_packet.json`), JSON.stringify(options.board));
  }

  if (options.journal !== undefined) {
    const directory = path.join(root, "data");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "forward_journal.jsonl"),
      options.journal.map((entry) => JSON.stringify(entry)).join("\n"),
    );
  }

  return root;
}

const AUG_6 = Date.parse("2026-08-06T02:00:00Z");

describe("board packet reading", () => {
  it("maps the real packet shape into the contract", () => {
    const root = makeRoot({ board: BOARD_PACKET });
    const result = readFromFilesystem("board", root, AUG_6);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0]).toMatchObject({ symbol: "TMPV.NS", verdict: "RESEARCH_ONLY" });
    expect(result.data.outcomeAudit.historicalLosses).toBe(1038);
    expect(result.data.gates.gap_up_forward).toBe("23/50");
    expect(result.transport).toBe("filesystem");
    expect(result.source).toContain("board_history");
  });

  it("falls back to the filename date when generated_at is a placeholder", () => {
    const root = makeRoot({ board: BOARD_PACKET, boardDate: "2026-08-05" });
    const result = readFromFilesystem("board", root, AUG_6);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.generatedAt).toBe("2026-08-05T00:00:00Z");
    expect(result.ageMs).toBeGreaterThan(0);
  });

  it("prefers a real generated_at when one is present", () => {
    const root = makeRoot({ board: { ...BOARD_PACKET, generated_at: "2026-08-05T03:46:00Z" } });
    const result = readFromFilesystem("board", root, AUG_6);
    expect(result.ok && result.generatedAt).toBe("2026-08-05T03:46:00Z");
  });

  it("picks the newest packet by filename date", () => {
    const root = makeRoot({ board: BOARD_PACKET, boardDate: "2026-07-01" });
    const directory = path.join(root, "reports", "board_history");
    fs.writeFileSync(path.join(directory, "2026-08-04_board_packet.json"), JSON.stringify(BOARD_PACKET));
    fs.writeFileSync(path.join(directory, "notes.txt"), "ignore me");

    expect(latestBoardFile(root)?.date).toBe("2026-08-04");
  });

  it("downgrades an unrecognised verdict to BLOCKED rather than widening it", () => {
    const root = makeRoot({
      board: { ...BOARD_PACKET, candidates: [{ ...BOARD_PACKET.candidates[0], verdict: "AUTO_BUY" }] },
    });
    const result = readFromFilesystem("board", root, AUG_6);
    expect(result.ok && result.data.candidates[0].verdict).toBe("BLOCKED");
  });

  it("flags a packet older than the freshness budget as stale", () => {
    const root = makeRoot({ board: BOARD_PACKET, boardDate: "2026-07-01" });
    const result = readFromFilesystem("board", root, AUG_6);
    expect(result.ok && result.stale).toBe(true);
  });

  it("reports unavailable when no packet exists", () => {
    const root = makeRoot();
    const result = readFromFilesystem("board", root, AUG_6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("QUANT_CORE_UNAVAILABLE");
    expect(result.retrievedAt).toBe(new Date(AUG_6).toISOString());
  });

  it.each([
    ["missing wins", { ...BOARD_PACKET, outcome_audit: { ...BOARD_PACKET.outcome_audit, historical_wins: undefined } }],
    ["string wins", { ...BOARD_PACKET, outcome_audit: { ...BOARD_PACKET.outcome_audit, historical_wins: "582" } }],
    ["null losses", { ...BOARD_PACKET, outcome_audit: { ...BOARD_PACKET.outcome_audit, historical_losses: null } }],
    ["missing scenarios", { ...BOARD_PACKET, scenarios: undefined }],
    ["string active scenarios", { ...BOARD_PACKET, scenarios: { ...BOARD_PACKET.scenarios, active: "23" } }],
  ])("rejects malformed required board numerics: %s", (_label, board) => {
    const result = readFromFilesystem("board", makeRoot({ board }), AUG_6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_MALFORMED");
  });

  it.each([
    ["negative count", { ...BOARD_PACKET, outcome_audit: { ...BOARD_PACKET.outcome_audit, historical_wins: -1 } }],
    ["fractional count", { ...BOARD_PACKET, scenarios: { ...BOARD_PACKET.scenarios, active: 1.5 } }],
  ])("rejects invalid count semantics: %s", (_label, board) => {
    const result = readFromFilesystem("board", makeRoot({ board }), AUG_6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_MALFORMED");
  });

  it("reports invalid JSON as malformed rather than unavailable", () => {
    const root = makeRoot({ board: BOARD_PACKET });
    fs.writeFileSync(latestBoardFile(root)!.absolutePath, "{not-json");
    const result = readFromFilesystem("board", root, AUG_6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_MALFORMED");
  });
});

describe("health", () => {
  it("derives safety flags from the packet", () => {
    const root = makeRoot({ board: BOARD_PACKET });
    const result = readFromFilesystem("health", root, AUG_6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode).toBe("PAPER_ONLY");
    expect(result.data.safety.liveExecution).toBe(false);
    expect(result.data.dataStatus.dataConfidence).toBe(100);
  });

  it("treats a missing safety block as unsafe defaults, not as permission", () => {
    const root = makeRoot({ board: { ...BOARD_PACKET, safety: {} } });
    const result = readFromFilesystem("health", root, AUG_6);
    expect(result.ok && result.data.safety.liveExecution).toBe(false);
    expect(result.ok && result.data.safety.brokerEnabled).toBe(false);
  });
});

describe("forward outcomes", () => {
  it("maps journal lines and never invents an R multiple", () => {
    const root = makeRoot({
      journal: [
        {
          id: "keltner:2026-06-30:swing",
          symbol: "keltner",
          date: "2026-06-30",
          strategy: "keltner",
          status: "PENDING",
          actual_outcome: null,
          pnl_after_costs: 1234.5,
        },
        {
          id: "gap:2026-07-02:swing",
          symbol: "TMPV.NS",
          date: "2026-07-02",
          strategy: "gap_up",
          actual_outcome: "LOSS",
          r_multiple: -1,
        },
      ],
    });

    const result = readFromFilesystem("forwardOutcomes", root, AUG_6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pending).toBe(1);
    expect(result.data.resolved).toBe(1);
    // pnl_after_costs is currency, not R — it must not leak into rMultiple.
    expect(result.data.observations[0].rMultiple).toBeNull();
    expect(result.data.observations[1].rMultiple).toBe(-1);
    expect(result.data.observations[1].outcome).toBe("loss");
  });

  it("collapses re-appended observations instead of inflating forward evidence", () => {
    // The real journal re-appends an observation every time its state is re-evaluated.
    // Counting raw lines overstated forward evidence by ~52% against the operator's data.
    const root = makeRoot({
      journal: [
        { id: "AAPL:2026-06-30:mean_reversion", symbol: "AAPL", date: "2026-06-30", status: "PENDING", actual_outcome: null },
        { id: "AAPL:2026-06-30:mean_reversion", symbol: "AAPL", date: "2026-06-30", status: "PENDING", actual_outcome: null },
        { id: "AAPL:2026-06-30:mean_reversion", symbol: "AAPL", date: "2026-06-30", status: "RESOLVED", actual_outcome: "WIN" },
        { id: "V:2026-07-02:breakout", symbol: "V", date: "2026-07-02", actual_outcome: null },
      ],
    });

    const result = readFromFilesystem("forwardOutcomes", root, AUG_6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.observations).toHaveLength(2);
    // Last append wins: the observation resolved, so it must not still read as pending.
    expect(result.data.resolved).toBe(1);
    expect(result.data.pending).toBe(1);
    expect(result.data.observations.find((o) => o.symbol === "AAPL")?.outcome).toBe("win");
  });

  it("emits unique observation ids so the UI can key on them", () => {
    const root = makeRoot({
      journal: [
        { id: "dup", symbol: "A", date: "2026-07-01" },
        { id: "dup", symbol: "A", date: "2026-07-01" },
      ],
    });
    const result = readFromFilesystem("forwardOutcomes", root, AUG_6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.observations.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports not-provided when the journal is absent", () => {
    const result = readFromFilesystem("forwardOutcomes", makeRoot(), AUG_6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_NOT_PROVIDED");
  });
});

describe("resources the quant core does not produce yet", () => {
  it("returns RESOURCE_NOT_PROVIDED with the open bridge request", () => {
    const root = makeRoot();
    for (const resource of ["universe", "regime", "trials"] as const) {
      const result = readFromFilesystem(resource, root, AUG_6);
      expect(result.ok, `${resource} unexpectedly returned data`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("RESOURCE_NOT_PROVIDED");
    }
  });

  it("validates a universe file once the quant core writes one", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "data", "universe.json"),
      JSON.stringify({ market: "NSE", count: 1, instruments: [{ symbol: "RELIANCE.NS", sector: "Energy", liquid: true }] }),
    );

    const result = readFromFilesystem("universe", root, AUG_6);
    expect(result.ok && result.data.instruments[0].symbol).toBe("RELIANCE.NS");
  });

  it("rejects a malformed universe file instead of rendering junk", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "universe.json"), JSON.stringify({ market: "NSE" }));

    const result = readFromFilesystem("universe", root, AUG_6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_MALFORMED");
  });
});

describe("transport selection", () => {
  it("rejects negative and fractional counts from HTTP transport", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      version: "v1",
      generatedAt: "2026-08-06T00:00:00Z",
      data: {
        candidates: [], gates: {}, strategies: {},
        outcomeAudit: {
          historicalWins: -1, historicalLosses: 1.5, historicalExpired: 0,
          liveResolved: 0, labelMappingOk: true, mlGate: "PASS",
        },
        scenarios: { active: -3, resolved: 0, pending: 0 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      const result = await fetchQuantResource("board", { baseUrl: "http://127.0.0.1:8787", root: makeRoot(), now: AUG_6 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("RESOURCE_MALFORMED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to the filesystem when HTTP is unreachable", async () => {
    const root = makeRoot({ board: BOARD_PACKET });
    const result = await fetchQuantResource("board", {
      root,
      baseUrl: "http://127.0.0.1:1",
      now: AUG_6,
      timeoutMs: 200,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.transport).toBe("filesystem");
  });

  it("skips HTTP entirely when the base url is disabled", async () => {
    const root = makeRoot({ board: BOARD_PACKET });
    const result = await fetchQuantResource("health", { root, baseUrl: null, now: AUG_6 });
    expect(result.ok && result.transport).toBe("filesystem");
  });

  it("reports an unreachable core through quantCoreStatus", async () => {
    const status = await quantCoreStatus({ root: makeRoot(), baseUrl: null, now: AUG_6 });
    expect(status.reachable).toBe(false);
    expect(status.transport).toBe("none");
    expect(status.message).toContain("No board packet");
  });

  it("summarises a healthy core", async () => {
    const status = await quantCoreStatus({ root: makeRoot({ board: BOARD_PACKET }), baseUrl: null, now: AUG_6 });
    expect(status.reachable).toBe(true);
    expect(status.mode).toBe("PAPER_ONLY");
    expect(status.liveExecution).toBe(false);
  });
});

/**
 * Contract conformance against the operator's real quant core. Skipped automatically
 * where that repository is not present so the suite stays portable.
 */
describe("real quant core conformance", () => {
  const realRoot = process.env.QUANT_CORE_ROOT?.trim() || "E:/Trading_BOT";
  const available = fs.existsSync(path.join(realRoot, "reports", "board_history"));

  it.skipIf(!available)("parses the live board packet without a schema error", () => {
    const result = readFromFilesystem("board", realRoot);
    expect(result.ok, result.ok ? "" : `${result.code}: ${result.message}`).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.data.candidates)).toBe(true);
    expect(result.data.outcomeAudit.historicalWins).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!available)("confirms the live core reports execution disabled", () => {
    const result = readFromFilesystem("health", realRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.safety.liveExecution).toBe(false);
    expect(result.data.safety.brokerEnabled).toBe(false);
  });
});
