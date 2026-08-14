# Gate 0 — Reality

All labels per the factory taxonomy. Everything below was read in this checkout (2026-08-13).

## What Dependency Resolver v1 already does (STATICALLY_CONFIRMED)

- `lib/research/queue.ts` — durable queue: kinds incl. `ingest_history`; statuses incl.
  `waiting_dependency` / `blocked_dependency`; leases (`lockedUntil`), exponential backoff to
  `dead`, dedupe by `dedupeKey`, `availableAt` time-gating, job→job dependencies with cycle
  detection, `unblockDependents` on success, `blockDependentsOnFailure` on terminal failure.
- `lib/research/worker.ts` — executes `ingest_history` via `ingestInstrumentHistory`; a refusal
  throws `"<CODE>: message"` so the code lands in `lastError`.
- `lib/market/ingest.ts` — honest outcome codes: `INGESTED / ALREADY_READY / INSTRUMENT_UNKNOWN /
  SOURCE_UNAVAILABLE / INSUFFICIENT_SOURCE_BARS`; idempotent by construction; NSE-master guard
  against phantom instruments. Does NOT emit `DATA_INGESTED` (the event type exists and
  `lib/brain/kernel.ts:239` consumes it, but market ingestion never publishes it — only knowledge
  ingestion does, with the placeholder instrumentId "knowledge-source").
- `lib/learning/cycle.ts:680-738` — the rehearsal outage branch enqueues `ingest_history` for ≤30
  XNSE instruments below the research floor, priority 150, dedupe `ingest-history-<id>`. Inline,
  bespoke — the generalization target.
- `lib/runtime/supervisor.ts` — 60s cycle tick + 5s research lane (own lease). Health:
  `impaired.length > 0 → DEGRADED`, where `impaired` = reasons recorded from catch blocks.
- `lib/forecast/live.ts` — archive + `scoreDueForecasts(loader)`: pooled grading, ledger-deduped,
  called ONLY from the learning cycle (60s, learning mode+) with a PROVIDER-backed loader.
- `lib/market/phases.ts` — real market clock: IN/US phase windows, holidays, early closes,
  `minutesToNextBoundary`, `nextSessionOpen`. Nothing attaches it to waiting states.
- Warm-up refusals originate in `lib/quantcore/signals.ts:150` ("still inside its warm-up
  window") — FEATURE warm-up (insufficient bars), surfaced through quant-core generation skips in
  the cycle.

## Defects this plan fixes (the feedback's tightening list)

1. **REPRODUCED-BY-READ — dead jobs block remediation forever.** `enqueue` dedupe returns any
   existing row with the key regardless of status. Once `ingest_history` dies (3 failed attempts —
   e.g. a transient provider outage), `dedupeKey` matches the dead row forever and the cycle's
   remediation is permanently deduped. The feedback asked for the opposite failure-handling in
   both directions: retryable outage → RETRY_AFTER; permanent (INSTRUMENT_UNKNOWN) → BLOCKED_
   PERMANENT with **no** retries at all (today it retries an unknown instrument 3 times first).
2. **STATICALLY_CONFIRMED — a non-throwing impairment cannot degrade the run.** Health =
   catch-blocks only. Quant core CONFIGURED but unreachable returns a structured status (no
   throw) and lands in `skipped` — the run stays RUNNING. This is the exact class the feedback
   names ("provider returns HTTP 200 with empty candles", "Python worker returns structured
   {status: unavailable}").
3. **STATICALLY_CONFIRMED — forecast resolution is cycle-polled, not bar-driven.** A prediction
   matured by an ingestion waits up to 60s for the next cycle, and only in learning mode+, and
   the cycle's loader reaches the provider even when the store already holds the resolving bars.
4. **STATICALLY_CONFIRMED — waiting states name no wake time.** "15 predictions awaiting bars"
   and warm-up notes carry no `resumeAt`, though `getMarketPhase` can compute one.
5. **OBSERVED (owner) — remediation is bespoke.** The cycle's inline block is the only
   implementation of "blocked → prerequisite → job"; nothing else can reuse it.

## Constraints

- Protected paths untouched: lib/governance, lib/security, lib/paper/risk.ts,
  lib/quantcore/contract.ts, mcp/**, migrations already applied.
- `rehearsal still refuses the current pass` stays: mid-evaluation fetches remain forbidden;
  remediation is asynchronous by design.
- Suite baseline: 138 files / 1654 passed / 0 failed (`npm run test:verified`, session 5).
