-- Applied through guarded compatibility logic in lib/db/migrate.ts so partially
-- upgraded SQLite databases do not fail on duplicate ADD COLUMN statements.
SELECT 1;
