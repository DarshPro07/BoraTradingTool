# Telemetry measurement honesty — status

**Owner directive (2026-08-15, verbatim intent):** before the scoreboard changes to quant
quality, close two housekeeping items. (a) `tokens = 0` must never mean "measured zero" when the
truth is `tokens = null / UNMEASURED` — the Model Router will learn from cost/latency/quality
statistics, and fake zeroes would make an unmeasured model look artificially cheap. (b) The
acceptance suite's two skipped tests must be explicitly classified (`EXPECTED_SKIP`,
`EXTERNAL_DEPENDENCY`, …), not merely contribute to "2 skipped".

This is the KNOWN RESIDUAL queued in `docs/plans/brain-observability/07-final.md` §Independent
claim verification (item 1) plus the skip-classification item, executed as one small leg under
the infrastructure freeze (both are repairs of existing surfaces, not new subsystems).

## Gates

- [x] Gate 0 — reality (01-reality.md)
- [x] Gate 1-3 — product/architecture/design (02-design.md; small leg, combined with rationale)
- [x] Slice 1 — failing tests proving the defect (write-path test failed live against the
      unfixed tree), then the fix (write path + read model + pure statement helpers + UI), green
- [x] Slice 2 — skip classification tag + suite-wide manifest guard
- [x] Gate 5 — verification (06-verification.md): units 161/1834/0 ×2, tsc silent, prod build
      clean, brain-executions live e2e 2 passed (5.0m) on the exact tree
- [x] 07-final verdict — VERIFIED_FOR_DEFINED_SCOPE

## Exact next action

None — leg complete and committed. Next: the quant-quality program
(`docs/plans/quant-quality-program/`).
