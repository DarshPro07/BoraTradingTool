# Gate 5 — independent reality verification (master golden journey)

**Verification mechanism:** the program IS the verification instrument — the complete e2e suite
against a production build, real browser, real research provider, fresh database. Independence
comes from the C50 two-clean-run rule: after the fix cycle, the ENTIRE program was re-executed
from a server restart on a VIRGIN database, so no in-memory state, no warmed cache, and no
leftover rows could carry a fix's assumption forward.

## Run 2 — fix cycle (fresh DB `.tmp/golden-run2.sqlite`)

Executed in foreground chunks (harness-reaping immunity). Thirteen defects found and root-caused
(list in `00-status.md`); every chunk brought to green ON THIS DB after its fix, including:

- all 8 deep-journey stock chains + the cross-stock cockpit gate (brain counts grew ≥ 8),
- crash-recovery actually exercising recovery for the first time on Windows (audit row
  `autonomous_run_recover` with `interrupted_jobs=` asserted),
- the 30-stock matrix + stage2 breadth (30/30 PROPOSAL READY — second fresh-DB sweep that day),
- paper lifecycle, meeting journey, and the full remainder of the suite.

## Run 3 — C50 clean run (server restart, VIRGIN DB `.tmp/golden-run3.sqlite`)

Same build (`f06bddd` + working tree), new server process, empty database, env pins verified by
the identity setup project (`MARKETPULSE_E2E_EXPECT_STARTED_AFTER` after the restart timestamp).

| Chunk | Specs | Result |
|---|---|---|
| 1 | app, brain, command-center, autonomous-lifecycle | 35 passed |
| 2 | crash-recovery | 9 passed |
| 3 | alpha/analyst/audit/dataset-ledger/data-quality | 19 passed |
| 4-7 | golden-journey-full-lifecycle (8 chains + gate) | 3+3+3+4 passed |
| 8 | edge-factory, experiments, ingestion-unlock, jobs, learning, library | 29 passed (2.1m) |
| 9 | market, meeting-journey, memory | 10 passed |
| 10-11 | nse-30-stock-matrix | 17 + 18 passed |
| 12 | stage2 sweep | 2 passed |
| 13-18 | stage2 research packs | 6,6,6,6,6,7 passed — MATRIX SUMMARY `{"total":30,"researchable":30,"terminals":{"PROPOSAL READY":30}}` |
| 19 | security-master, paper-lifecycle, quant-analytics, replay, hang-diagnostic, research-journey, research-this-stock, strategy-factory | 32 passed (3.3m) |

**Total: 221 passed, 0 failed, every chunk green first-try.**

Decisive diagnostic evidence from the final chunk:

```
[hang] ATTRIBUTION responseFinished=+56.8s domTerminal=+57.3s locator="PROPOSAL READY"
```

The UI reflects a REAL model research within 0.5s of the wire finishing — the third and final
confirmation that the historical "20-minute research hang" was a harness measurement defect, not
a product defect.

## Unit / static regression

- Full vitest suite re-run after the fixture-master (SBIN real-ISIN) and `/brain` page changes —
  result recorded in `07-final.md`.
- `npm run check` (tsc + tests + build) was green at the f06bddd baseline; the production build
  serving run 3 was built FROM this working tree, so the build path is exercised by construction.

## Independent challenge

Attempted disproofs during the run: asserted the fixture banner ABSENT on research (proves the
real provider ran); pinned `MARKETPULSE_E2E_EXPECT_STARTED_AFTER` so a stale server fails
identity; cross-checked holdout non-consumption in the DATABASE rather than the UI; demanded the
`autonomous_run_recover` audit row rather than accepting a RUNNING badge; re-posted the
hypothesis to prove dedupe. Each held.
