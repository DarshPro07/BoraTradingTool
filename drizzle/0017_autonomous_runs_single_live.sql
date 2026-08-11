-- Fix the single-live-run constraint from 0016.
--
-- 0016 wrote `CREATE UNIQUE INDEX ... ON autonomous_runs (status) WHERE status IN
-- ('STARTING','RUNNING','DEGRADED')`. That is unique on the VALUE of `status`, so it permits one
-- row PER DISTINCT LIVE STATUS: a row in STARTING and a row in RUNNING coexist happily. Since a
-- run is inserted as STARTING and promoted to RUNNING on its first tick, the exact race the index
-- existed to prevent — two presses of Start milliseconds apart — slipped straight through it.
--
-- Caught by `lib/runtime/supervisor.test.ts` ("the database refuses a second live run even if the
-- read said there was none"), which inserts the losing racer directly and asserts the storage layer
-- rejects it. That test failed against 0016, which is what makes it worth keeping.
--
-- The fix indexes an EXPRESSION collapsing every live status to one constant, and to NULL
-- otherwise. SQLite does not treat NULLs as equal in a unique index, so any number of STOPPED and
-- CRASHED rows coexist while at most one row can ever be live.
--
-- NOTHING IS DROPPED. An earlier draft of this file dropped 0016's index and was caught by
-- `migrate.test.ts` ("contains no destructive SQL") — correctly, and the guard is not worth
-- weakening for tidiness. It costs nothing to leave the old index in place: it is strictly WEAKER
-- than this one (it forbids two live rows sharing a status; this forbids two live rows at all), so
-- the pair enforces exactly what this one enforces. A database that already had the old index
-- dropped and a fresh install that still carries it both satisfy the invariant.

CREATE UNIQUE INDEX IF NOT EXISTS autonomous_runs_one_live
  ON autonomous_runs (
    CASE WHEN status IN ('STARTING', 'RUNNING', 'DEGRADED') THEN 1 ELSE NULL END
  );
