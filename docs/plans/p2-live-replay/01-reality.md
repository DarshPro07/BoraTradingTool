# Gate 0 — Reality

All conclusions from a full read of the touched files this session (STATICALLY_CONFIRMED unless
noted).

## What exists
- **Replay machinery is real and already the research default.** Rehearsal, gauntlet and
  inspection run ONLY on immutable dataset snapshots from the canonical store
  (`snapshotFromStore`; provider import banned by test). Research is replay by construction.
- **asOf time-travel exists at the API.** `app/api/forward/run/route.ts` accepts `asOf` (ISO or
  unix seconds), validates it, and runs `runShadowPass(asOf)` + `runPaperPass(asOf)` — one
  deterministic instant for both stages. The watermark forbids retroactive signals (REPRODUCED:
  forward-evidence e2e passes; shadow tests pin it).
- **The UI never exposes it.** `ForwardEvidencePanel` posts `{}` — wall clock only. No surface
  lets the owner run a pass "as of" a stated moment; the e2e reaches determinism by rewinding
  the watermark directly in SQLite, which a user cannot do.
- **No result is labelled.** The run response reports counts but not the instant or mode it
  evaluated under; the panel note prints a summary with no LIVE/REPLAY distinction.
- **Labelling vocabulary exists**: `lib/ui/panel-state.ts` (LIVE/CURRENT/DELAYED/STALE...),
  `ModeBadge` (chrome, says PAPER), `Provenance` component. Nothing says REPLAY anywhere
  (OBSERVED: repo-wide grep during the full read).

## What is missing (the gap P2 names)
A product surface where a person chooses LIVE or REPLAY, supplies the replay instant, runs a
pass, and reads a result that states which mode produced it — demonstrable with the market
closed.

## Constraints
- Lane: UI/integration only. `lib/forward/**` (engine) is not edited; `app/api/forward/run` is
  app-layer, authored by this lane in WS1 — extending its RESPONSE (not its behaviour) is in
  scope.
- Never label a replay result live (mission verbatim). A global "app is in replay" badge would
  itself be a lie — replay is a property of a pass, not of the application; labelling lives at
  the action/result surface.
- Desktop-only Playwright; interaction + network/API + persistence evidence, not screenshots.
