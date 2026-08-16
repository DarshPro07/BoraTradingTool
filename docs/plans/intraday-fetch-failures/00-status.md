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

**No further code change.** The next meaningful event is runtime evidence. Run this after the next
scheduled accumulation:

```sql
SELECT
    instrument_id,
    resolution,
    source,
    substr(detail, 1, instr(detail, ':') - 1) AS failure_reason,
    requested_start,
    requested_end,
    datetime(ingested_at, 'unixepoch') AS ingested_at
FROM bar_ingestions
WHERE completeness = 'FETCH_FAILED'
ORDER BY ingested_at DESC;
```

Two schema notes, because the obvious column names do not exist: there is **no `failure_reason`
column** — the classified reason is the prefix of `detail` (`"TRANSPORT_TIMEOUT: <message>"`), hence
the `substr`; and the timestamp is `ingested_at`, not `created_at`.

**Read zero rows carefully.** Zero is the desired answer only if the scheduler actually ran. It
stopped once already (2026-08-16 08:26:47Z, cause unrecorded — the process left no log and was gone
before it could be inspected; restarted 08:36Z and confirmed ticking). Check liveness first:

```sql
SELECT datetime(MAX(created_at), 'unixepoch') FROM audit_events
 WHERE action = 'intraday_accumulation';
```

A stopped machine and a fixed bug both produce an empty `FETCH_FAILED` table. Only the second one
earns the conclusion.

Two questions the ledger now answers that could not be asked before:

1. Were the other two per-pass failures also `TRANSPORT_TIMEOUT`? (`UNKNOWN` — the evidence for the
   original three does not exist and cannot be recovered.)
2. Does any failure recur for a *specific* instrument+resolution? That, and only that, would justify
   a retry or a provider-mapping look. Do not add one before the ledger shows it is needed.

Standing constraint: the 80/20 build freeze. This was authorized as a bug exposed by the quant
program, not as new infrastructure.
