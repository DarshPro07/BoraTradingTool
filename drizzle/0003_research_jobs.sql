-- Durable job queue for the research factory. Survives restarts and runs without Claude.

CREATE TABLE IF NOT EXISTS research_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  priority      INTEGER NOT NULL DEFAULT 100,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  last_error    TEXT,
  result        TEXT,
  dedupe_key    TEXT,
  locked_by     TEXT,
  locked_until  INTEGER,
  available_at  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON research_jobs (status, available_at, priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe ON research_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_job_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES research_jobs(id),
  event      TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON research_job_events (job_id, id);

CREATE TRIGGER IF NOT EXISTS job_events_no_delete
BEFORE DELETE ON research_job_events
BEGIN
  SELECT RAISE(ABORT, 'GOVERNANCE: job history is append-only');
END;
