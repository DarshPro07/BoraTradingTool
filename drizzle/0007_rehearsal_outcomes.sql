-- Rehearsal outcomes, so the promotion ladder can consume them.
--
-- The ladder's `draft` rung already handles all four rehearsal verdicts — would_pass, would_fail,
-- not_evaluable, rediscovered. It was written to be driven by the rehearsal. But `evidenceFor`
-- derived `rehearsalVerdict` from `validation_results`, which only the gauntlet writes, so the
-- value was always `undefined` and every strategy read "Not yet rehearsed" forever — while the
-- Strategy Lab funnel simultaneously reported "REHEARSED 5".
--
-- The rehearsal ran every fifteen minutes, produced a real verdict, and discarded it. This table
-- is where it goes instead. Rehearsal still spends no trial and carries no statistical weight;
-- persisting it changes what the system *remembers*, not what it claims.
--
-- One row per strategy, replaced each time: the current verdict is the only one the ladder reads,
-- and an append-only history here would grow by six rows every quarter hour to no purpose. The
-- audit trail of cycles already lives in `audit_events`.

CREATE TABLE IF NOT EXISTS rehearsal_outcomes (
  strategy_spec_id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  trades INTEGER NOT NULL DEFAULT 0,
  instruments_evaluated INTEGER NOT NULL DEFAULT 0,
  rehearsed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rehearsal_outcomes_at ON rehearsal_outcomes(rehearsed_at);
