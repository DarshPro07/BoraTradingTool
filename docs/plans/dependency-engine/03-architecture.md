# Gate 2 — Architecture

## Placement

One new module, four amended ones. No new tables, no migrations — every durable need is already
served by `research_jobs` (`availableAt` = time-gating, `dedupeKey` = identity, `lastError` =
failure code carrier, events ledger = provenance).

```
lib/brain/dependency-resolver.ts   NEW — the generic prerequisite/wake model (B3's named file)
lib/research/queue.ts              + failure classes, revival-on-dedupe, immediate permanent death
lib/learning/cycle.ts              + delegates remediation; emits typed reasons
lib/learning/reasons.ts            NEW — CycleReason type + market-clock resumeAt helper
lib/runtime/supervisor.ts          + health derives from reasons (catch-rule becomes one producer)
lib/market/ingest.ts               + emits DATA_INGESTED after persisting bars
lib/forecast/resolver.ts           NEW — DATA_INGESTED subscriber → store-only forecast grading
```

## Data flow (the loop the product promises)

```
rehearsal gap (cycle)
  → resolveUniverseDataGaps(quota)          [dependency-resolver]
  → enqueue ingest_history (dedupe/priority/revival policy)   [queue]
  → research lane claims within 5s          [supervisor, existing]
  → ingestInstrumentHistory persists bars   [ingest]
  → emit DATA_INGESTED                      [event bus]
  → forecast resolver grades matured predictions from the STORE [forecast/resolver]
  → next cycle: readiness satisfied → rehearsal proceeds
```

## Failure model (the taxonomy the feedback demanded)

`failureClass(kind, lastError)` reads the `CODE:` prefix the worker already throws:

| Class | Codes today | failJob | enqueue-on-dead |
|---|---|---|---|
| PERMANENT | INSTRUMENT_UNKNOWN | dead immediately, attempts wasted = 0 | deduped forever (BLOCKED_PERMANENT) |
| RETRYABLE | SOURCE_UNAVAILABLE, INSUFFICIENT_SOURCE_BARS, anything unrecognized | backoff → dead at maxAttempts | revived (queued, attempts reset) once REVIVAL_COOLDOWN_MS has passed since death; deduped while cooling |

Unrecognized defaults to RETRYABLE: wrongly retrying a doomed job costs bounded attempts;
wrongly blocking a recoverable one forever is the defect being fixed.

## Health model

`CycleReason { code, category: ELIGIBILITY|DEPENDENCY|INFRASTRUCTURE, severity:
INFO|WARNING|DEGRADED|FAILED, message, resumeAt?, dependency? }`.

- Catch blocks keep producing reasons mechanically (INFRASTRUCTURE/DEGRADED) — the v1 rule
  survives as ONE producer instead of THE rule.
- Normal-path structured failures now expressible: quant core unreachable-though-configured →
  INFRASTRUCTURE/DEGRADED; stale → INFRASTRUCTURE/WARNING (visible, not degrading); disabled →
  ELIGIBILITY/INFO.
- Supervisor: any reason with severity DEGRADED|FAILED → run DEGRADED; else RUNNING. Falls back
  to `impaired` when `reasons` is absent (older mocked reports keep passing — compat is a
  test-reality constraint, not politeness).

## Alternatives considered

- **New `blocked_work` table** — rejected: `research_jobs` + dedupe keys already model identity,
  waiting and revival; a second ledger would drift from the first.
- **LangGraph/Temporal adoption** — rejected per WORK_QUEUE precedent: durability properties
  already satisfied by owned machinery; migration risk buys nothing.
- **Direct call ingest→forecast** (no event) — rejected: kernel already consumes the bus;
  the bus is the wake channel every later resolver (paper, forward) will need.
- **Full CycleReport string→typed migration** — rejected for this pass: `skipped`/`impaired`
  strings feed the UI and run-log; reasons ride BESIDE them. Migrating 50+ push sites is churn
  with no behavior change; the health-relevant sites are migrated.

## Risks

- Revival must never resurrect a PERMANENT failure (test pinned).
- Forecast subscriber runs inside the ingestion call path (bus is synchronous notify) — it must
  never throw into the publisher (bus already guards) and must never reach the network
  (store-only loader by construction).
- `DATA_INGESTED` for knowledge sources uses instrumentId "knowledge-source" — the forecast
  resolver must ignore non-market events (no stored bars will match; still filtered explicitly).
