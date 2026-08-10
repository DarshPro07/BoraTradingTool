# Gate 5 — Independent reality verification

Run 2026-08-09. Every figure is a recorded command result.

## Static, unit, build, browser

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **100 files, 1,287 passed, 2 skipped, 0 failed** |
| `npx next build` | exit 0 |
| `npx playwright test` (fresh database, desktop + mobile) | **66 passed, 4 skipped, 0 failed** |

## The real-test rule, performed

Mutation: `executionProfile?.mandatoryExitMinute` in the single-instrument engine was replaced with
the old hardcoded `920` (15:20). Result: **2 tests failed** —

- `flattens at the broker's 15:25 deadline` (the direct assertion), and
- `the portfolio engine reaches the same exits as the single-instrument engine` (parity), which is
  the important one: it proves a divergence between the engines is caught even when only one of
  them regresses.

Fix restored; suite returned to 11/11.

## Live-source verification

Zerodha's square-off page was fetched by this system during Gate 0, not quoted from memory:
non-CAS 15:25 / CAS 15:10 / F&O 15:26 / Rs 50 + GST / volatility caveat / entry block after the
window. The profile's `source.confidence = "independently_fetched"` is therefore literally true.
Upstox's 15:20 was **not** fetched — it carries `owner_review_reported` and a stated assumption,
and the internal-consistency test enforces that any confidence below `independently_fetched` must
carry at least one assumption.

## Independent challenge — attempts to disprove

| Attack | Result |
|---|---|
| BSE intraday backtest (silently used 15:20 before) | refused, `EXECUTION_PROFILE_UNAVAILABLE`, names known profiles |
| dataset spanning two synthetic profile windows | refused, `PROFILE_WINDOW_MISMATCH` (unit-tested via injectable records at the lookup level; engine boundary check present) |
| squareOffAt 15:22 (legal under the real rule, refused under the old constant) | accepted — the correction is itself a test |
| squareOffAt 15:29 | still refused, "may only tighten" |
| leverage smuggled into the verdict | verdict stays cash-based; leveraged count is a labelled bound |
| Upstox delivery priced off Zerodha's card | lookup throws `NO_SCHEDULE_IN_FORCE` naming the broker |
| e2e: does the UI's data source actually carry provenance? | authoring response asserts ZERODHA + 15:25 + fetched 2026-08-09 + non-CAS, on a fresh database |

## Not verified

- **Physical Zerodha behaviour** (does the RMS actually fire at 15:25 on a given day) — not
  verifiable without a live account; the profile's volatility caveat covers the gap honestly.
- **Upstox's figures** — owner-review-reported, marked as such.
- **Kite contract** — types only; explicitly not integration-tested, by design and by statement.
- **A rendered screenshot of the Studio warning panel** — the warning text is asserted through the
  authoring API the panel renders verbatim (`StrategyAuthor.tsx` maps `result.warnings` directly);
  a pixel-level pass is deferred.

## Verdict

**VERIFIED** for everything implemented, with the honest exclusions above.
