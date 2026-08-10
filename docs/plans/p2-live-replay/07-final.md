# P2 — LIVE / REPLAY validation surface — FINAL

## Verdict: VERIFIED (2026-08-10 13:47 IST)

## Objective
Mission P2: two explicit modes over the forward/paper pass — LIVE and REPLAY — HISTORICAL
EVIDENCE; replay uses immutable snapshots + asOf, is demonstrable with the market closed, and is
never labelled live.

## What was built
- `app/api/forward/run/route.ts` — response now attests `mode` ("LIVE"|"REPLAY") and
  `evaluatedAsOf` (the single instant handed to both shadow and paper passes).
- `components/forward/ForwardEvidencePanel.tsx` — LIVE/REPLAY toggle; REPLAY requires an explicit
  `datetime-local` instant (run disabled until it parses); run button posts `{asOf}` only in
  REPLAY; the result note is prefixed from the server's own attestation:
  `REPLAY — HISTORICAL EVIDENCE as of <instant>` / `LIVE (wall clock <instant>)`.
- `e2e/replay-mode.spec.ts` — desktop journey (interaction + label + API echo), green on a fresh
  production server.

## Exact results
tsc 0 errors · next build OK · replay-mode spec 2/2 passed · full desktop suite 59 passed /
2 skipped / 2 pre-existing failures (NSE search flow, engine lane, documented in
06-verification.md) · unit suite 1429 passed / 2 skipped ×2 earlier this session.

## Limitations / deferred
- No global app-level replay state (deliberate: replay is per-pass; a chrome badge would
  misstate the app).
- Signal-row-level replay provenance (each ledger row already carries its own event times; a
  dedicated "produced by replay pass X" column would be an engine-lane schema change and was not
  needed for honest labelling).

## Rollback
Revert the two edited files, delete the spec. No schema, no migration, no engine change.
