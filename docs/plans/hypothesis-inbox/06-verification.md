# Gate 5 — Verification (executed 2026-08-09 evening)

- `e2e/hypothesis-inbox.spec.ts`: **passed on both desktop and mobile projects** in the full
  clean-server run (79 passed, 0 failed). The test posts a genuinely underivable hypothesis
  (market cap + news sentiment), asserts the API's real contract (201, `verdict:
  NEEDS_FEATURE`, `authored: null`), sees the row flagged HELD in the inbox, and sees it
  survive a refresh.
- First draft of the test asserted status 200 and FAILED against the running server — the
  route records refusals with 201. The assertion was corrected to reality; the failure is
  recorded in `01-reality.md`. (The test found a wrong assumption, which is what tests are for.)
- Typecheck + production build clean; unit suite 1309/0 after all changes.

Limitation: the composer does not auto-refresh the inbox after a submission — the refresh
control is the documented path (zero-plumbing trade-off, `03-architecture.md`).
