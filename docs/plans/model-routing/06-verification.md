# Gate 5 — Independent Reality Verification (Model Routing, rung 4)

## Method

An independent `verifier` subagent (fresh context, no authorship stake) read all 9 files in full,
**hand-traced the scoring algorithm** against the seeded ledger values to confirm the winning margin
is real (not incidental to roster order), diffed `routing.ts` against HEAD, grepped for
fake-completion, and ran the targeted suites + full suite + a root-cause isolation of the one
full-suite anomaly.

## Verdict

**VERIFIED (PASS), high confidence, 0 blockers.**

All 8 claims verified against production code with decisive (non-tautological) assertions:

| # | Claim | Verifier finding |
|---|---|---|
| 1 | Learned, not hard-coded | `score()` weights ledger-derived verificationRate; the integration test places the winner SECOND in the roster and hand-computed scores give m-good 0.85 vs m-meh 0.05 — decisive. |
| 2 | Capability filter is a hard gate | non-declaring models `continue` before `survivors`, so they cannot appear in `trail`; the test asserts trail === exactly the capable set. |
| 3 | Refuse, never silent downgrade | exactly two returns; the success return only ever holds filter-surviving candidates; both refusal codes carry the attempted trail. |
| 4 | Unproven tried on prior; floor proven-only | `proven` gate confirmed both halves; removing `&& proven` would flip the test to `ok:false` — decisive. |
| 5 | computeModelStats correctness | isVerified definition, deterministic-run exclusion, per-capability keying, and a real numeric median all confirmed by reading + hand-verified test numbers. |
| 6 | Roster-agnostic + honest default | no vendor names; `roster.length>0 ? … : undefined`; the no-roster test asserts `modelAssignments` absent after the JSON round-trip. |
| 7 | route() unchanged | `git diff --stat HEAD -- routing.ts` empty; last touch predates this leg; invariants structurally untouched and unreachable from the new layer. |
| 8 | Team OS + single slice still pass | team 13/13, single slice 7/7 (untouched); the lib/agents diff is strictly additive (2 replaced lines widen a signature). |

Evidence: targeted suites **31 passed** (11+13+7); tsc 0; full suite **1779/1779 non-skipped passed**;
anti-fake-completion clean.

## The one full-suite anomaly — root-caused as environmental

The full-suite run showed `mcp/server.integration.test.ts` failing on a `beforeAll` hook timeout
(spawning a stdio child process under 151-files-worth of concurrent process spawns). The verifier
confirmed it is **not a rung-4 regression**: the file is untouched, shares no code path with the
router, and passes 4/4 standalone (2.6s). Zero actual test-assertion failures in the full run.
(A pre-existing flake class the repo already documents; suggest raising that spec's hookTimeout.)

## Five gaps — disposition

- **Refusal classification re-parsed prose** (`startsWith("latency")`). **CLOSED** — refactored to a
  structured `sawCapableButCapped` flag set as candidates are filtered; both refusal-code tests still
  pass. (The verifier flagged this as a low-risk future foot-gun; it is now removed.)
- **Verifier could not execute a live mutation** (Edit disabled for its role). **Already covered** —
  the author ran the mutation (`proven=false` → the integration test fails → reverted), so the
  ledger-learning assertion is empirically proven decisive, not only analytically.
- **computeModelStats live-DB path "untested"**. **Already covered** — the `[rung4]` integration test
  seeds real `agent_runs` and calls `computeModelStats()` with NO rows arg, so the live-DB path is
  exercised end-to-end (the router picks the seeded winner). Noted for clarity.
- **Real detected-roster wiring deferred** — disclosed and intended; the only production caller passes
  no roster today, so learned routing is exercised by tests until the roster is wired (the next step).
- **mcp flake under parallelism** — environmental, pre-existing; documented, not this leg's defect.

## Gate 5 outcome

Satisfied. All 8 claims verified; the one actionable gap (prose-parsed classification) closed and
re-verified; the remaining gaps are already-covered or explicitly-deferred scope.
