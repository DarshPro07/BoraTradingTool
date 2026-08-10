# Gate 5 — Verification (executed 2026-08-10 morning)

## Unit + integration
`npx vitest run` → **110 files, 1373 passed, 2 skipped, 0 failed**, including
`lib/forward/paper.test.ts` (10 tests mapping the owner's WS1b list): one-account-per-challenger
with v2 inheriting nothing (19); ₹300 account → INSUFFICIENT_CAPITAL recorded as evidence with
zero spend (1); running-cash sequencing prevents overspend (13); fill-at-next-open →
stop/target/square-off closes → funds move exactly once and a repeat pass changes NOTHING
(5, 11, 12); one-signal-one-intent across passes AND restarts (6, 14); open state survives
restart (7); no bar ⇒ no invented fill (15); raw-SQL immutability of intents/outcomes and
frozen terminal orders (17); paper pass leaves the shadow ledger byte-identical (18); intent
expected-price ≠ order fill-price, both preserved (ledger-design rule).
One engine defect found by the first failing run: single-pass replays needed a close sweep after
late fills (step 5) — fixed, and the repeat-pass-changes-nothing assertion now guards it.

## Desktop end-to-end (fresh build, fresh `next start` :3100, fresh DB)
`e2e/forward-evidence.spec.ts` PASSED (5.6s), now covering the full WS1b journey: hypothesis →
gauntlet → challenger (428→confirm→201) → **enroll at ₹10,000 (201)** → one `asOf` pass →
shadow signals AND paper intents/fills/closes all > 0 → /paper row shows "PAPER (separate
ledger)" with executed/rejected/net P&L → reload persists → SQL cross-checks: zero outcomes at
or before their signals, zero fills before their intent decisions, account cash ≥ 0.

Suite: **54 passed, 2 deliberate skips, 2 failed — both in `interaction.spec.ts` search tests
that the OTHER agent's in-flight NSE search rebuild has moved and broken** (their
nse-security-master spec itself now passes). Theirs, tracked in STATE, not concealed.

## Deferred with reasons (stated)
Partial fills, resting LIMIT/SL book (schema ready via TRIGGER_PENDING; declaration honest until
built), depth/queue/latency modelling (scalping fidelity — future execution-model work), and the
forward-vs-paper drift view (needs accumulated paper history).
