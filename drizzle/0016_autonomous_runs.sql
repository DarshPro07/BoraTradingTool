-- The AutonomousRun ledger (Master Form Task 1).
--
-- One row per press of "Start MarketPulse". It answers the question the product could not answer
-- before: **is the machine running right now, and what is it about to do?** `/brain` could already
-- show what had been produced, but a system that had never been started and one whose driver died
-- an hour ago rendered identically — both simply had no recent rows.
--
-- The supervisor's TICKER lives in the server process; the WORK lives in `research_jobs`, which is
-- leased, deduped and retried. Losing the process therefore loses a tick, never a unit of work.
-- This table is what makes that loss VISIBLE: a stale heartbeat is how an interrupted run is
-- detected and reconciled instead of quietly leaving a gap in the night.

CREATE TABLE IF NOT EXISTS autonomous_runs (
  id                 TEXT PRIMARY KEY,
  -- STARTING | RUNNING | DEGRADED | STOPPED | CRASHED.
  -- DEGRADED is a running machine with a named failed subsystem, not a stopped one — a provider
  -- outage must not take down the deterministic data and market work that does not need it.
  status             TEXT NOT NULL,
  -- The provider/model profile the owner chose at startup. Recorded because the same prose
  -- researched by a different model is not the same research transformation.
  runtime_profile    TEXT NOT NULL,
  -- The learning mode AS IT WAS when this run started. A RECORD of what was permitted, never a
  -- control: the supervisor reads the live mode each tick and can never write it. Raising the
  -- ceiling stays owner-only, enforced in lib/governance and app/api/learning.
  governance_ceiling TEXT NOT NULL,
  -- BOOTSTRAP | PRE_MARKET | MARKET_OPEN | POST_MARKET | OFF_HOURS | RECOVERY | DEGRADED,
  -- chosen from the exchange calendar and data readiness rather than by a person.
  market_mode        TEXT NOT NULL,
  -- What the supervisor is about to do, in words the owner can read. "Ranking NSE candidates",
  -- not "tick 41".
  next_action        TEXT,
  last_checkpoint    TEXT,
  -- Why it stopped or degraded. A machine that is waiting must be able to say what it waits for.
  reason             TEXT,
  ticks              INTEGER NOT NULL DEFAULT 0,
  -- Which process owns it, so a foreign or stale server is never mistaken for the live instance.
  host               TEXT NOT NULL,
  pid                INTEGER NOT NULL,
  started_at         INTEGER NOT NULL,
  -- The liveness signal. Older than the stale threshold means the process died without stopping,
  -- and the run is reconciled to CRASHED rather than lingering as a permanent phantom "RUNNING".
  heartbeat_at       INTEGER NOT NULL,
  stopped_at         INTEGER
);

-- IDEMPOTENT START, enforced by the STORAGE LAYER rather than by application logic.
--
-- Two clicks a few milliseconds apart both read "no live run" and both insert, which is the classic
-- check-then-act race; the second supervisor then runs every scanner, ingestion and research job a
-- second time. A partial unique index makes the second insert fail outright, so the race cannot be
-- lost in the first place. The file lease in lib/learning/lease.ts covers the other case — a second
-- OS process pointed at the same database.
CREATE UNIQUE INDEX IF NOT EXISTS autonomous_runs_single_live
  ON autonomous_runs (status)
  WHERE status IN ('STARTING', 'RUNNING', 'DEGRADED');

CREATE INDEX IF NOT EXISTS autonomous_runs_started_idx ON autonomous_runs (started_at);
