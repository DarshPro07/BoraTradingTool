# Gate 5 — Verification (executed 2026-08-09 late night)

## Unit + integration
`npx vitest run` → **104 files, 1353 passed, 2 skipped, 0 failed** — including
`lib/forward/shadow.test.ts` (11 tests mapping owner requirements 1–17): activation refusals
(no gauntlet baseline; unpriceable 2023-US economics), one-challenger-per-version with a new
version minting a new challenger, trigger-frozen challenger identity (raw UPDATE/DELETE throw),
signals emitted before outcomes with every exit strictly after its event, raw-SQL immutability
of signals and outcomes, one-signal-per-market-event dedupe across passes, watermark blocking
retroactive signals from late/out-of-order backfills, restart survival with exactly-once
resolution and byte-identical outcome rows on a repeat pass, frequency-aware predeclared policy
with INSUFFICIENT reported honestly, and the scorecard citing the frozen pinned experiment.

One real defect found by the first failing run: session features (minutes_since_open) require
panel options `{market, resolution}` — the evaluator initially built a bare panel and emitted
zero signals. Fixed to match every engine's call.

## Desktop end-to-end (mission policy: desktop-only; mobile deliberately not run)
Fresh production build; fresh `next start` :3100; fresh database.
**Desktop suite: 51 passed, 2 deliberate skips, 4 failed — all four failures are
`e2e/nse-security-master.spec.ts`, the OTHER agent's in-flight workstream-2 spec** (their UI is
mid-build; recorded in `docs/autonomous-build/STATE.md`, not concealed and not mine to fix).

`e2e/forward-evidence.spec.ts` PASSED (3.1s): hypothesis → family strategy → gauntlet baseline →
activation refused without confirm (428) → activated (201, `fch_`) → shadow pass emitted 33
signals and resolved 33 outcomes from later bars → scorecard row on /paper (ON_TRACK, honest
policy counts) → reload preserved everything → SQL cross-check proved zero outcomes at or before
their signal's event time.

Two e2e defects found and fixed while proving it: a shared-instrument seeding collision
(another suite's flat RELIANCE dailies at identical timestamps made the count-guard skip the gap
pattern — moved to a dedicated TCS series), and a strict-mode locator that matched a stale
prior-run challenger (locators now pin the run stamp).

## Known limitations (stated)
- Shadow evidence accumulates at market speed; the e2e proves machinery on seeded history, not
  a live month. Promotion thresholds are predeclared and cannot be met by software alone.
- Entry = triggering bar close; execution microstructure (fills, sizing, liquidity, competing
  signals) is the paper stage's job (WS1b, queued).
- The legacy `forward_outcomes` paper-stage ledger and the promotion ladder are intentionally
  untouched; the shadow stage feeds the ladder only through WS1b.
