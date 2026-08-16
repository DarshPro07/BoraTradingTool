# Status — intraday fetch failures

**Complete. Verdict VERIFIED** — see `07-final.md`.

| Gate | State | Where |
|---|---|---|
| 0 Reality | done | `01-reality.md` — the reconstruction was impossible, and that was the finding |
| 1–3 Product / Architecture / Program design | folded into reality | A root-cause fix with no new surface: two defects, three files, no schema change, no new module. Recording the design separately would have restated `01-reality.md`. |
| 4 Slices | done | Two slices, each fail-first: ledger blindness, then the timeout budget |
| 5 Independent verification | done | `07-final.md` — 670 tests, tsc clean, live probe 0/36 failures |

## What changed

- `lib/market/bar-audit.ts` — `FETCH_FAILED`, `classifyFetchFailure()`, `failedFetchAudit()`
- `lib/market/intraday-accumulator.ts` — the `catch` writes the ledger row
- `lib/providers/yahoo.ts` — `candleTimeoutMs()`; bulk intraday 30s, render paths keep 4s

## Exact next action

**None here.** Read `bar_ingestions WHERE completeness = 'FETCH_FAILED'` after the next few
production passes. Two questions it now answers that could not be asked before:

1. Were the other two per-pass failures also `TRANSPORT_TIMEOUT`? (`UNKNOWN` — the evidence for the
   original three does not exist and cannot be recovered.)
2. Does any failure recur for a *specific* instrument+resolution? That, and only that, would justify
   a retry or a provider-mapping look. Do not add one before the ledger shows it is needed.

Standing constraint: the 80/20 build freeze. This was authorized as a bug exposed by the quant
program, not as new infrastructure.
