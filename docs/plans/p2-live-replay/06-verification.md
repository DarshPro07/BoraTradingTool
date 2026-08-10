# Gate 5 — Independent verification (2026-08-10 13:45 IST)

Verified against a freshly built production server (`next build` + `next start`) on
http://127.0.0.1:3100 with a brand-new database (`.tmp/e2e-replay.sqlite`) — not the dev server,
not a warm database.

## Evidence
1. **Typecheck**: `tsc --noEmit` exit 0 after all three slices.
2. **Production build**: `next build` completed (all routes compile with the new panel).
3. **P2 journey** (`e2e/replay-mode.spec.ts`, desktop-chromium, external server):
   - UI test: mode toggle present, LIVE default; REPLAY reveals the instant input and the run
     button is DISABLED until an instant parses (an instant-less replay would be live in
     disguise); replay run → note contains `REPLAY — HISTORICAL EVIDENCE as of 2026-08-03` and
     does NOT contain `LIVE`; switching back → note contains `LIVE (wall clock` and not
     `REPLAY`. Passed (4.6s).
   - API attestation test: POST with `asOf` returns `mode: "REPLAY"`,
     `evaluatedAsOf === sent instant`; POST without returns `mode: "LIVE"` with a wall-clock
     instant within 60s of now. Passed (75ms).
   - Real-test rule: the spec is structurally failing against pre-change code — the
     `forward-mode-replay` control did not exist, so the first interaction fails by construction.
4. **Full desktop e2e regression**: 59 passed, 2 skipped, **2 failed — both pre-existing**
   (`interaction.spec.ts` :249 and :309, the NSE search→analyze resolution on a fresh DB with no
   security master; same two failures recorded at the P0 close-out before any P2 edit). The
   captured error context shows the chrome (including the new Brain utility link) rendering
   correctly; the failure is inside the search flow owned by the engine lane's in-flight NSE
   search rebuild. Not caused by, and not maskable by, this change.
5. **Unit suite**: 116 files / 1429 passed / 2 skipped ×2 consecutive runs earlier this session
   (post nav+mcp fixes); the P2 edits touch no unit-tested module's behaviour (route response
   fields added; component client-side only) and `tsc` re-verified after.
6. **Persistence**: replay/live passes write through the existing trigger-immutable forward and
   paper ledgers (unchanged engine path); the forward-evidence journey in the same suite run
   re-verified signals-before-outcomes and fill-after-intent invariants directly in SQLite.

## Independent challenge attempted
- Could a replay result render unlabelled? The label is derived from the SERVER response
  (`body.mode`), not the toggle; a response without `mode` (old server) renders no label rather
  than a wrong one, and the deployed route always sets it.
- Could REPLAY silently mean "now"? No — client disables the run until an instant parses, and
  the server treats absent asOf as LIVE and says so in the attested response.

## Outstanding (not this item's scope)
- The two interaction.spec failures belong to the NSE search flow (engine-lane rebuild +
  security-master seeding for e2e). Tracked in WORK_QUEUE; do not close them from this lane.
