# Runtime identity + control audit (Task 2)

Updated 2026-08-11. Read this first on resume.

## Why this exists

The owner's report is "most of the buttons don't work". The previous session proved that claim
cannot be answered by grepping — a grep-derived list of "9 dead buttons" was checked and was
mostly wrong. Only clicking answers it.

But clicking only answers it if you know **which server you clicked**. Task 1 lost time to a stale
`next start` holding the port and serving an old bundle, so a fixed defect looked unfixed. Every
conclusion the control audit is about to produce is invalid if the server under test is not the
build under test. So identity attestation comes first — not as polish, as the precondition that
makes the audit's evidence mean anything.

## Order (owner-confirmed priority)

| # | Work | Priority | State |
|---|---|---|---|
| 1 | `/api/system/identity` + Playwright attestation | P0 | **DONE — VERIFIED** (07-final.md) |
| 2 | Control inventory across the 15 routes | P0 | not started |
| 3 | Fix broken controls by root cause | P0 | not started |
| 4 | Resolve `CapitalProfile` ₹1,000 vs ₹1,00,00,000 | P0 | not started |
| 5 | Two-real-process singleton test (Task 1 closure) | P1 | not started |
| 6 | Migrate remaining raw mutations to `mutationFetch` | P1 | **done** (see below) |

## Done this session

- **A build-breaking duplicate import** was sitting uncommitted in
  `components/strategy/RunGauntletButton.tsx` — `mutationFetch` imported twice. Removed.
- **The last two raw mutating fetches migrated** (`RunCycleButton`, `AutonomyTicker`). Both already
  carried the CSRF header, so neither was broken; they were migrated because they were the last two,
  which makes the invariant *checkable by a test* instead of by hand. That test is the actual
  deliverable — see 04-program-design.md.

- **The working tree did not compile.** Six `tsc` errors across four components, including
  `import { reaction } from "react"`. All repaired; `tsc` clean.

## Found while verifying — now the top P0

`POST /api/research/hypotheses` costs **17–22s per call, measured, with no warm-up**, because
`lib/research/hypothesis-author.ts:155` builds the spaCy resolver in a **default parameter**, which
re-evaluates every call. The "interpret my idea" control looks dead for twenty seconds on every
click. Recorded in FINDINGS.md and WORK_QUEUE.md; engine lane, needs its own gates.

## Next executable action

Item 2 — the 15-route control inventory. It can now start, because its answers can name the server
that produced them. Start at `/brain`, then follow the Golden Journey route order.

Run the suite with the gate armed:

```bash
LAUNCH=$(date -u +%Y-%m-%dT%H:%M:%SZ)   # before starting the server
MARKETPULSE_E2E_EXPECT_STARTED_AFTER=$LAUNCH npx playwright test --project=desktop-chromium
```
