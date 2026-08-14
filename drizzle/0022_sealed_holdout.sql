-- Sealed holdout apparatus (owner architecture, 2026-08-14).
--
-- The access-control half already exists (holdout_access + requestHoldoutAccess: family and
-- campaign gates; legacy holdout_ledger for the per-spec audit trail). What was missing is the
-- THING BEING PROTECTED: a definition that pins an immutable window of the canonical store, a
-- seal whose state separates existence from permission, and a result record rich enough for
-- memory to learn from. Additive only — nothing existing is altered.
--
--   holdout_definitions — one row per sealed window. The window, the purge/embargo chronology,
--                         the sealed-window dataset snapshot + fingerprint, and the DECISION
--                         RULE are all pinned AT SEAL TIME (copies, not references), so a later
--                         change to gates or data cannot silently move a sealed bar.
--   holdout_results     — the evaluation's full economics (gross/fees/net, degradation vs the
--                         qualifying validation), the verdict, and coded reasons. UNIQUE per
--                         (holdout, family): the ledger itself refuses a second look.

CREATE TABLE IF NOT EXISTS holdout_definitions (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  market TEXT NOT NULL,
  resolution TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  purge_gap_seconds INTEGER NOT NULL,
  embargo_seconds INTEGER NOT NULL,
  dataset_snapshot_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  bar_count INTEGER NOT NULL,
  decision_rule TEXT NOT NULL,
  state TEXT NOT NULL,
  state_reason TEXT,
  sealed_at INTEGER NOT NULL,
  sealed_by TEXT NOT NULL,
  authorized_at INTEGER,
  authorized_by TEXT,
  consumed_at INTEGER,
  invalidated_at INTEGER
);

-- Generations are the re-seal story: one look per generation per campaign (holdout_access
-- enforces that), so the NEXT look requires sealing a NEW, later window — generation N+1.
CREATE UNIQUE INDEX IF NOT EXISTS holdout_definitions_generation
  ON holdout_definitions(market, resolution, generation);

-- One live seal per universe: two active windows would make "the sealed region" ambiguous for
-- the development-exclusion rule. Partial, so consumed/invalidated history accumulates freely.
CREATE UNIQUE INDEX IF NOT EXISTS holdout_definitions_one_active
  ON holdout_definitions(market, resolution)
  WHERE state IN ('SEALED', 'AUTHORIZED_FOR_EVALUATION');

CREATE TABLE IF NOT EXISTS holdout_results (
  id TEXT PRIMARY KEY,
  holdout_id TEXT NOT NULL,
  strategy_spec_id TEXT NOT NULL,
  strategy_family_id TEXT NOT NULL,
  dataset_snapshot_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  trade_count INTEGER NOT NULL,
  net_profit_factor REAL,
  gross_pnl REAL,
  fees REAL,
  net_pnl REAL,
  win_rate REAL,
  max_drawdown REAL,
  validation_oos_pf REAL,
  degradation_ratio REAL,
  passed INTEGER NOT NULL,
  reason_codes TEXT NOT NULL,
  detail TEXT,
  evaluated_at INTEGER NOT NULL,
  evaluated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS holdout_results_once
  ON holdout_results(holdout_id, strategy_family_id);
