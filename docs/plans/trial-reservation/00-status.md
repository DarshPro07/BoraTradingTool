# Durable Trial Reservation — Status

**Owner directive 2026-08-14:** the filesystem-lease budget-atomicity fix closed the check-then-spend
TOCTOU but has a stale-lock/split-brain variant (a holder running past the TTL can be reclaimed
while still alive) and does not protect against crash-and-peek. Replace it with a **durable trial
reservation** — a short `BEGIN`-scoped write with a `UNIQUE(trading_date, budget_slot)` exclusion, a
fencing token, and an explicit state machine with crash recovery — before Agents/Teams sit above it.

| # | Slice | Status |
|---|---|---|
| 1 | Table + migration + schema (partial UNIQUE index = atomic exclusion; id = fencing token) | ✅ DONE — 0019 registered, build clean |
| 2 | reserve/consume/release + stale reclaim + activeReservationsToday; file lease removed | ✅ DONE |
| 3 | withAuthorizedTrial reworked to reserve→spend→finalize ({spent,value}); both callers | ✅ DONE |
| 4 | Adversarial tests (the owner's 7) | ✅ DONE — 20 governor tests incl. all 7 scenarios |
| 5 | Verify + independent check | ✅ DONE — verifier PASS 0 blockers 7/7 (atomic exclusion empirically proven via SQLITE_BUSY + SQLITE_CONSTRAINT_UNIQUE); its one finding (release-on-throw undercount) CLOSED with ledger-truth finalize + regression test. 147 files / 1735 passed / 0 failed, tsc 0, build 0 |

## The mechanism

- **Atomic exclusion:** `CREATE UNIQUE INDEX ... ON trial_reservations(trading_date, budget_slot)
  WHERE state IN ('RESERVED','SPENT')`. Two concurrent reservers cannot both take a slot — SQLite
  rejects the second INSERT (caught, retried on the next slot, or exhausted). A RELEASED/ABANDONED
  row does not occupy its slot, so a refused or reclaimed attempt frees budget while keeping history.
- **No held transaction across the gauntlet:** reserve is one short transaction; the gauntlet runs
  outside it; finalize (consume/release) is a second short transaction. Satisfies the owner's SQLite
  rule.
- **Fencing token:** the reservation's `id` is monotonic and never reused. `consumeTrialReservation`
  finalizes only if the row is still `RESERVED` with the matching id, so a zombie whose slot was
  reclaimed (its row is `ABANDONED`) can never record a trial — `STALE`, `TRIAL_NOT_SPENT`.
- **State machine:** RESERVED → SPENT (consumed) | RELEASED (refused before a trial) | ABANDONED
  (stale, reclaimed by a later reserver).
- **Crash-and-peek prevented upstream:** the gauntlet records its selection trial BEFORE computing
  the statistic, so a crash mid/post-gauntlet leaves the trial (its multiple-testing cost) on disk;
  reclaiming the reservation never deletes a trial. A retry is a NEW reservation + NEW trial, never
  a free peek. The only crash effect is possibly an extra recorded trial — the SAFE direction
  (larger denominator = harder validation, never easier).
- **Budget survives restart:** `activeReservationsToday` reads the durable table, so the budget is
  reconstructed from disk with no in-memory state.

## The owner's 7 scenarios, all pinned (lib/strategy/trial-governor.test.ts)

1 two attempts / budget 1 → exactly one reserves · 2 non-expired RESERVED honoured; 2b expired
reclaimed → slot frees · 3 crash-before-gauntlet → release frees the slot · 5 reclaim never deletes
a recorded trial (no crash-and-peek) · 6 zombie finalize → rejected by the fence · 7 restart →
budget reconstructed from the table. Plus the withAuthorizedTrial lifecycle (spend→consume,
refuse→release, throw→release) and a caller-level regression guard (auto-gauntlet.test.ts:
the spend runs while a slot is RESERVED, released on refusal).

## Independent verification (Gate 5)

Fresh-context verifier, its own suite/tsc/build runs + empirical DB scratch scripts: **PASS, high
confidence, 0 blockers, all 7 claims CONFIRMED.** It empirically proved the atomic exclusion — the
real error is `SQLITE_CONSTRAINT_UNIQUE` (so the `.includes("UNIQUE")` catch matches), and two live
connections showed the reclaim-UPDATE-first ordering serializes concurrent reservers with
`SQLITE_BUSY` even under a DEFERRED transaction. It confirmed the fencing token, the no-held-
transaction property, restart reconstruction, and crash-and-peek prevention.

### Its one finding — CLOSED this leg (ledger-truth finalize)

The verifier flagged a latent budget UNDERCOUNT: `runGauntlet` records its selection trial before
computing, then can throw (`HoldoutBudgetExhausted`, only if `holdoutId` is set — never on the
autonomous path today). The old `withAuthorizedTrial` released the reservation unconditionally on a
throw, which would free the slot while a trial stood. **Fixed:** the wrapper now finalizes on
LEDGER TRUTH — it counts `selection_trials` for the reservation's spec before and after the spend
and CONSUMES iff a trial actually landed, independent of what the callback returned or whether it
threw. The `{spent}` self-report contract was removed (both callers now return their value
directly). Regression test added: a spend that records a trial and then throws leaves the
reservation SPENT (not released), the throw still propagates. The verifier's other two items
(stale plan docs; ungraceful `SQLITE_BUSY`-past-timeout under heavy multi-process contention on a
budget=1 design) are low-risk — the docs are this file, and the contention case yields a clean
error with no double-spend.

## Exact next action

Done — write 07-final.
