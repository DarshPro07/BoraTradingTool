-- Job dependencies: let one job wait for another to finish before it becomes claimable.
--
-- This is the missing operating-system behavior: a ResearchJob that needs data must wait for a
-- DataJob to finish, rather than failing and retrying blindly. The dependency lives in its own
-- table so a job can have multiple blocking predecessors (e.g., research needs both daily AND
-- intraday data).
--
-- The worker that claims a job does NOT need to know about dependencies. The claim query simply
-- never returns a job whose dependencies are not yet satisfied. This keeps the dependency logic
-- in one place rather than scattered across every worker.

CREATE TABLE IF NOT EXISTS job_dependencies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES research_jobs(id),
  depends_on_id   INTEGER NOT NULL REFERENCES research_jobs(id),
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_deps_job ON job_dependencies (job_id);
CREATE INDEX IF NOT EXISTS idx_job_deps_depends_on ON job_dependencies (depends_on_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_deps_unique ON job_dependencies (job_id, depends_on_id);

-- A trigger preventing a job from depending on itself — a self-dependency would never unblock.
CREATE TRIGGER IF NOT EXISTS job_deps_no_self
BEFORE INSERT ON job_dependencies
WHEN NEW.job_id = NEW.depends_on_id
BEGIN
  SELECT RAISE(ABORT, 'A job cannot depend on itself');
END;
