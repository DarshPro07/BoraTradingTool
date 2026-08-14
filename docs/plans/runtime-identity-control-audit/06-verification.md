# Gate 5 — Verification

Measured, not asserted. Every number here came from a command run in this session.

## Environment

Production build (`next build`, exit 0) into an isolated `distDir`, served by `next start` on
**127.0.0.1:3101**, isolated database `.tmp/identity-check.sqlite`, `MARKETPULSE_TEST_MODE=1`,
quant core off. The owner's own servers were not touched.

## The endpoint answers, in production, with real values

```
GET http://127.0.0.1:3101/api/system/identity

{"buildId":"c3a814f-dirty.9dec73f5","runtimeMode":"production","testMode":true,
 "appVersion":"0.1.0","processId":31912,"serverStartedAt":"2026-08-11T08:31:43.742Z",
 "schemaVersion":"0017_autonomous_runs_single_live.sql","schemaCount":18,
 "databaseFingerprint":"ac4f9641ead604ec"}
```

Two design questions were open until this response existed, and both are now settled by
observation rather than by reading documentation:

1. **Next's `env` config does reach a server route handler.** `buildId` came through inlined.
2. **The dirty-tree suffix works and matters.** The build ran against commit `c3a814f` with
   uncommitted changes and reported `c3a814f-dirty.9dec73f5`. Commit-only pinning would have called
   this build identical to the previous one, which is precisely the situation the gate exists for.

No absolute path appears anywhere in the response.

## The gate, proven in all three states

| State | Command | Result |
|---|---|---|
| Correct expectations | `EXPECT_COMMIT` + `EXPECT_DB_FINGERPRINT` matching | **1 passed**, identity printed to the run log |
| Wrong database | `EXPECT_DB_FINGERPRINT=0000000000000000` | **1 failed**, and **`150 did not run`** |
| Foreign server | pointed at a throwaway 404 server on :3102 | **1 failed** with the named diagnosis, not a connection error |

The middle row is the one that matters. The gate does not merely report a mismatch — it **prevents
150 tests from producing results** against a server that is not the one under test. A suite that
carried on would emit 150 green ticks describing something nobody meant to test.

The third row's message reads:

> `http://127.0.0.1:3102 has no /api/system/identity.` … *This is not a missing route — it is an
> OLDER BUILD than the one under test, or another application holding the port.*

That is the diagnosis the previous session had to reach by hand, by checking a PID.

## The gate caught the exact defect it was built for — on me, mid-session

While verifying, the server was "restarted" with `SYNTAX_PARSER_PYTHON` set. The identity endpoint
answered with `processId: 31912` and the same `serverStartedAt` as before the restart.

The old process had never died. It still held :3101, the newly launched one exited with EADDRINUSE,
and a **nine-minute e2e suite had already run to completion against the old configuration**.
`netstat -ano` confirmed 31912 was still LISTENING; killing it explicitly was required.

This is the second observation of this failure — the first cost the previous session an afternoon —
and it exposes a real limitation in the gate as first designed: build, schema and database were all
identical between the two servers. Only the *environment* differed, and no fingerprint can see that.

So the gate gained `MARKETPULSE_E2E_EXPECT_STARTED_AFTER`: assert the server started at or after the
instant the runner launched it. A survivor from a previous run then cannot pass as the new one,
whatever its configuration.

Proven both ways against a genuinely fresh server (pid 12688):

```
ok  1 [identity] › the server under test is the build under test        # floor satisfied

Error: Stale server.
  pid 12688 started 2026-08-11T08:58:48.212Z
  but this run expected a server started at or after 2026-08-11T23:00:00Z.
A process from an earlier run is still holding this port; the one you just launched almost
certainly died of EADDRINUSE. Kill pid 12688 and start again.
```

**A second thing was proven incidentally.** The database was deleted and recreated at the same path
between the two servers, and the fingerprint moved from `ac4f9641ead604ec` to `c9df4d2379c3efef`.
The recreation-detection designed in Gate 2 works against a real server, not only in its unit test.

## The mutation invariant, proven by failing first

`RunCycleButton` was reverted to its raw-`fetch` form and the suite was run:

```
AssertionError: expected [ Array(1) ] to deeply equal []
+   "components/learning/RunCycleButton.tsx:24",
 Tests  1 failed | 6 passed (7)
```

The fix was restored and it passed. The detector is also unit-tested against an inline offending
sample and an inline clean sample, so its behaviour does not depend on the repository's current
contents, and it asserts it scanned more than 20 files so it cannot pass by reading nothing.

## Regression

- `npx tsc --noEmit` — **clean** (it was **six errors across four files** before the repair).
- Full unit suite (`vitest run --exclude mcp/**`) — **127 files, 1563 passed, 2 skipped, 0 failed**.
- Verified by JSON reporter that `lib/system/identity.test.ts` is genuinely included in that run
  (`identity present: true`), rather than trusting the summary line.

**One discrepancy, recorded rather than reconciled:** the Task 1 doc records `127 files, 1558
passed`, and this run is also 127 files despite a test file having been added. The two figures are
therefore not directly comparable — most likely a different invocation was used for the earlier
number. What is measured today: 127 files, 0 failed, new tests confirmed present.

## Not verified

- **The control inventory.** Nothing in this gate says whether any button works. It says that when
  the audit starts, its answers will describe a known server. That was the entire point of doing it
  first, and it is not a substitute for the audit.
- **`CapitalProfile`.** Untouched. The runtime still reports `DEGRADED` for the ₹1,000-vs-₹1-crore
  mismatch, honestly.
- **Cross-process singleton.** Untouched.
- **Mobile.** The `mobile-chromium` project has the dependency wired but was not run in this pass.
