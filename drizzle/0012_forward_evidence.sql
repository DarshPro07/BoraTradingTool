-- Forward evidence (mission workstream 1, owner directive 2026-08-09 22:51).
--
-- The invariant everything here serves: a forward signal is persisted BEFORE its future outcome
-- exists, and neither the signal nor a resolved outcome can ever be edited. Immutability is
-- enforced by triggers, not by application discipline — the person re-resolving always has a
-- reason.
--
-- SHADOW stage only. The paper-stage record (forward_outcomes, fed by the trade board) is a
-- separate, pre-existing ledger and deliberately stays separate.

CREATE TABLE IF NOT EXISTS forward_challengers (
  id                       TEXT PRIMARY KEY,
  strategy_spec_id         TEXT NOT NULL REFERENCES strategy_specs(id),
  strategy_family_id       TEXT NOT NULL,
  research_campaign_id     TEXT NOT NULL,
  activated_at             INTEGER NOT NULL,
  code_fingerprint         TEXT NOT NULL,
  engine_version           TEXT NOT NULL,
  execution_profile_id     TEXT,
  fee_model_id             TEXT NOT NULL,
  market                   TEXT NOT NULL,
  resolution               TEXT NOT NULL,
  universe                 TEXT NOT NULL,
  dsl_hash                 TEXT NOT NULL,
  promotion_experiment_id  TEXT REFERENCES experiments(id),
  promotion_snapshot_id    TEXT REFERENCES dataset_snapshots(id),
  forward_policy           TEXT NOT NULL,
  forward_policy_version   TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  retired_at               INTEGER,
  retired_reason           TEXT,
  -- The evaluation watermark: the only mutable operational field besides retirement. Bars at or
  -- before this time are settled history for this challenger and can never mint a signal.
  last_evaluated_time      INTEGER NOT NULL DEFAULT 0,
  created_by               TEXT NOT NULL
);

-- One live challenger per strategy version. A logic change is a new spec version and therefore a
-- new challenger with a fresh forward clock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_challenger_spec
  ON forward_challengers (strategy_spec_id);

-- Frozen at activation: every identity field is immutable; only status/retirement/watermark move.
CREATE TRIGGER IF NOT EXISTS forward_challengers_frozen
BEFORE UPDATE ON forward_challengers
WHEN OLD.strategy_spec_id IS NOT NEW.strategy_spec_id
  OR OLD.strategy_family_id IS NOT NEW.strategy_family_id
  OR OLD.research_campaign_id IS NOT NEW.research_campaign_id
  OR OLD.activated_at IS NOT NEW.activated_at
  OR OLD.code_fingerprint IS NOT NEW.code_fingerprint
  OR OLD.engine_version IS NOT NEW.engine_version
  OR OLD.execution_profile_id IS NOT NEW.execution_profile_id
  OR OLD.fee_model_id IS NOT NEW.fee_model_id
  OR OLD.market IS NOT NEW.market
  OR OLD.resolution IS NOT NEW.resolution
  OR OLD.universe IS NOT NEW.universe
  OR OLD.dsl_hash IS NOT NEW.dsl_hash
  OR OLD.promotion_experiment_id IS NOT NEW.promotion_experiment_id
  OR OLD.promotion_snapshot_id IS NOT NEW.promotion_snapshot_id
  OR OLD.forward_policy IS NOT NEW.forward_policy
  OR OLD.forward_policy_version IS NOT NEW.forward_policy_version
BEGIN
  SELECT RAISE(ABORT, 'forward_challengers identity is frozen at activation; changes require a new strategy version and a new challenger');
END;

CREATE TRIGGER IF NOT EXISTS forward_challengers_no_delete
BEFORE DELETE ON forward_challengers
BEGIN
  SELECT RAISE(ABORT, 'forward_challengers is append-only; retire a challenger, never erase it');
END;

CREATE TABLE IF NOT EXISTS forward_signals (
  id                    TEXT PRIMARY KEY,
  challenger_id         TEXT NOT NULL REFERENCES forward_challengers(id),
  instrument_id         TEXT NOT NULL,
  -- When the triggering bar CLOSED in market time.
  event_time            INTEGER NOT NULL,
  -- When this row was written. observed_at >= event_time always; the gap is the honesty margin.
  observed_at           INTEGER NOT NULL,
  clause_evidence       TEXT NOT NULL,
  feature_values        TEXT NOT NULL,
  entry_price           REAL NOT NULL,
  stop_price            REAL,
  target_price          REAL,
  horizon_bars          INTEGER NOT NULL,
  execution_profile_id  TEXT,
  cost_model_id         TEXT NOT NULL,
  data_quality          TEXT NOT NULL,
  fingerprint           TEXT NOT NULL,
  -- One market event, one signal, forever.
  UNIQUE (challenger_id, instrument_id, event_time)
);

CREATE TRIGGER IF NOT EXISTS forward_signals_no_update
BEFORE UPDATE ON forward_signals
BEGIN
  SELECT RAISE(ABORT, 'forward_signals is immutable; a prediction cannot be edited after it is made');
END;

CREATE TRIGGER IF NOT EXISTS forward_signals_no_delete
BEFORE DELETE ON forward_signals
BEGIN
  SELECT RAISE(ABORT, 'forward_signals is append-only; a prediction cannot be unmade');
END;

CREATE TABLE IF NOT EXISTS forward_signal_outcomes (
  -- PRIMARY KEY doubles as the idempotency guarantee: one outcome per signal, by construction.
  signal_id             TEXT PRIMARY KEY REFERENCES forward_signals(id),
  resolved_at           INTEGER NOT NULL,
  entry_fill            REAL NOT NULL,
  exit_price            REAL NOT NULL,
  exit_time             INTEGER NOT NULL,
  exit_reason           TEXT NOT NULL,
  mfe                   REAL,
  mae                   REAL,
  gross_return          REAL NOT NULL,
  cost_return           REAL,
  net_return            REAL,
  economics_unavailable TEXT,
  benchmark_return      REAL,
  fingerprint           TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS forward_signal_outcomes_no_update
BEFORE UPDATE ON forward_signal_outcomes
BEGIN
  SELECT RAISE(ABORT, 'forward_signal_outcomes is immutable; re-resolving is how a forward record gets laundered');
END;

CREATE TRIGGER IF NOT EXISTS forward_signal_outcomes_no_delete
BEFORE DELETE ON forward_signal_outcomes
BEGIN
  SELECT RAISE(ABORT, 'forward_signal_outcomes is append-only');
END;
