# Gate 3 — Program Design

## Contracts

```ts
// lib/research/queue.ts
export type FailureClass = "PERMANENT" | "RETRYABLE";
export const REVIVAL_COOLDOWN_MS = 15 * 60_000;
export function failureClass(lastError: string | null): FailureClass;
// failJob(id, error): PERMANENT → status "dead" immediately (event "dead_permanent").
// enqueue(): dedupe hit on status "dead" →
//   PERMANENT → { deduped: true }
//   RETRYABLE && now - updatedAt >= REVIVAL_COOLDOWN_MS → revive: status queued, attempts 0,
//     availableAt now, event "revived"; returns { deduped: false, revived: true }
//   RETRYABLE cooling → { deduped: true }

// lib/brain/dependency-resolver.ts
export interface DataRequirement { instrumentId: string; minimumBars?: number; purpose: "research" | "rehearsal" | "backtest"; }
export type ResolutionState = "SATISFIED" | "REMEDIATION_QUEUED" | "REMEDIATION_ACTIVE"
  | "COOLING_DOWN" | "BLOCKED_PERMANENT" | "UNKNOWN_INSTRUMENT";
export interface Resolution { state: ResolutionState; jobId: number | null; detail: string; }
export function resolveDataRequirement(req: DataRequirement): Resolution;
export function resolveUniverseDataGaps(opts?: { quota?: number }): { queued: number; revived: number; blocked: number; considered: number };

// lib/learning/reasons.ts
export type ReasonCategory = "ELIGIBILITY" | "DEPENDENCY" | "INFRASTRUCTURE";
export type ReasonSeverity = "INFO" | "WARNING" | "DEGRADED" | "FAILED";
export interface CycleReason { code: string; category: ReasonCategory; severity: ReasonSeverity;
  message: string; resumeAt?: string; dependency?: string; }
export function degradesRun(reasons: readonly CycleReason[]): boolean;
export function nextBarOpportunity(market: Market, at?: Date): string | null; // ISO or null

// lib/forecast/resolver.ts
export function registerForecastResolver(): () => void; // idempotent via globalThis symbol
export function resolveMaturedForecasts(): Promise<LiveScoreReport>; // store-only loader
```

## Call flows

- `cycle.ts` rehearsal-gap branch → `resolveUniverseDataGaps({ quota: 30 })`; reason
  DEPENDENCY/WARNING `DATA_HISTORY_MISSING` with dependency `ingest_history`.
- `supervisor.tick` → `degradesRun(report.reasons)` || `impaired.length > 0` → DEGRADED.
- `startAutonomousRun`/`recoverInterruptedRun` → `registerForecastResolver()`.
- `ingestInstrumentHistory` → after `persistCandles` → `emit DATA_INGESTED` (only when inserted > 0).

## Error model

- Resolver never throws on a doomed instrument — it returns the truthful state.
- Forecast subscriber: full try/catch, store-only; a grading failure is logged per-forecast by
  the existing ledger discipline, never thrown into the publisher.

## Test design (critical regressions with their known failure modes)

| Test | Fails against unfixed code because |
|---|---|
| permanent failure dies on attempt 1 with maxAttempts 3 | old failJob requeues until attempts==max |
| dead RETRYABLE + cooldown → enqueue revives | old dedupe returns dead row forever |
| dead PERMANENT + cooldown → enqueue refuses | (guards the new revival from overshooting) |
| unreachable-quant-core report → DEGRADED | old tick only consults `impaired` (catch blocks) |
| ingest emits DATA_INGESTED → matured forecast graded, no cycle | old code only grades inside runLearningCycle |
| loop: blocked → auto-job → worker → SATISFIED | v1 has no re-checkable resolution state |

## Least-confident decisions

- REVIVAL_COOLDOWN_MS=15m (one-ish cycle world): chosen over per-code backoff — revisit when a
  rate-limited provider proves 15m wrong.
- INSUFFICIENT_SOURCE_BARS classed RETRYABLE: a young listing gains bars with time; permanent
  would freeze a security that IPO'd last quarter out of research forever.

## Rollback

All additive besides three guarded call-site edits (cycle remediation block, tick status
derivation, ingest emit). Reverting the three edits restores v1 exactly; new modules are inert
without their call sites.
