# Gate 4 — Vertical Slices

Each slice lands with its tests green and the full suite untouched-or-better before the next.

1. **Queue failure classes + revival** — smallest slice that changes durable behavior; everything
   later leans on it. Fail-first: permanent-dies-immediately, dead-retryable-revives.
2. **Generic resolver + loop test** — moves the cycle's inline remediation into
   `lib/brain/dependency-resolver.ts`; the self-resolution loop test is the acceptance test the
   feedback named as "the actual autonomy test".
3. **Typed reasons + supervisor health** — the A7 health model the feedback tightened; carries
   the real quant-core-unreachable fix. Fail-first against the catch-only rule.
4. **Forecast resolver on bar arrival** — first FUTURE_EVENT-style wake: DATA_INGESTED →
   store-only grading.
5. **resumeAt eligibility clock** — waiting reasons name their wake time via getMarketPhase.
6. **Verification** — full suite ×, tsc, docs, verdict.

Status tracked in 00-status.md; verification evidence in 06-verification.md.
