# Master Golden Journey (masterclass A76/C34-36) — status

**Program:** the complete-product acceptance run — every e2e spec, one fresh DB, one production
server (`:3100`, isolated dist dir, identity-gated) — with the deep lifecycle journey rebuilt to
the masterclass shape and a single master entry point.

## Gate 0 — reality (what existed)

- `golden-journey-full-lifecycle.spec.ts` — the deep 12-rung chain, but SINGLE-stock (TCS) and
  carrying two STALE fixture-era assertions: (a) it demanded the "NOT INTEGRATION VERIFIED" fixture
  banner and a DISABLED handoff — false since research went live (breadth leg: 30/30
  SOURCE_VERIFIED); (b) it asserted `securityMaster.totalRows > 3000` — a live-bootstrap
  assumption, false under the TEST_MODE acceptance-universe fixture (32 rows).
- `research-journey-multi-stock.spec.ts` — 6 diverse stocks but SHALLOW (page-survival, soft
  `status<500`/`console.warn` assertions — the exact anti-pattern the matrix spec documents).
- `crash-recovery.spec.ts` — self-contained (spawns its own server on an OS-chosen free port);
  safe under an external server.
- 27 spec files total; the suite was green on a fresh DB as of 2026-08-09 (runbook).

## Built (C34 + C36)

