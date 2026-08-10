-- Start safe local research autonomy on a fresh installation.
--
-- Only the untouched bootstrap row is changed. Any owner choice writes a real timestamp through
-- setLearningMode(), so an explicit OFF state remains OFF across upgrades and restarts.

UPDATE learning_state
SET mode = 'learning',
    updated_by = 'startup-default',
    updated_at = unixepoch()
WHERE id = 1
  AND mode = 'off'
  AND updated_at = 0;

INSERT INTO audit_events
  (actor, action, decision, subject, detail, learning_mode, created_at)
SELECT
  'startup-default',
  'set_learning_mode',
  'allowed',
  'learning',
  'Fresh-install default: safe research autonomy starts automatically; financial mutation remains prohibited.',
  'learning',
  unixepoch()
WHERE changes() > 0;
