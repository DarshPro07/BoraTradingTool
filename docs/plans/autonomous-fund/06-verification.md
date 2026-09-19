# 06 — Independent verification

## Gate 5 review (Opus verifier, fresh context, 2026-09-19)

Verdict **FAIL**, and correctly so. Every finding was fixed, and each fix has a regression test
that **failed against commit `8deb4c9`** and passes now.

| # | Finding | Fix | Regression test (failed on old code) |
|---|---|---|---|
| 1 | The latest missed decision date was decided late (a month-old signal traded on), and T1 counted it as on time | a due date is decided only within `DECISION_FRESH_DAYS` (NSE 5, crypto 2); otherwise it is noted as missed and T1 counts it against the fund | "does not decide a due date long after its outcome exists" |
| 2 | Missing book capital became `capital = 0` forever | `bookCapital` returns null; no sleeve is carved from an unknown amount | "does not carve a sleeve from an unknown book" |
| 3 | A lease caught between `wx` and its write read as expired, giving two holders | an unreadable lease is judged by the file's age: young means held, older than the TTL means garbage | "treats a lease file caught mid-write as HELD" |
| 4 | The heartbeat kept a hung pass's lease forever | renewal stops after `MAX_CYCLE_MS` (45 min) | "stops renewing a run that exceeds the maximum cycle length" |
| 5 | A fill whose ledger write was lost would be bought again | before ordering, `findFilled` recovers engine fills under the decision's key prefix | "recovers a fill the ledger missed instead of buying twice" |
| 6 (claim 4) | The kill's SELL waited for the next pass, and never ran with no bars | order is now decide → mark → kill → execute; a suspended mandate sells even without bars | "kills … goes flat in the SAME pass"; this was reworked until it failed on the old code (the first version passed there for the wrong reason) |

One existing lease test asserted the defect itself ("unreadable = expired immediately"). It was
restated around its real purpose, that a corrupt lease must never wedge autonomy, and still
asserts that.

Claims that held: no look-ahead (`run.ts` uses bars up to the due date; crypto drops the bar still
forming; NSE is cut at `latestExpectedSession`, which admits today only after 16:30 IST); the sleeve
arithmetic; the heartbeat's holder and stamp checks.

**Accepted residual risk.** Renewal is read-then-rename, so it could overwrite a successor only
after a 10+ minute event-loop stall, a stall that would itself have let the lease expire.

## Checks

| Check | Result |
|---|---|
| `vitest lib/fund lib/learning` | 163/163 |
| Full unit run | 2,237 passed; 3 failed with `disk I/O error`, `EPERM` and `spawn UNKNOWN` under machine memory pressure; all 4 affected files pass alone (27/27) |
| Invariants | 35/35 |
| MCP | 4/4 |
| Cycle bundle (esbuild, what the scheduled task runs) | compiles, 872 KB |
| `next build` | **NOT VERIFIED**: Turbopack failed to allocate 840 MB twice (machine out of memory). It passed at `8deb4c9`; typecheck passes on the fixes |
| Browser, `/fund` (Playwright) | all three mandates render; the log expands with bootstrap decision inputs and the fill; no page console errors |
