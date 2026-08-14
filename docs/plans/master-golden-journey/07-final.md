# Final — master golden journey (masterclass A76 / C34-36 / C50)

## Objective

Make the COMPLETE product provable in one command: every screen, every workflow, and the full
12-rung research→hypothesis→strategy→backtest→gauntlet→holdout→forward→paper→memory lifecycle,
run per-stock across a diverse 8-equity set, on a fresh database against a production build —
and prove it twice (C50).

## What was built

- `e2e/golden-journey-full-lifecycle.spec.ts` rebuilt single-stock → **8-stock deep journey**
  (TCS, ICICIBANK · TATAMOTORS, TITAN · GAIL, BECTORFOOD, CHAMBLFERT, JYOTHYLAB), each running
  the full chain with REAL research (no fixture banner tolerated; the SOURCE_VERIFIED handoff is
  enabled and — on TCS — actually clicked through triage), plus a cross-stock cockpit gate.
- `npm run test:master-golden` — the single master entry point (C34).
- `playwright.config.ts` `testMatch` — encodes the `*.spec` (playwright) vs `*.test` (vitest)
  runner boundary that a bare invocation used to violate.
- Product fix: `/brain` now reports the forward paper ledger (`Forward paper orders`) alongside
  the legacy manual ledger — eight journeys no longer render as "0 orders".
- Fixture master extended to the 30-symbol acceptance universe (TEST_MODE + empty-DB gated;
  SBIN carries its real repo-recorded ISIN).

## Defects found by the program (C35): 13 — all root-caused and fixed

Catalogued with mechanisms in `00-status.md`. Headlines: crash-recovery had NEVER exercised
recovery on Windows (4 stacked defects incl. epoch-vs-ISO heartbeat and project-relative
distDir — fixing it also e2e-verified the checkpoint's named auth-surface risk); an unbounded
`textContent()` burned 18 minutes AFTER successful research (closing the "9.5-minute research"
and "+1249.6s" mysteries — the chunk went 23.7m → 2.1m); the hang-diagnostic paired one call's
wire-finish with another call's DOM settle (fixed, it now proves 0.5s UI settle).

## Evidence

- **Run 2** (fresh DB, fix cycle): all 28 spec files green after fixes.
- **Run 3 / C50** (restart + virgin DB): **221 passed, 0 failed, every chunk first-try** —
  including the day's THIRD independent fresh-DB 30/30 PROPOSAL READY research sweep.
  Full chunk table in `06-verification.md`.
- **Unit/static after final changes:** vitest **152 files, 1786 passed, 2 skipped, 0 failed**
  (post SBIN-ISIN + `/brain` change). Production build serving run 3 was built from this tree.
- Research-hang attribution (final chunk):
  `responseFinished=+56.8s domTerminal=+57.3s locator="PROPOSAL READY"`.

## Unresolved limitations

- The deep journey clicks the triage handoff on ONE stock (TCS) — by design (each click spends a
  real triage); the other seven assert the enabled gate.
- Physical-device/mobile passes remain out of scope (desktop-only Playwright policy).
- C39 extended crash scenarios (kill mid-model-call / mid-backtest) are queued in WORK_QUEUE.

## Rollback

Every change is additive spec/config/docs plus two small product diffs (`app/brain/page.tsx`
line-count panel, `lib/db/index.ts` fixture rows). `git revert` of the single commit restores
the prior state; no migrations, no data transformations.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE** — the complete-product acceptance program exists, is one command,
found and closed 13 real defects, and passed twice consecutively (C50), the second time on a
virgin database with zero retries. Not claimed: mobile/physical devices, C39 extended crash
matrix, multi-day soak.
