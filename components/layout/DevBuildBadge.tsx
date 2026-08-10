import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/**
 * Development build identity (item 13, owner instruction 2026-08-09).
 *
 * "This looks like the old UI" was a stale :3000 dev process, and diagnosing it cost a debugging
 * session because nothing on screen said which server process was answering. This strip makes the
 * running process identifiable at a glance: when it started, its pid, and the schema generation it
 * migrated to. If the badge's start time predates your last edit, you are looking at a stale
 * server — restart it and the badge will say so.
 *
 * Dev-only by design: production builds identify themselves through deployment, and the badge
 * would be noise there.
 */

// Module-init time in the server process = when this code generation actually started serving.
const SERVER_STARTED_AT = new Date().toISOString();

export function DevBuildBadge() {
  if (process.env.NODE_ENV === "production") return null;

  let schemaVersion = "unmigrated";
  try {
    const row = getDb().get<{ version: string }>(
      sql`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`,
    );
    if (row?.version) schemaVersion = row.version.replace(/\.sql$/, "");
  } catch {
    // A badge must never take the page down; an unreadable schema version is itself a signal.
    schemaVersion = "unreadable";
  }

  return (
    <span className="text-[10px] text-muted-foreground" data-testid="dev-build-identity">
      DEV · started {SERVER_STARTED_AT} · pid {process.pid} · schema {schemaVersion}
    </span>
  );
}
