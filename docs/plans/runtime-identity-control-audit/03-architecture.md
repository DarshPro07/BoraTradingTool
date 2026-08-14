# Gate 2 — Architecture

## Proposed fit

One pure module, one thin route, one Playwright global-setup file. No new subsystem.

```
next.config.ts  ──build-time──▶  process.env.MARKETPULSE_BUILD_ID (inlined)
                                          │
lib/system/identity.ts  ◀─────────────────┘
   ├─ reads schema_migrations  (lib/db)
   ├─ reads databasePath()     (lib/db)  ── hashed, never returned
   └─ derives process start from process.uptime()
                    │
      app/api/system/identity/route.ts   (GET, no auth — see Security)
                    │
      e2e/identity.setup.ts  ── globalSetup, runs before every project
```

## Data flow

`GET /api/system/identity` → `systemIdentity()` → JSON. No writes, no side effects. This is
deliberately unlike `/api/system/status`, which reconciles stale runs as it reads.

## The database fingerprint — the one real design decision

The requirement is contradictory on its face: prove *which database instance* without revealing
*where it is*.

Path alone is wrong: delete the file, let the server recreate it, and a fresh empty database
attests as the seeded one. Content alone is wrong: every write changes it, so a fingerprint taken
before a test differs from one taken after.

Resolution — hash two things that are together stable-per-instance and change on recreation:

```
databaseFingerprint = sha256( resolvedAbsolutePath + "\0" + earliestAppliedAt ).slice(0, 16)
```

`earliestAppliedAt` is `MIN(applied_at)` from `schema_migrations` — the moment this database was
first migrated, which is effectively its creation time. It never changes for the life of the file
and is not affected by any subsequent write.

Properties: stable across server restarts ✓ · differs for a different path ✓ · differs for a
recreated database at the same path ✓ · reveals neither path nor contents ✓.

Rejected alternative: SQLite `application_id`/`user_version` pragmas. They are settable and
currently unset, so they would need a migration to become meaningful — more moving parts for the
same answer.

## Build identity

`next.config.ts` computes the git commit once at config load and exposes it two ways:

- `generateBuildId` → the deployment's own build id becomes the commit, so Next's notion of the
  build and ours cannot drift apart.
- `env.MARKETPULSE_BUILD_ID` → Next inlines this at build time, so the running server can report it
  without reading `.git` at runtime (which would be wrong in a deployed artifact anyway).

In dev there is no build, so this reports the commit at the time the dev server started plus a
`runtimeMode: "development"`. That is honest: dev serves from a live compile, and a commit is the
most identity that exists.

## Failure paths

- No `schema_migrations` table (database not yet migrated) → `schemaVersion: null`,
  `databaseFingerprint: null`. **Not a thrown error and not a fabricated value** — the endpoint's
  job is to describe reality, and "unmigrated" is a real state the gate must be able to see.
- Git unavailable at build time → commit is `null`, never a guess. The gate can then only assert
  the fields that exist, and says so.

## Security

The endpoint is unauthenticated, matching `/api/system/status`. What it exposes is deliberately
bounded: a commit hash, a pid, a start time, a migration filename, and a one-way hash. No path, no
credential, no configuration. A pid is already inferable from the process listing on the host, and
the commit is in the repository the owner controls.

`GET` only, so `requireMutationAccess` does not apply.

## Observability

This *is* the observability work. It is what lets every other test say what it was talking to.

## Compatibility

Purely additive: a new route, a new module, a `next.config.ts` addition, a new Playwright setup
file. No existing response shape changes. Rollback is deleting three files and reverting a config
block.

## Architecture risks

- If `generateBuildId` is later needed for cache-busting semantics, pinning it to the commit means
  a rebuild at the same commit reuses the id. Acceptable and arguably correct: same commit, same
  build.
- The gate adds a hard dependency on the endpoint existing. That is the point, but it means an old
  server without the route fails the suite. The failure message must say exactly that rather than
  reading as a network error.