- **`golden-journey-full-lifecycle.spec.ts` rebuilt** as the multi-stock deep journey: the full
  chain per stock across **8 diverse equities** (TCS, ICICIBANK · TATAMOTORS, TITAN · GAIL,
  BECTORFOOD, CHAMBLFERT, JYOTHYLAB — 2 large / 2 mid / 4 smaller). Per stock: identity →
  REAL research (150s budget, NO fixture banner; on SOURCE_VERIFIED the handoff must be ENABLED,
  and it is CLICKED once (TCS) asserting a STATED triage verdict — A76's "use the handoff that
  exists") → hypothesis (professor path, deterministic; dedupe re-post asserted) → strategy
  registry (stage + reason) → snapshot-pinned backtest (`dss_` + fingerprint) → double-gated
  gauntlet (428 → confirmed verdict) → holdout untouched (DB cross-check) → confirm-gated forward
  activation → signals-before-outcomes → paper invariants (fills after intents, outcomes after
  signals, cash ≥ 0, separate ledger) → alpha health rendered + durable across reload. Final test:
  learning cycle (200/423 honest) + brain counts grew by ≥ 8 across hypotheses/strategies/paper.
  Per-stock gap-shaped deterministic bars (count-guarded) so the strategy genuinely fires.
- **`npm run test:master-golden`** (C34) = `playwright test --project=desktop-chromium` — the one
  entry point; the complete product coverage IS the suite (identity gate runs first as a project
  dependency and blocks everything on a wrong server/DB).
- Stale assertions replaced with current-truth invariants that hold in BOTH environments
  (master ≥ 30 rows; TCS's REAL ISIN pinned; fixture banner asserted ABSENT on live research).

## Run order note (shared fresh DB, one command)

Alphabetical spec order sequences the shared-DB day correctly: the journey seeds its gap bars
before `nse-30-stock-*` run; matrix accepts any truthful terminal (the 8 pre-seeded stocks do REAL
research instead of refusing — a valid outcome by its own contract); stage2 ingestion returns
ALREADY_READY for them. The AUTO-runtime specs run first and may start the machine; later specs
tolerate lease-holders honestly (423), per the suite's established design.

## Run log — defects the journey found, each root-caused and FIXED (C35)

Run 1 (monitored single command) was killed externally with its monitor (harness task reaping);
run 2 executes the same fresh-DB program in foreground chunks, immune to reaping. Fixes so far:

1. **Runner-convention hole** — a bare `playwright test` loaded vitest infra files and died;
   `testMatch: /.*\.(spec|setup)\.ts/` now encodes the repo's own `*.spec` vs `*.test` boundary in
   `playwright.config.ts`.
2. **`app.spec` chrome check was an environment assumption** — exact-text "PAPER" never exists on a
   TEST_MODE server (the badge deliberately reads "DEMO DATA" there); on `/command` it failed
   honestly, elsewhere it passed by matching unrelated text. Now asserts the `mode-badge` testid —
   the element that exists in BOTH environments.
3. **`brain.spec` stale label** — "LEARNING MODE" predates the mode-taxonomy collapse; now asserts
   `MODE` + machine state.
4. **`crash-recovery` — FOUR layered defects**: (a) respawn on the killed port raced Windows
   TIME_WAIT/surviving children into EADDRINUSE — respawn now uses a fresh port (the test's identity
   is the DATABASE, not the port); (b) a dead child was polled for 240s with no diagnosis — child
   exit now fails fast WITH its stderr; (c) that diagnosis exposed an absolute `distDir` joined onto
   the project root by Next (mkdir ENOENT `E:\...\C:\Users\...`) — the spec had NEVER actually
   exercised recovery on Windows; now a project-relative dist dir; (d) the heartbeat aging wrote an
   ISO STRING into an epoch-integer column — Invalid Date, every staleness comparison silently
   false, recovery never triggered; now epoch seconds. PLUS the mutation boundary requires the
   local-session cookie + sane Fetch Metadata (Node fetch sends `sec-fetch-mode: cors` with no
   `sec-fetch-site`) — the spec now bootstraps a session and states its metadata truthfully.
   **The checkpoint's named "auth surfaces not e2e-verified" risk is now VERIFIED.** Also fixed the
   transient-DEGRADED race: a machine that recovers to RUNNING before the first poll is a BETTER
   outcome; the durable proof is the `autonomous_run_recover` audit row, which is asserted.
5. **`dataset-ledger` shared-DB collision** — its seeder guarded only 5-minute rows then blind-
   inserted daily rows; per-resolution guards now.
6. **Journey prose fragility** — tickers that are real English words (TITAN, GAIL) inside the rule
   clause perturb the dependency parse (UNCLEAR); the statement is now symbol-free with per-stock
   identity in the title (the hypothesis id hashes title:statement).
7. **Cockpit ledger mix-up (product fix)** — `/brain` counted FORWARD paper accounts but LEGACY
   manual paper orders ("8 accounts, 0 orders" after eight journeys); the panel now shows each
   ledger's own count (`Forward paper orders` added).

## Later fixes (run 2 continued — each root-caused)

8. **ingestion-unlock's 20-minute "hang"** — the whole workflow SUCCEEDED (INGESTED → real research
   46s → PROPOSAL READY → 3/3 citations) and then an UNBOUNDED `textContent()` on the — absent on
   success — refusal element waited 18 minutes until the test timeout. Bounded (2s) here and in the
   matrix spec's log line. This closes the root-cause doc's "unexplained +1249.6s" tail AND the
   spec's own "9.5-minute research" performance mystery: post-fix the whole spec runs in ~70s
   (phase log: subject 0.3s · refusal 3.1s · ingest 3.7s · research#2 66.1s). Run-3 confirmation:
   the containing chunk collapsed from 23.7m to 2.1m.
9. **meeting-journey fixture-era research step** — 15s wait + fixture banner + disabled handoff →
   modernized to the live-research boundary contract (150s, no banner, enabled handoff on success,
   stated refusal on failure).
10. **security-master pagination pin** — `total: 5` tracked the old fixture; now pins pagination
    semantics + `total >= 30`.
11. **paper-lifecycle shared-DB absolutes** — dedicated subjects (COLPAL/BERGEPAINT, traded by no
    other spec), precondition established through the product (watchlist DELETE), account cash and
    position/realised-P&L converted to DELTA form, limit prices rebased to the ₹1,000 fixture
    quote, and the fixture-quality assertion corrected (`FIXTURE`, not `LIVE` — the spec itself
    asserts `simulatedFixture: true` on the next line).
12. **research-this-stock test budget** — declared a 300s wait for the real response inside a 45s
    default test budget; now 360s.
13. **hang-diagnostic** — (a) reserve empty-store candidates (the synthetic fixture rows
    BANKBE/SMALLSME) so the boundary scenario is establishable after the breadth suites saturate
    the store; (b) a MEASUREMENT defect: it latched the FIRST research POST's wire-finish (the
    instant refusal) against the SECOND call's DOM terminal, silently absorbing the whole ~50s
    second model call as a "UI gap". Now pairs the latest POST with the terminal it produced.
    Run-3 attribution: `responseFinished=+56.8s → domTerminal=+57.3s` — the UI reflects a real
    research within 0.5s. THE RESEARCH-HANG INVESTIGATION IS CLOSED.

## Final state — VERIFIED_FOR_DEFINED_SCOPE

- **Run 2** (fresh DB `golden-run2`): all 28 spec files green after the fixes above — including all
  8 deep-journey chains, the cockpit gate, both matrix halves, the full stage2 (30/30 PROPOSAL
  READY), crash recovery, paper lifecycle, and the meeting journey.
- **Run 3 / C50** (restart, VIRGIN DB `golden-run3`, same build): the ENTIRE program re-run —
  **every chunk green FIRST-TRY, 221 passed, 0 failures**, including: deep journey 8/8 + gate,
  matrix 35, stage2 sweep + 30/30 PROPOSAL READY + gate (the third independent fresh-DB research
  sweep of the day), crash recovery, and the fixed diagnostic proving sub-second UI settle.
- `npm run test:master-golden` is the single entry point (C34); the runner-convention boundary is
  encoded in `playwright.config.ts`.

Two consecutive clean runs satisfied (C50). Product fixes shipped along the way: the `/brain`
forward-paper ledger count and the (earlier-committed) queue lastError truth. Everything else was
acceptance-spec modernization to the product's CURRENT, more honest behavior — recorded per fix
above.
