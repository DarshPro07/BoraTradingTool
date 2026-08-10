-- Dataset snapshots and the experiment trade ledger.
--
-- The defect this repairs: the same research question answered from different datasets. The store
-- held 30,832 bars and a replay over them produced 73 trades; the API path consulted the
-- provider's sliding window instead and produced 0. Two answers, one strategy, no error anywhere.
--
-- The contract installed here:
--   provider -> ingestion -> canonical store -> DATASET SNAPSHOT -> experiment -> TRADE LEDGER
--
-- Research reads snapshots built from the canonical store, never the live window. A completed
-- experiment is evidence: reopening it reads its ledger, and no later provider change, store
-- repair or code path can silently alter what it said. Missing data refuses; it does not fetch.

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id                    TEXT PRIMARY KEY,
  market                TEXT NOT NULL,
  resolution            TEXT NOT NULL,
  -- JSON array of instrument ids actually included (with bars), in sorted order.
  instruments           TEXT NOT NULL,
  first_time            INTEGER NOT NULL,
  last_time             INTEGER NOT NULL,
  bar_count             INTEGER NOT NULL,
  -- SHA-256 over every bar in deterministic order. One changed bar = a different snapshot.
  fingerprint           TEXT NOT NULL,
  -- Where the bars came from before the store: accumulator, import script, repair. Descriptive.
  source_lineage        TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  created_by            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_universe
  ON dataset_snapshots (market, resolution, fingerprint);

CREATE TABLE IF NOT EXISTS experiments (
  id                   TEXT PRIMARY KEY,
  strategy_spec_id     TEXT NOT NULL REFERENCES strategy_specs(id),
  dataset_snapshot_id  TEXT NOT NULL REFERENCES dataset_snapshots(id),
  kind                 TEXT NOT NULL,            -- 'inspection' today; rehearsal/gauntlet migrate here next
  engine_version       TEXT NOT NULL,            -- COMPILER_VERSION at run time
  execution_profile_id TEXT,                     -- broker assumptions the run used
  trade_count          INTEGER NOT NULL,
  summary              TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  created_by           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiments_spec ON experiments (strategy_spec_id, created_at);

CREATE TABLE IF NOT EXISTS experiment_trades (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id  TEXT NOT NULL REFERENCES experiments(id),
  trade_index    INTEGER NOT NULL,
  -- The full TradeInspection record, JSON. Evidence is stored as produced, not re-derived.
  payload        TEXT NOT NULL,
  UNIQUE (experiment_id, trade_index)
);

-- Evidence is append-only. Deleting a ledger row would let a later run quietly disagree with what
-- an experiment actually produced — the exact dishonesty snapshots exist to prevent.
CREATE TRIGGER IF NOT EXISTS experiment_trades_no_delete
BEFORE DELETE ON experiment_trades
BEGIN
  SELECT RAISE(ABORT, 'experiment_trades is append-only: an experiment''s evidence cannot be unsaid.');
END;

CREATE TRIGGER IF NOT EXISTS experiments_no_delete
BEFORE DELETE ON experiments
BEGIN
  SELECT RAISE(ABORT, 'experiments is append-only.');
END;
