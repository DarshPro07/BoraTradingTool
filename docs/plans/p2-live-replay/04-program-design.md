# Gate 3 — Program design

## Files
- `app/api/forward/run/route.ts` — response gains `mode`, `evaluatedAsOf`. Derivation:
  `const evaluatedAt = asOf ?? new Date()` computed BEFORE the passes and passed to both, so the
  echo cannot drift from what ran (today each pass defaults internally; hoisting the default is
  the only behavioural nuance — same instant, now shared and attested).
- `components/forward/ForwardEvidencePanel.tsx` — state: `mode: "LIVE" | "REPLAY"`,
  `asOfInput: string`. Buttons `forward-mode-live` / `forward-mode-replay` (aria-pressed),
  input `forward-asof`, run button `forward-run` (existing testid, label switches). Note renders
  `[REPLAY — HISTORICAL EVIDENCE as of <evaluatedAsOf>]` or `[LIVE (wall clock) <evaluatedAsOf>]`
  prefix from the response, testid `forward-note` (existing).
- `e2e/replay-mode.spec.ts` — new.

## Contract
Response: `{ ...shadowReport, paper: {...}, mode: "LIVE"|"REPLAY", evaluatedAsOf: string }`.
`mode === "REPLAY"` iff request carried a valid asOf.

## Test design
- e2e (real-test): toggle → REPLAY with no instant → run disabled; set instant → run → note
  matches /REPLAY — HISTORICAL EVIDENCE/ and the instant's date, and does NOT match /LIVE/;
  API request-level: POST with asOf returns mode REPLAY + evaluatedAsOf equal to the sent
  instant; POST without returns mode LIVE. LIVE UI run → note matches /LIVE \(wall clock\)/.
- The failing-before state is structural: `forward-mode-replay` does not exist today, so the
  spec fails against unfixed code by construction (control absent), which satisfies the
  real-test rule without a synthetic revert.

## Least confident
- `datetime-local` value parsing across locales — covered by asserting on the server echo.

## Rollback
Revert the two files + delete the spec; no schema, no migration, no engine change.
