# Gate 5 — Independent verification (2026-08-10 14:15 IST)

Fresh production build (`next build`) + fresh database server on :3100, external-server Playwright.

## Evidence
1. `tsc --noEmit` exit 0.
2. `next build` compiled all routes with the flow wired into /strategies.
3. **e2e/strategy-factory.spec.ts** (new, structurally failing pre-change — `factory-flow` did not
   exist): 2/2 passed on the fresh server.
   - Journey 1: entrance A default; embedded composer live; expressible idea POSTs 201 (asserted
     on the network response, not the render); interpretation renders EXPRESSIBLE; backtest step
     appears; backtest click asserted against the real /api/strategy/trades response with BOTH
     honest branches specified (trades+provenance, or the named fresh-DB refusal with "Nothing
     was invented" and validation kept locked); zero pageerrors.
   - Journey 2: discovery entrance loads /api/cycles (200 asserted), renders real counts
     (held/authored/rehearsed/would-pass), the run-cycle control, and the stated
     no-cycle-yet/last-cycle line.
4. **Full desktop suite: 61 passed / 2 skipped / 2 failed — the same two pre-existing
   interaction.spec NSE-search failures** (engine lane's release-severity item; unchanged
   signature). Critically, the professor path (golden-journey), hypothesis-inbox, trade-inspector
   and replay-mode suites all pass with the composer relocated inside the flow — the testid
   contract held.
5. **Unit suite**: one run alongside the still-serving e2e server had 1 file fail at suite level
   under CPU contention (recorded in docs/FLAKE_LOG.md — capture-less run, name lost, lesson
   recorded); two consecutive clean runs after stopping the server: 116/116 files, 1429 passed /
   2 skipped, twice.

## Independent challenge
- Could the flow unlock the costly step from a refused backtest? No — `factory-validate` renders
  only from `backtest.ok`, and the spec's refusal branch asserts its absence (`toHaveCount(0)`).
- Could the relocated composer break the professor path? Ran, not reasoned: golden-journey passed
  in the same suite run.
- Two RunGauntletButton instances on one page (flow + registry rows): the spec queries scoped
  under `factory-validate`; existing suites query within rows. No ambiguous selector remains.
