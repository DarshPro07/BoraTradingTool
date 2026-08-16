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

**No further code change.** The next meaningful event is runtime evidence, expected at the first
cycle after **2026-08-16 17:42Z (23:12 IST)** — `ACCUMULATION_INTERVAL_SECONDS` is 20h and the last
pass was 2026-08-15 21:42Z. `VERIFIED` that the pass will fire: the gate at `lib/learning/cycle.ts`
is `(mode === "learning" || mode === "evolving") && accumulationDue()`, mode is `evolving`, and it
is **not** conditioned on market hours — so the off-hours cycle runs it.

### Three independent truths, in order

A zero in step 3 means nothing until 1 and 2 are proven. Run them in this order.

```sql
-- 1. Is the machine alive at all?
SELECT datetime(MAX(created_at), 'unixepoch') AS last_audit,
       COUNT(*)                               AS rows_last_10min
  FROM audit_events
 WHERE created_at >= unixepoch('now') - 600;

-- 2. Did the scheduled accumulation actually execute?
SELECT datetime(MAX(created_at), 'unixepoch')
  FROM audit_events
 WHERE action = 'intraday_accumulation';        -- must be > 2026-08-15 21:42Z

-- 3. Only then: what failed during that pass?
SELECT instrument_id, resolution, source,
       CASE WHEN instr(detail, ':') > 0
            THEN substr(detail, 1, instr(detail, ':') - 1)
            ELSE detail
       END AS failure_reason,
       requested_start, requested_end,
       datetime(ingested_at, 'unixepoch') AS ingested_at
  FROM bar_ingestions
 WHERE completeness = 'FETCH_FAILED'
 ORDER BY ingested_at DESC;
```

Schema notes, because the obvious column names do not exist: there is **no `failure_reason`
column** — the classified reason is the prefix of `detail` (`"TRANSPORT_TIMEOUT: <message>"`) — and
the timestamp is `ingested_at`, not `created_at`. The `CASE` guard is not cosmetic: `instr()`
returns 0 when the delimiter is absent, and `substr(detail, 1, -1)` then returns the **empty
string** rather than the whole value, so an unguarded expression fails silently and blank.

### Observer mechanics, and what was actually established about them

Two observer defects were found before the window, both of which would have produced the false
alarm this document already warns about — a missing log read as an accumulator failure.

**PATH.** `python` resolves only inside the Bash/venv environment; a bare PowerShell process does
not inherit it, and executables are resolved from the process environment a child inherits. The
first watcher looked healthy all evening because it was asleep and had never exercised its
interpreter call. It would have woken at 18:05Z, failed to find `python`, and written nothing.
Fixed by pinning the absolute interpreter (`D:\hermes\hermes-agentenv\Scripts\python.exe`),
verified to run from a bare PowerShell.

**Detachment.** `ESTABLISHED`: in this harness, children launched through the short-lived wrapper
did not survive, and did survive once the launch sequence was changed and independently verified
alive by PID. `NOT ESTABLISHED`: why. `-PassThru` is not a detachment mechanism — it returns the
process object, which is what made `HasExited` checkable, and attributing survival to it was an
unfounded causal claim. A short delay avoiding a race, or Windows job-object containment reclaiming
descendants, are both plausible and neither was measured.

**The discipline that outranks all of it: watcher survival is not MarketPulse evidence.** A live
observer proves nothing about the accumulator, and a dead one disproves nothing. The authoritative
sequence is unchanged — scheduler alive → marker advanced → intraday 5/15/60 work → FETCH_FAILED.

The in-session waiter was reclaimed by the harness twice within minutes of arming and is no longer
relied upon.

### The identifiers tonight's result belongs to

The repository head and the running build are no longer the same commit, so the result must name
both or it is not reproducible.

```
SYSTEM UNDER TEST     bb5b6bf   (committed 13:44:38Z; server started 13:45:06Z, 28s later)
OBSERVATION TOOLING   916c984   or later
CHANGES SINCE         docs/plans/intraday-fetch-failures/00-status.md ONLY
                      no lib/, app/, mcp/ or drizzle/ change; no restart
```

Verified by `git diff --name-only bb5b6bf..HEAD`: the only file touched is this one. Runtime
behaviour at HEAD is therefore identical to the build under test — but that is a fact to CHECK
each time, not to assume, because a doc-only diff today is an accident of what was edited rather
than a property of the process.

Do **not** later report "the experiment passed on 916c984". The honest form is:

> The scheduled pass ran on `bb5b6bf`, observed with tooling at `916c984` (docs and checker only,
> no runtime change, no restart).

