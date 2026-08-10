# Golden journey + CAS/conflict correction - status

**2026-08-09 evening - Verdict: VERIFIED**

## Part 1 - broker-profile correction (pre-journey, per owner review)

- The 15:10 rule is modelled as **securityClass: CAS** (Closing Auction Session membership,
  effective 2026-08-03) - exchange session structure, not a watchlist. A CAS query before
  2026-08-03 refuses; the owner context resolves NON_CAS with the assumption stated.
- **Source-conflict semantics added**: SourceRef {priority, sourceEffectiveDate, retrievedAt,
  statedExitMinute}, verificationStatus VERIFIED/CONFLICTED/UNVERIFIED/SUPERSEDED,
  conflictingSourceIds.
- **The real conflict is recorded, not resolved**: Zerodha's F&O square-off - support page and
  July-29 bulletin say 15:26, CAS guidance effective 2026-08-03 says 15:25. Profile
  ZERODHA_NSE_FO_MIS_2026_08 carries status CONFLICTED, both sources with stated values, adopts
  the conservative 15:25 as an explicit research assumption, and a consistency test **proves** any
  CONFLICTED profile adopts min(statedExitMinutes) and lists >=2 sources. describeExecution says
  CONFLICTED out loud.
- Gauntlet route now answers ResearchIdentityMissing with 412 and HoldoutBudgetExhausted with 409
  instead of crashing - found by the journey's first run against a stale build, fixed, re-proven.

## Part 2 - the golden journey (e2e/golden-journey.spec.ts)

One continuous test, desktop + mobile, fresh database, run twice (independent re-run), traces
preserved under test-results/ from the --trace on run.

| Steps | What was proven through the real UI/API |
|---|---|
| 1-3 | app opens from nothing; data-quality states its empty/window status explicitly |
| 4-9 | NSE 5m ORB strategy authored through the Studio editor (real textarea + button) |
| 10-12 | warnings display ZERODHA, 15:25, "fetched 2026-08-09", non-CAS scope |
| 13-14 | reload + navigate away + return: strategy persists; ladder shows stage + reason |
| 15-16 | learning cycle runs via the real route; registry shows an explicit rehearsal outcome |
| 17-19, 22-23 | 428 without confirm (cost stated); with confirm the orphan is REFUSED - 412 RESEARCH_IDENTITY_MISSING / 503 NO_DATA / 422 - never a silent pass, holdout untouched |
| 20-21 | cost ladder and capital feasibility from the fee engine (Rs 1,000 refused, 0.106%) |
| 24 | squareOffAt 15:29 refused in the editor with "may only tighten" verbatim |
| 25-26 | API outage (route abort) leaves a living page, not a blank |
| 27 | no horizontal overflow on the mobile viewport |
| 28 | zero console errors across the honest path (asserted before deliberate refusals) |
| 30 | full second run, green |

## Documented product gaps (journey findings, not failures)

1. Hypothesis creation has no UI or HTTP surface (MCP only) - next master-plan item.
2. Per-trade inspection has no UI surface - deadline compliance is unit-pinned with a mutation
   check; the UI shows the assumption and its source.

## Final evidence

1,294 unit tests / 101 files / 0 failed - 70 browser tests on a fresh database / 0 failed -
typecheck clean - build clean - journey passed twice on both viewports.
