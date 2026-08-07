# Quant Core Contract v1 — FROZEN

The single seam between the TypeScript control plane (`E:\BoraTradingTool`) and the Python quant
core (`E:\Trading_BOT`). Either side may change its internals freely as long as this holds.

- **Direction:** read-only. The control plane never mutates quant-core state.
- **Owner of this file:** shared. Changes require a request/response exchange in the bridge (§5).
- **Versioning:** additive only within v1. A breaking change becomes v2 and both versions are
  served during migration.

---

## 1. Transport

Two transports, tried in order. The client degrades rather than fails.

| Order | Transport | Detail |
|---|---|---|
| 1 | HTTP | `http://127.0.0.1:8787/v1/<resource>` — loopback only, no auth (loopback is the boundary) |
| 2 | Filesystem | Read the artifacts the quant core already writes (§4) |
| 3 | Unavailable | Return `QUANT_CORE_UNAVAILABLE`. **Never fabricate.** |

The filesystem transport exists so the control plane keeps working while the Python service is
being refactored by the other agent. It is not a fallback of last resort — it is the normal path
until the HTTP service ships.

## 2. Envelope

Every response carries provenance so the UI can always answer "where did this come from?".

```jsonc
{
  "ok": true,
  "resource": "board",
  "version": "v1",
  "transport": "filesystem",          // "http" | "filesystem"
  "generatedAt": "2026-08-05T03:46:00Z", // from the source, not from read time
  "retrievedAt": "2026-08-06T01:52:11Z",
  "stale": false,                     // generatedAt older than the resource's freshness budget
  "source": "reports/board_history/2026-08-05_board_packet.json",
  "data": { }
}
```

Failure envelope:

```jsonc
{
  "ok": false,
  "resource": "board",
  "code": "QUANT_CORE_UNAVAILABLE",   // see §6
  "message": "No board packet found and HTTP transport did not respond.",
  "retrievedAt": "2026-08-06T01:52:11Z"
}
```

## 3. Resources

### 3.1 `health`
Freshness budget: 5 minutes.
```jsonc
{
  "mode": "PAPER_ONLY",
  "safety": { "liveExecution": false, "brokerEnabled": false, "modelGate": "CLOSED" },
  "dataStatus": {
    "daily": "PASS",
    "dailyRange": "2016-01-01..2026-07-17",
    "intraday15m": "108 symbols, ~60d (recent-only)",
    "dataConfidence": 100,
    "primaryLimit": "DATA_LIMITED_FORWARD_OUTCOMES"
  },
  "lastRunAt": "2026-08-05T03:46:00Z"
}
```
`safety.liveExecution` must be `false`. The control plane treats `true` as a hard fault and
surfaces a blocking banner — it does not enable any execution path.

### 3.2 `board`
The daily forward board. Freshness budget: 36 hours.
```jsonc
{
  "candidates": [
    { "symbol": "TMPV.NS", "side": "PAPER_LONG_CANDIDATE", "setup": "gap_up_continuation",
      "score": null, "verdict": "RESEARCH_ONLY", "blockers": ["forward_gate_not_open"] }
  ],
  "gates":      { "gap_up_forward": "23/50", "rsi_watchlist": "0/30", "model_gate": "CLOSED" },
  "strategies": { "gap_up_rvol_gte_1_5": "0/50 OPEN_COLLECTING" },
  "outcomeAudit": {
    "historicalWins": 582, "historicalLosses": 1038, "historicalExpired": 3297,
    "liveResolved": 11, "labelMappingOk": true, "mlGate": "PASS"
  },
  "scenarios": { "active": 23, "resolved": 0, "pending": 0 }
}
```
`verdict` is an enum: `RESEARCH_ONLY` | `PAPER_CANDIDATE` | `BLOCKED`. Anything else is treated
as `BLOCKED`.

### 3.3 `universe`
The tradable universe the quant core recognises. Freshness budget: 7 days.
```jsonc
{ "market": "NSE", "count": 130,
  "instruments": [{ "symbol": "RELIANCE.NS", "sector": "Energy", "liquid": true }] }
```

