-- Durable trial-budget reservations — the statistical constitution's atomic gate.
--
-- A permanent validation trial raises the multiple-testing bar for a whole strategy family
-- forever, so spending one must be atomic, durable, and safe across crashes, stalls and future
-- Agent/Team concurrency. The prior mechanism (a filesystem lease with a 10-minute TTL) closed the
-- check-then-spend TOCTOU but introduced a stale-lock variant: a holder that ran past the TTL could
-- be reclaimed while still alive, and a second authorizer could then spend too.
--
-- This table replaces that lease with a durable reservation:
--   * `UNIQUE(trading_date, budget_slot) WHERE state IN ('RESERVED','SPENT')` is the atomic
--     exclusion — SQLite rejects a second INSERT for an occupied slot, so two processes cannot
--     both reserve the same daily budget slot. No filesystem lease, no held transaction across the
--     long gauntlet: the reserve is one short BEGIN IMMEDIATE, and the spend runs outside it.
--   * `id` is the FENCING TOKEN. It is monotonic and never reused, so a zombie process that wakes
--     after its reservation was reclaimed cannot finalize: the finalize matches on `id` AND
--     `state='RESERVED'`, and a reclaimed reservation is `ABANDONED`.
--   * a RELEASED/ABANDONED row does NOT occupy its slot (the partial index excludes it), so a
--     refused attempt or a reclaimed stale holder frees the slot for a genuine spend, while the
--     full history stays on disk for audit.

CREATE TABLE IF NOT EXISTS trial_reservations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trading_date      TEXT NOT NULL,
  budget_slot       INTEGER NOT NULL,
  strategy_spec_id  TEXT NOT NULL,
  actor             TEXT NOT NULL,
  state             TEXT NOT NULL,
  reserved_at       INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  finalized_at      INTEGER
);

-- The atomic budget mutex: at most one ACTIVE (RESERVED or SPENT) reservation per day+slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_res_active_slot
  ON trial_reservations (trading_date, budget_slot)
  WHERE state IN ('RESERVED', 'SPENT');

-- The budget-count query reads active rows for a day.
CREATE INDEX IF NOT EXISTS idx_trial_res_day ON trial_reservations (trading_date, state);
