CREATE TABLE IF NOT EXISTS evidence_snapshots (
  snapshot_hash TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_snapshots_instrument
  ON evidence_snapshots(instrument_id, generated_at DESC);