### 3.4 `forwardOutcomes`
Append-only forward observations — the only unbiased evidence in the system.
Freshness budget: 36 hours.
```jsonc
{ "resolved": 11, "pending": 23,
  "observations": [
    { "id": "fo_2026-07-11_TMPV", "symbol": "TMPV.NS", "strategy": "gap_up_rvol_gte_1_5",
      "openedAt": "2026-07-11", "resolvedAt": "2026-07-15", "outcome": "LOSS", "rMultiple": -1.0 }
  ] }
```

### 3.5 `regime`
Freshness budget: 24 hours.
```jsonc
{ "state": "LOW_VOL", "asOf": "2026-08-05", "confidence": 0.62, "calibration": "walk_forward" }
```

### 3.6 `trials`
The trial ledger — **every** attempt, including failures. Freshness budget: 24 hours.
```jsonc
{ "total": 229,
  "trials": [
    { "id": 184, "strategy": "gap_quality_v4", "verdict": "FAIL",
      "reason": "cost_failure", "recordedAt": "2026-06-02" }
  ] }
```

## 4. Filesystem transport mapping

| Resource | Path (relative to `E:\Trading_BOT`) | Selection |
|---|---|---|
| `health` | `reports/board_history/*_board_packet.json` | newest by filename date |
| `board` | `reports/board_history/*_board_packet.json` | newest by filename date |
| `universe` | `data/universe.json` *(requested — see §5)* | whole file |
| `forwardOutcomes` | `data/forward_journal.jsonl` | all lines, newest last |
| `regime` | `data/regime_state.json` *(requested)* | whole file |
| `trials` | `data/trial_ledger.jsonl` *(requested)* | all lines |

Resources marked *(requested)* do not exist yet and correctly return `RESOURCE_NOT_PROVIDED`
until the quant core writes them. The control plane renders an explicit "not provided by quant
core" state — never a zero, never an empty chart implying no data.

## 5. Bridge protocol (two agents, one system)

Directory: `E:\Trading_BOT\runtime\bridge\` — append-only, shared ownership.

```
runtime/bridge/
  claims/<agent>.json      advisory lock: files an agent is editing, with expiry
  requests/<id>.json       what one agent needs from the other
  responses/<id>.json      what was delivered
```

**Claim file** — written before touching any shared file, refreshed while working:
```jsonc
{ "agent": "claude", "paths": ["runtime/bridge/requests/0001.json"],
  "startedAt": "2026-08-06T01:50:00Z", "expiresAt": "2026-08-06T02:50:00Z",
  "task": "Phase 0 bridge setup" }
```
Rule: before writing a shared path, read every claim file. If another agent holds an unexpired
claim on it, **skip and record it** — never block, never wait, never override.

**Request file**:
```jsonc
{ "id": "0001", "from": "claude", "to": "opencode", "createdAt": "2026-08-06T01:50:00Z",
  "kind": "expose_resource", "resource": "universe",
  "detail": "Write data/universe.json matching Contract v1 §3.3.",
  "status": "open" }
```
Status: `open` → `accepted` → `delivered` | `declined`. The responder writes
`responses/<id>.json` and never edits the request.

## 6. Error codes

| Code | Meaning | UI treatment |
|---|---|---|
| `QUANT_CORE_UNAVAILABLE` | Neither transport responded | Amber "quant core offline" panel |
| `RESOURCE_NOT_PROVIDED` | Resource is not yet produced | Grey "not provided" placeholder with the request id |
| `RESOURCE_STALE` | Beyond freshness budget | Data shown with a stale badge and the age |
| `RESOURCE_MALFORMED` | Parsed but failed schema validation | Red panel, raw source path shown |
| `CONTRACT_VERSION_MISMATCH` | Server reports an unsupported version | Red panel, upgrade instruction |

`RESOURCE_STALE` still returns data. Every other code returns none.

## 7. Invariants

1. The control plane never writes `E:\Trading_BOT\src\**`.
2. The quant core never writes `E:\BoraTradingTool\**`.
3. No resource in this contract carries an order-placement capability.
4. Missing data is always distinguishable from zero data in both the API and the UI.
5. Every rendered number traces to a `source` path and a `generatedAt` timestamp.
