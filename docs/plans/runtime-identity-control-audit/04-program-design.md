# Gate 3 — Program design

## Files

| File | Change | Why |
|---|---|---|
| `lib/system/identity.ts` | new | `systemIdentity()` — the whole thing, pure enough to unit test without a server |
| `lib/system/identity.test.ts` | new | fingerprint stability/uniqueness + path non-disclosure |
| `app/api/system/identity/route.ts` | new | thin `GET` wrapper, `force-dynamic` |
| `next.config.ts` | modify | pin `generateBuildId` + inline `MARKETPULSE_BUILD_ID` |
| `e2e/identity.setup.ts` | new | globalSetup: attest before any test runs |
| `playwright.config.ts` | modify | register `globalSetup` |
| `lib/client/mutation-fetch.test.ts` | modify | add the no-raw-mutation invariant |

## Types

```ts
export type SystemIdentity = {
  buildId: string | null;          // git commit at build time; null when unavailable
  runtimeMode: "development" | "production";
  testMode: boolean;               // MARKETPULSE_TEST_MODE === "1"
  appVersion: string;              // package.json
  processId: number;
  serverStartedAt: string;         // ISO, derived from process.uptime()
  schemaVersion: string | null;    // newest applied migration filename
  schemaCount: number;             // how many applied
  databaseFingerprint: string | null;  // 16 hex chars; never the path
};
```

## Call flow

```
GET /api/system/identity
  └─ systemIdentity()
       ├─ process.pid, process.uptime()  → serverStartedAt
       ├─ process.env.MARKETPULSE_BUILD_ID → buildId
       └─ getDb() → schema_migrations
            ├─ MAX(version)  → schemaVersion
            ├─ COUNT(*)      → schemaCount
            └─ MIN(applied_at) + databasePath() → sha256 → databaseFingerprint
```

## Error model

Nothing throws. A missing `schema_migrations` yields nulls, because an unmigrated database is a
state the gate exists to detect, not an exception to hide. The route returns 200 with honest nulls
rather than a 500 that the gate would report as "server unreachable".

## Test design — and the failure mode each test detects

| Test | Detects |
|---|---|
| fingerprint is stable across two calls on one database | a fingerprint that folds in mutable content, making attestation useless |
| two databases at different paths ⇒ different fingerprints | a fingerprint that ignores its path |
| a database deleted and recreated at the **same path** ⇒ different fingerprint | the fresh-DB-attests-as-seeded trap; this is the reason `earliestAppliedAt` is in the hash at all |
| the response contains no substring of the absolute database path | path disclosure to the browser |
| unmigrated database ⇒ nulls, no throw | a 500 that the gate would misreport as an unreachable server |
| **no component mutates via bare `fetch`** | the `AutonomousControl` dead-button class returning through a new control |

That last one is the durable deliverable. It reads `components/**/*.tsx` and fails when a
`method: "POST|PUT|PATCH|DELETE"` call site is not routed through `mutationFetch`. It replaces
hand-auditing a class of defect with a check that runs on every commit.

## Playwright journey

`e2e/identity.setup.ts` runs as `globalSetup`, before any project:

1. `GET {baseURL}/api/system/identity`.
2. Not 200, or route missing → abort naming *the wrong build lacks the endpoint*, not "fetch
   failed".
3. Compare against `MARKETPULSE_E2E_EXPECT_{COMMIT,DB_FINGERPRINT,SCHEMA}` when set.
4. On mismatch, throw with expected and actual side by side.
5. Always print the attested identity, so every run's log records what it tested.

Expectations are **assert-if-provided**: unset variables are not checked. Absent an expectation
there is nothing to compare against, and inventing one would be a fabricated assertion. What is
never optional is step 2 — the endpoint must answer, or the suite does not start.

## Least-confident decisions

1. **`process.uptime()` for server start.** Correct for the process, but Next dev restarts workers
   on recompile; the reported start may be a worker's, not the original. Acceptable — the question
   the gate asks is "is this the process I expect", and a pid comparison carries that.
2. **Unauthenticated endpoint.** Judged safe (see 03), but it is the decision most likely to be
   revisited if the app is ever exposed beyond loopback.
3. **`MIN(applied_at)` as creation time.** True unless a database is ever rebuilt by replaying
   migrations into a copy, which nothing currently does.

## Rollback

Delete `lib/system/identity.*`, `app/api/system/identity/`, `e2e/identity.setup.ts`; revert the two
config edits. No schema change, no data migration, nothing persisted.
