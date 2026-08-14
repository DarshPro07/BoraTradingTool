# Gate 1 — Product

## User problem

The owner cannot trust what a test run tells him, and cannot trust what the UI tells him.

Two distinct failures produce the same feeling of "this thing lies to me":

1. A test passes or fails against a server nobody is sure of. A stale process holding the port
   serves an old bundle; a fixed defect still looks broken, or a broken one looks fixed.
2. A button looks enabled, is clicked, and nothing durable happens. The UI shows success while the
   ledger is unchanged, or shows the *previous* object as if it were the new one.

## User

The owner, operating MarketPulse directly, and every future agent session that inherits a claim of
"verified" from a previous one.

## Current behaviour

- `/api/system/status` answers "what is the machine doing" and is silent on "what machine is this".
- Playwright asserts product behaviour immediately, with no preceding assertion about the server.
- The external-server path (`MARKETPULSE_E2E_BASE_URL`) skips Playwright's own
  `reuseExistingServer: false` protection entirely, because the whole `webServer` block is omitted.

## Desired outcome

Before any browser test touches a page, the run states — and fails on — the exact build, process,
schema version and database instance it is talking to. A mismatch is a loud, immediate failure with
both sides printed, not a subtle wrong answer 40 tests later.

## Success evidence

- `GET /api/system/identity` returns build, commit, pid, uptime-derived start, schema version and a
  database fingerprint.
- The Playwright suite refuses to run when the identity does not match what was asked for, and the
  refusal names what differed.
- **The gate is proven by making it fail**: point the suite at a server with a different database
  and watch it abort before test one. A gate never seen to fail is not evidence.

## Failure conditions — this feature is still wrong if

- The absolute database path is exposed to the browser. Identity must be provable without leaking
  filesystem layout.
- The fingerprint changes across restarts of the same server against the same database — that makes
  it useless for attestation.
- The fingerprint is *identical* for two databases that merely share a path but were recreated —
  that is the "fresh DB looks like the seeded one" trap.
- The gate is skippable by default, or silently degrades to a warning when the endpoint is absent.

## User journeys

1. Owner restarts the server, opens `/brain`, and can see which build is running.
2. An agent runs the e2e suite and gets an immediate, named failure when it points at the wrong
   server.
3. An agent adds a new mutating control and gets a failing test if it hand-rolls `fetch`.

## Non-goals

- The model/runtime-profile selection popup. Separate, queued item.
- Rendering identity anywhere in the UI beyond what already exists. The endpoint and the test gate
  are the deliverable; a `/brain` tile can follow.
- Fixing any control found broken by the audit — that is item 3, downstream of this.