Observation tooling may evolve mid-experiment provided it does not alter the process under test,
does not mutate its data, preserves the raw evidence, and does not redefine the acceptance test to
favour a result that already exists. Tonight's checker change tightened specificity BEFORE any
result existed — the safe direction. It is frozen now.

### What tonight can and cannot establish

The causal ladder, kept honest about which rungs are actually load-bearing:

```
ESTABLISHED   4s budget + a large 5m request -> reproducible ASKAUTOLTD timeout
ESTABLISHED   30s budget + a manual 36-fetch probe -> 36/36 success
TONIGHT       30s budget + the normal learning cycle + 36 COLD fetches -> ?
```

A green result licenses exactly one sentence: **the timeout correction survived the scheduled
production workload.** It does NOT establish that resource contention was the original cause —
that remains a plausible hypothesis and nothing more, because no concurrency or resource
measurement was ever taken. Saying "contention was proven" would be inventing a mechanism to
explain a result, which is the failure mode this whole leg exists to avoid.

### Acceptance criteria, and what is only an expectation

Expected insert is ~50,000 bars (12 instruments × 3 resolutions, all twelve currently holding
ZERO intraday bars — verified, so a near-empty result would be a genuine anomaly rather than "no
new data"). That number is an **expectation, not a threshold**: bar counts move with trading
sessions, provider retention boundaries, and missing intervals. 49,100 is not a failure.

The decisive assertions are:

- the accumulation marker advanced past `2026-08-15 21:42:23Z`
- fetches were actually attempted (ingestion-ledger rows exist for this pass)
- the expected instruments and resolutions are represented
- no **unexplained** `FETCH_FAILED` rows
- bars are materially populated

### If `.tmp/accumulation-check.log` is missing, that is a fact about the WATCHER

A detached watcher (`.tmp/watch-accumulation.ps1`) writes the three checks to
`.tmp/accumulation-check.log` shortly after the window. If that file is absent, it means the
watcher did not execute — **not** that accumulation failed. The two are unrelated, and reading the
first as the second would raise a false alarm about a pass that may have run perfectly.

The authoritative proof that the real accumulation ran is, and remains, the database marker:

```sql
SELECT datetime(MAX(created_at), 'unixepoch') FROM audit_events
 WHERE action = 'intraday_accumulation';
```

The log is a convenience. The marker is the evidence.

### Decision table

| Evidence | Conclusion |
|---|---|
| accumulation timestamp advanced + 0 `FETCH_FAILED` | **Clean production pass — the timeout fix survives scheduled execution** |
| timestamp advanced + failure rows exist | Investigate *those exact persisted failures only* |
| timestamp did not advance, general audit activity continues, **and a cycle reports `"Intraday accumulation did not run: …"`** | Accumulation threw *wholesale* — before the per-fetch loop. See the blind spot below. |
| timestamp did not advance, audit activity continues, no such message | Accumulator scheduling / missed-wake defect |
| timestamp did not advance, audit stale or process absent | Runtime liveness defect — **the fetch result is unknowable** |

Rows 3 and 4 look identical in SQL and are not the same defect. The distinguishing message is
**not** in the database: `impair()` writes to the in-memory cycle report, and there is no cycles
table. Read it over HTTP instead:

```bash
curl -s "http://127.0.0.1:3000/api/cycles?limit=5"   # look for "Intraday accumulation did not run"
```

### Known blind spot, deliberately not fixed

The ledger records per-*fetch* failures. A failure **before** the fetch loop — the catalog load or
the queue query — is caught by the cycle's own `try` and never reaches `bar_ingestions` at all. It
is the same family as the defect just fixed, one layer up. Not fixed now: no evidence it has ever
occurred, and the freeze says wait for the failure before building for it.

Likewise `source` is hardcoded `"yahoo"` on this path rather than taken from the provider that
served the request. **Current truth, not general truth** — accurate while the accumulator has one
provider, and a provenance defect the day a second one enters this path.

### On the scheduler death

One unexplained disappearance (2026-08-16 08:26:47Z, no log, process gone before inspection;
restarted 08:36Z, confirmed ticking) is a **finding, not a root cause**. Do not build a watchdog or
recovery subsystem for it — substantial crash/recovery machinery already exists. If it dies again
under ordinary operation, that is a reproducible defect and earns an investigation.

Two questions the ledger now answers that could not be asked before:

1. Were the other two per-pass failures also `TRANSPORT_TIMEOUT`? (`UNKNOWN` — the evidence for the
   original three does not exist and cannot be recovered.)
2. Does any failure recur for a *specific* instrument+resolution? That, and only that, would justify
   a retry or a provider-mapping look. Do not add one before the ledger shows it is needed.

Standing constraint: the 80/20 build freeze. This was authorized as a bug exposed by the quant
program, not as new infrastructure.
