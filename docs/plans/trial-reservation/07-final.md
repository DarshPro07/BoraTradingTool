# Final — Durable Trial Reservation

**Verdict: VERIFIED** (defined scope). Independent verifier: **PASS, high confidence, 0 blockers,
7/7 claims CONFIRMED**, atomic exclusion empirically proven.

## Objective (owner, 2026-08-14)

Replace the filesystem-lease budget-atomicity fix (which had a stale-lock/split-brain variant and
no crash-and-peek protection) with a durable trial reservation: a short-transaction
`UNIQUE(trading_date, budget_slot)` exclusion, a fencing token, an explicit state machine, and
crash recovery — before Agents/Teams sit above the governor.

## Delivered

- **Table + migration** (`drizzle/0019_trial_reservations.sql`, registered in protected
  `migrate.ts`, schema.ts): partial `UNIQUE(trading_date, budget_slot) WHERE state IN
  ('RESERVED','SPENT')` is the atomic mutex; `id` is the fencing token.
- **Governor** (`lib/strategy/trial-governor.ts`): `reserveTrialSlot` (one short transaction:
  reclaim expired→ABANDONED, find free slot, INSERT; UNIQUE catches concurrent double-reserve),
  `consumeTrialReservation` (RESERVED+id → SPENT, else false — the fence), `releaseTrialReservation`,
  `activeReservationsToday` (durable budget count). The file lease is gone.
- **withAuthorizedTrial** now finalizes on **ledger truth**: it consumes the reservation iff a
  `selection_trials` row for the spec actually landed during the spend, so a throw-after-record
  consumes (never undercounts) and a pre-record refusal releases. Both spend callers refactored.
- **State machine:** RESERVED → SPENT | RELEASED | ABANDONED. Crash-and-peek prevented upstream by
  the gauntlet's record-before-compute; a reclaim never deletes a recorded trial (safe direction).

## Evidence

- `npx tsc --noEmit` → 0 · `npm run test:verified` → **147 files / 1735 passed / 0 failed /
  2 skipped** (baseline 1724; +11 net, 0 regressions) · `npm run build` → 0.
- The owner's 7 adversarial scenarios all pinned (trial-governor.test.ts), plus the ledger-truth
  lifecycle and the throw-after-record regression, plus a caller-level guard (the spend runs while
  a slot is RESERVED).
- Verifier empirically reproduced the exclusion: `SQLITE_CONSTRAINT_UNIQUE` on duplicate insert;
  `SQLITE_BUSY` serialization across two live connections under a deferred transaction.

## Why this is stronger than the file lease

- **No stale-lock split-brain:** a stale reservation reclaimed while its holder is alive is safe —
  the fencing token blocks the zombie's finalize, so at most one trial is ever recorded per slot.
- **Durable:** the budget survives restart (read from the table, not memory).
- **Crash-safe:** record-before-compute + ledger-truth finalize mean a crash never yields a free
  peek and never undercounts the budget.

## Residual (low, documented)

- Owner route (`/api/strategy/gauntlet`, actor `owner`) is a separate budget by design —
  human-gated, not autonomous, unchanged.
- `SQLITE_BUSY` past the 5s timeout under heavy multi-process contention throws a clean error (no
  double-spend); a budget=1 design won't realistically hit it.
- `selection_trials`'s family index is non-UNIQUE (pre-existing, unrelated); its idempotency is
  app-level.

## The gate is fully cleared

The autonomous trial lane (`MARKETPULSE_AUTONOMOUS_TRIALS=1`) is now safe to enable whenever the
owner chooses: spending is atomic, durable, fenced against zombies, reconstructed on restart, and
protected against crash-and-peek. This is the version the Agent/Team layer can safely sit above —
no agent reaches `runGauntlet` except through this deterministic gate.

## Next rungs (unchanged order)

Structured warm-up refusals · the durable-kind ladder (forward_resolve, paper_reconcile,
incident_repair) · Agents/Teams as job workers on the Job OS · 1–5 model routing above.
