-- The AgentRun ledger (mission §28 / WORK_QUEUE "AgentRun work ledger").
--
-- Every call MarketPulse makes to a model lands here, whether it succeeded, was refused, or
-- failed — a ledger that only records successes cannot answer "why did research stop last
-- night", which is the question it exists to answer. The envelope is stored as the run's result
-- artifact rather than in its own table: an envelope has no meaning apart from the run that
-- produced it, and one row keeps provenance and result impossible to separate.
--
-- No UNIQUE on instrument: researching the same stock twice is two runs, and the evidence
-- fingerprint is what distinguishes them.

CREATE TABLE IF NOT EXISTS agent_runs (
  id                   TEXT PRIMARY KEY,
  capability           TEXT NOT NULL,
  provider             TEXT NOT NULL,
  -- The model that actually served the call, as the run reported it. Never assumed, never a
  -- literal from our source.
  model                TEXT NOT NULL,
  -- COMPLETED | REFUSED | FAILED. A refusal is a legitimate outcome, not an error.
  status               TEXT NOT NULL,
  trigger              TEXT NOT NULL,
  instrument_id        TEXT,
  -- sha256 of the exact evidence packet the producer received.
  evidence_fingerprint TEXT,
  -- MarketPulse's assigned verification, never the producer's claim. NULL when no envelope.
  verification_status  TEXT,
  -- The ResearchProposalEnvelope as produced, stored verbatim. NULL for refusals and failures.
  envelope             TEXT,
  -- Why it was refused or how it failed. NULL when it completed.
  refusal_code         TEXT,
  refusal_message      TEXT,
  tokens               INTEGER,
  cost                 REAL,
  -- Denominated cost is meaningless without this: Claude Code reports USD, an Indian provider
  -- would report INR, and a bare number under a hardcoded symbol is a fabricated conversion.
  cost_currency        TEXT,
  fallback_reason      TEXT,
  started_at           INTEGER NOT NULL,
  completed_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_runs_instrument_idx ON agent_runs (instrument_id, completed_at);
CREATE INDEX IF NOT EXISTS agent_runs_completed_idx  ON agent_runs (completed_at);
