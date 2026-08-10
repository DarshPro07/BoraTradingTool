# Gate 4 — Slices

1. Schema + constants + manifest module — typecheck.
2. Gauntlet choke point (guard, identity threading, manifest) — gauntlet-ledger suite.
3. Rehearsal onto `ResearchDatasetSource` — rehearsal suite rewritten against the new contract.
4. Callers (route, auto-gauntlet, cycle) + persistence of identity — cycle.resolution rewritten
   onto a seeded store (with the accumulation-pinning discovery recorded in `01-reality.md`).
5. Promotion economics fail-closed — promotion-economics suite.
6. Pins + mutation checks — no-provider-pin; two live mutation runs (guard disabled → test
   failed; provider import reintroduced → pin failed; both restored).
7. UI provenance + e2e — RunGauntletButton line, RehearsalLedger panel, three new/extended
   ledger e2e tests, provider-abort reopen.

Defect found and fixed along the way: `trial_` id collision for prefix-sharing families
(selection-ledger), surfaced by the slice-2 determinism test.
