# 00 — UI Truth Audit (masterclass C18/C19) — live-runtime findings, 2026-08-14

**Method:** drove the OWNER'S RUNNING dev server (no TEST_MODE — real Yahoo/provider paths, real
DB) with headless Playwright, capturing console errors, HTTP ≥400 responses, and visible error text
on `/dashboard?market=NSE`, `/analyze/IN:XNSE:RELIANCE`, `/ai?instrument=…`, `/brain`, `/jobs`.
Screenshots + raw findings: job tmp `repro_findings.json` / `repro2_findings.json`.

## Findings

1. **C19 "Analyst failed-to-fetch" — DOES NOT REPRODUCE (today).** All five surfaces loaded with
   ZERO console errors, ZERO failed requests, ZERO visible failure text. Real quotes rendered
   (e.g. AAPL $304.78); the autonomous machine was live (769 cycles today, 16 actions/cycle). The
   historical complaint is consistent with the already-root-caused-and-fixed CONTRACT_VIOLATION
   (docs/plans/marketpulse-p0-final-proof/32-research-hang-root-cause.md) and/or intermittent
   provider-side failures. Status: OBSERVED-clean now; will re-flag only on a fresh reproduction.
2. **C18 fake dashboard data — NOT PRESENT.** Static audit: no hardcoded prices, no Math.random,
   no placeholder ₹ values in `app/dashboard/page.tsx` (sector groups are curated instrument LISTS,
   not fabricated values). Runtime: real provider quotes; `/brain` shows the honest
   `UNAVAILABLE — Live feed` row with its stated fix path. The masterclass's fake-value claim
   matches an older revision, not the current tree.
3. **REAL DEFECT FOUND AND FIXED — stale `lastError` on succeeded jobs.** Live `/jobs` showed job
   #102 `ingest_history` as `succeeded` while still displaying
   `SOURCE_UNAVAILABLE … the store is unchanged and the instrument remains un-researchable` — a
   contradiction (one statement necessarily false at read time). Root cause: `completeJob` never
   cleared `lastError`, so a fail-then-succeed job kept the failure text forever. Fix: success
   clears `lastError` (per-attempt history remains in `job_events`). Regression
   `lib/research/queue-lasterror.test.ts` **proven to fail against the unfixed code** (real-test
   rule), passes after; adjacent queue/dependency/chain/team suites 39/39; tsc 0.
4. **AnalystPanel absence on NSE — honest, not broken.** The panel returns null when the provider
   supplies no analyst ratings (typical for NSE via the current provider). Nothing fake is shown.
   UX-polish candidate (an explicit "no analyst coverage from this source" row), not a defect.

## Next in this lane (unstarted, owner-visible)

- Explicit "no analyst coverage" statement on /analyze instead of silent absence.
- Periodic re-probe of C19 during market hours (the non-reproducing complaint was intermittent).
