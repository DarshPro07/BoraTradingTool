-- Knowledge and memory core.
-- Chain: Source -> Claim -> Concept/Equation -> Reproduction -> Hypothesis
--        -> StrategySpec -> Trial -> ValidationResult -> ForwardOutcome -> Lesson
-- Append-only tables are enforced by triggers, not by convention.

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT,
  locator        TEXT,
  content_hash   TEXT NOT NULL,
  license        TEXT,
  authors        TEXT,
  published_at   INTEGER,
  archived_path  TEXT,
  status         TEXT NOT NULL DEFAULT 'discovered',
  rejection_reason TEXT,
  ingested_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_kind ON knowledge_sources (kind, ingested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_hash ON knowledge_sources (content_hash);

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id                TEXT PRIMARY KEY,
  source_id         TEXT NOT NULL REFERENCES knowledge_sources(id),
  statement         TEXT NOT NULL,
  locator           TEXT,
  epistemic_status  TEXT NOT NULL DEFAULT 'inferred',
  confidence        REAL,
  india_relevant    INTEGER,
  verified_at       INTEGER,
  verified_by       TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_source ON knowledge_claims (source_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON knowledge_claims (epistemic_status);

CREATE TABLE IF NOT EXISTS knowledge_concepts (
  id                TEXT PRIMARY KEY,
  plane             TEXT NOT NULL,
  name              TEXT NOT NULL,
  summary           TEXT NOT NULL,
  formal_definition TEXT,
  created_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_concepts_name ON knowledge_concepts (plane, name);

CREATE TABLE IF NOT EXISTS knowledge_concept_edges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_concept_id TEXT NOT NULL REFERENCES knowledge_concepts(id),
  to_concept_id   TEXT NOT NULL REFERENCES knowledge_concepts(id),
  relation        TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
  ON knowledge_concept_edges (from_concept_id, to_concept_id, relation);

CREATE TABLE IF NOT EXISTS knowledge_equations (
  id          TEXT PRIMARY KEY,
  concept_id  TEXT REFERENCES knowledge_concepts(id),
  source_id   TEXT REFERENCES knowledge_sources(id),
  name        TEXT NOT NULL,
  latex       TEXT NOT NULL,
  variables   TEXT,
  assumptions TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_reproductions (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES knowledge_sources(id),
  claim_id     TEXT REFERENCES knowledge_claims(id),
  equation_id  TEXT REFERENCES knowledge_equations(id),
  language     TEXT NOT NULL,
  code_path    TEXT,
  expected     TEXT,
  observed     TEXT,
  tolerance    REAL,
  status       TEXT NOT NULL DEFAULT 'pending',
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  ran_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reproductions_source ON knowledge_reproductions (source_id, status);

CREATE TABLE IF NOT EXISTS knowledge_lessons (
  id         TEXT PRIMARY KEY,
  concept_id TEXT REFERENCES knowledge_concepts(id),
  plane      TEXT NOT NULL,
  level      TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  citations  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_concept ON knowledge_lessons (concept_id, level);

CREATE TABLE IF NOT EXISTS knowledge_quizzes (
  id          TEXT PRIMARY KEY,
  concept_id  TEXT NOT NULL REFERENCES knowledge_concepts(id),
  question    TEXT NOT NULL,
  options     TEXT,
  answer      TEXT NOT NULL,
  explanation TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_mastery (
  concept_id       TEXT PRIMARY KEY REFERENCES knowledge_concepts(id),
  attempts         INTEGER NOT NULL DEFAULT 0,
  correct          INTEGER NOT NULL DEFAULT 0,
  score            REAL NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  next_review_at   INTEGER
);

CREATE TABLE IF NOT EXISTS knowledge_contradictions (
  id          TEXT PRIMARY KEY,
  claim_a_id  TEXT NOT NULL REFERENCES knowledge_claims(id),
  claim_b_id  TEXT NOT NULL REFERENCES knowledge_claims(id),
  description TEXT NOT NULL,
  resolution  TEXT,
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_hypotheses (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT REFERENCES knowledge_claims(id),
  title        TEXT NOT NULL,
  statement    TEXT NOT NULL,
  rationale    TEXT,
  market       TEXT,
  status       TEXT NOT NULL DEFAULT 'proposed',
  duplicate_of TEXT,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON research_hypotheses (status, created_at);

CREATE TABLE IF NOT EXISTS strategy_specs (
  id            TEXT PRIMARY KEY,
  hypothesis_id TEXT REFERENCES research_hypotheses(id),
  parent_id     TEXT,
  name          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  dsl           TEXT NOT NULL,
  dsl_hash      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_specs_name_version ON strategy_specs (name, version);
CREATE INDEX IF NOT EXISTS idx_specs_status ON strategy_specs (status);

CREATE TABLE IF NOT EXISTS trials (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_spec_id    TEXT NOT NULL REFERENCES strategy_specs(id),
  kind                TEXT NOT NULL,
  verdict             TEXT NOT NULL,
  reason              TEXT,
  metrics             TEXT,
  dataset_fingerprint TEXT,
  actor               TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  completed_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trials_spec ON trials (strategy_spec_id, kind);

CREATE TABLE IF NOT EXISTS validation_results (
  id                TEXT PRIMARY KEY,
  strategy_spec_id  TEXT NOT NULL REFERENCES strategy_specs(id),
  oos_profit_factor REAL,
  pbo               REAL,
  deflated_sharpe   REAL,
  cost_multiple_pf  REAL,
  trials_counted    INTEGER NOT NULL DEFAULT 0,
  passed            INTEGER NOT NULL DEFAULT 0,
  detail            TEXT,
  evaluated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_validation_spec ON validation_results (strategy_spec_id);

CREATE TABLE IF NOT EXISTS forward_outcomes (
  id               TEXT PRIMARY KEY,
  strategy_spec_id TEXT,
  instrument_id    TEXT NOT NULL,
  opened_at        INTEGER NOT NULL,
  resolved_at      INTEGER,
  outcome          TEXT NOT NULL DEFAULT 'open',
  r_multiple       REAL,
  source           TEXT NOT NULL,
  external_id      TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forward_strategy ON forward_outcomes (strategy_spec_id, outcome);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_external ON forward_outcomes (source, external_id);

CREATE TABLE IF NOT EXISTS failure_memory (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT NOT NULL,
  subject_id   TEXT,
  failure_mode TEXT NOT NULL,
  detail       TEXT NOT NULL,
  lesson       TEXT,
  recorded_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_failure_scope ON failure_memory (scope, failure_mode);

-- The locked holdout may be queried a fixed number of times per strategy, ever.
CREATE TABLE IF NOT EXISTS holdout_ledger (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  holdout_id       TEXT NOT NULL,
  strategy_spec_id TEXT NOT NULL,
  actor            TEXT NOT NULL,
  result_hash      TEXT,
  queried_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holdout_spec ON holdout_ledger (holdout_id, strategy_spec_id);

CREATE TABLE IF NOT EXISTS evolution_proposals (
  id           TEXT PRIMARY KEY,
  origin       TEXT NOT NULL,
  action_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  rationale    TEXT NOT NULL,
  diff_path    TEXT,
  branch       TEXT,
  worktree     TEXT,
  evidence     TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  reviewer     TEXT,
  review_notes TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON evolution_proposals (status, updated_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  decision      TEXT NOT NULL,
  denial_code   TEXT,
  subject       TEXT,
  detail        TEXT,
  learning_mode TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_events (decision, action);

CREATE TABLE IF NOT EXISTS learning_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  mode       TEXT NOT NULL DEFAULT 'off',
  updated_by TEXT NOT NULL DEFAULT 'owner',
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO learning_state (id, mode, updated_by, updated_at) VALUES (1, 'off', 'owner', 0);

-- Append-only enforcement. The governance policy forbids deleting trials, editing a
-- recorded verdict, and rewriting audit history. These triggers make that impossible
-- rather than merely prohibited.

CREATE TRIGGER IF NOT EXISTS trials_no_delete
BEFORE DELETE ON trials
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: trials are append-only (delete_trial_record is prohibited)');
END;

CREATE TRIGGER IF NOT EXISTS trials_verdict_immutable
BEFORE UPDATE OF verdict ON trials
WHEN OLD.verdict <> NEW.verdict
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: a recorded trial verdict is immutable (mark_failed_strategy_profitable is prohibited)');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS holdout_no_delete
BEFORE DELETE ON holdout_ledger
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: holdout queries are append-only (requery_locked_holdout accounting)');
END;

CREATE TRIGGER IF NOT EXISTS forward_outcome_immutable
BEFORE UPDATE OF outcome ON forward_outcomes
WHEN OLD.outcome <> 'open' AND OLD.outcome <> NEW.outcome
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: a resolved forward outcome cannot be rewritten');
END;
