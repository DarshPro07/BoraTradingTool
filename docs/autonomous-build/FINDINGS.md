# Findings (root causes and load-bearing discoveries; evidence-labelled)

- **FIXED 2026-08-11 00:35 — the hypothesis triage read an indicator's PERIOD as its THRESHOLD.**
  Found by running the first real research→strategy hand-off, not by reading code. The extractor
  located a comparator anywhere in its 40-character window and then took the **first number in
  that window**. Every feature a researcher actually writes carries its period — `rsi_14`,
  `sma_20`, `atr_14` — so in "rsi_14 crosses above 70" the comparator came from `above` and the
  number came from `_14`. The authored entry rule was **`rsi14 > 14`, true on essentially every
  bar**: it backtests, it produces trades, and it means nothing. A nonsense condition wearing the
  costume of a tested one — the most dangerous output this system can produce, because every
  downstream number looks legitimate.
  **Root cause class:** individually-correct parsing over a wrong model of reality (a period is
  not a threshold). Same family as the `0 >= 0` budget defect found four hours earlier.
  **Fix:** `matchComparator()` returns where the comparator ENDS, and the threshold is read only
  from the text the comparator governs (`lib/research/hypothesis-triage.ts`). **Regression test
  proven to FAIL first** (`expected 14 to be 70`), then pass.
  **Consequence, stated plainly:** with the fabrication removed, the NIFTYBEES hand-off now
  returns **UNCLEAR** instead of a spec, because the researcher's prose says "RSI-14 between 55
  and 70" and "close above sma_20" — a band, and a feature-vs-feature comparison. Neither is a
  `feature <op> number` pair. **That refusal is correct and is an improvement**, but it means the
  research→strategy leg completes only for prose that states a numeric threshold. NEXT TASK, with
  its design question stated rather than guessed: teach the extractor "between X and Y" and
  feature-vs-feature comparisons. **Do not implement "between" as `gte X` alone** — silently
  dropping the upper bound would re-introduce exactly the class of defect just removed; the DSL
  needs a band condition or an explicit two-condition entry first.
  **Data note:** `stg_f044275a8bc41e3f` in the meeting evidence DB was authored by the PRE-FIX
  parser and carries the bogus `rsi14 > 14` rule. It is not the meeting demo strategy (that is
  `stg_00f05ed4521b7e32`), but it must not be presented as research output.


- **FIXED 2026-08-10 23:30 — every refusal under the default profile blamed the wrong cause.**
  `route()` computed `budgetGone = hardBudgetStop && apiSpentToday >= dailyApiBudget`, then used
  it for the refusal CODE. SUBSCRIPTION_FIRST sets `dailyApiBudget: 0` **by design** — it spends
  no metered money — so `0 >= 0` was true from boot and every refusal returned
  `BUDGET_EXHAUSTED`. The first live M5 run surfaced it: the real cause was "no research provider
  is installed", and the system told the owner their budget was exhausted. Nothing had been
  spent. **Root cause class:** individually-correct arithmetic over a wrong model of reality —
  a zero budget is not an exhausted one. **Fix:** the code is derived from whether any candidate
  was actually rejected for budget reasons (`lib/runtime/routing.ts`). **Regression test proven
  to FAIL against the unfixed code first** (per CLAUDE.md's real-test rule), then pass.

- **FIXED 2026-08-10 23:30 — the CLI worked in a terminal and was invisible to the server.**
  The first live run died with `spawn claude.exe ENOENT` while `claude --version` answered fine
  two feet away. Cause: the native installer puts Claude Code in `~/.local/bin`, which **Git Bash
  adds to its own shell PATH** — the Next.js server process, started by Windows, never sees it.
  Fix: `resolveClaudeBin()` tries the explicit override, then PATH, then the installer's
  documented location derived from `homedir()` (never a hardcoded absolute path), so a fresh
  install works with no configuration. **This is a fresh-install-proof defect**, not a local
  quirk — any machine using the native installer would have hit it.

- **OPEN 2026-08-10 23:45 — 6 pre-existing unit failures, all NSE security master.** Same family
  as the 23:05 stale-spec finding. NOT caused by the M5 work (none of the three files imports a
  changed module):
  - `app/api/market/instruments/route.test.ts` ×3 — **worth attention**: two fail with
    `NSE_SECURITY_MASTER_UNAVAILABLE / "NSE security master repeats ISIN INE062A01020"` (SBIN's
    real ISIN), i.e. a duplicate-ISIN guard drives the master to UNAVAILABLE. Live servers are
    NOT in this state (search resolved SBIN/RELIANCE on :3112 all session, and the 23:05 run had
    specs 1/2/3 green), so the current evidence points at the test's synthetic master carrying
    two rows for one ISIN — but **a guard that can take search to UNAVAILABLE deserves a real
    answer, not an assumption**. Next session: reproduce against the live 3,314-row master before
    touching the specs.
  - `lib/product/readiness.test.ts` ×2, `lib/knowledge/knowledge.test.ts` ×1 (audit trail expects
    2 rows, got 3).


- **VERIFIED 2026-08-10 23:05 — the 5 "NSE failures" are STALE SPECS, not a broken front door.**
  Root cause: `nse-security-master.spec` was written against a small synthetic fixture master
  (it asserts on `SMALLSME`, series SM). The real bootstrap now runs even under
  MARKETPULSE_TEST_MODE and installs the genuine **3,314-row master**, so the synthetic rows do
  not exist and specs 4/5/7/10/11 fail on missing fixtures — while specs 1/2/3 (symbol, company
  name, **ISIN**) PASS against real data. Evidence: at 22:20 a TEST_MODE server reported
  `totalRows: 5`; at 23:00 a TEST_MODE server reported `totalRows: 3314`.
  **Severity correction: the front door WORKS.** This is the §35 "a test may itself be wrong"
  case, not a P0/P1 product defect.
  **Ready fix for whoever owns the spec** (engine lane): assert against real securities instead
  of synthetic ones — the live master serves **422 SM-series rows**, e.g.
  `IN:XNSE:AAKAAR` (Aakaar Medical Technologies Limited), `IN:XNSE:AARADHYA`, `IN:XNSE:AATMAJ`.
  Either (a) point the specs at a real SM row, or (b) make TEST_MODE deterministically pin the
  fixture master and stop the real bootstrap from overriding it — (b) is preferable because a
  spec that depends on live exchange contents becomes flaky the day NSE delists that symbol.

- VERIFIED 2026-08-10 21:58 (runtime, installed package — outranks README/CHANGELOG):
  Scout v0.1.13 ships `provider login openai-codex` and DEFAULTS to it
  (provider=openai-codex, model=gpt-5.5, base_url=https://chatgpt.com, OPENAI_API_KEY unset).
  The API-key blocker recorded at 20:40 was therefore WRONG in its remedy — corrected within the
  hour by the owner's research plus direct inspection. Lesson: inspect the INSTALLED artifact's
  own registry before declaring an external dependency.
- OBSERVED 2026-08-10 21:58: Scout's preflight is a model worth copying — it enumerates every
  dependency with OK/N-A/FAIL and REFUSES to start on a critical miss rather than degrading
  silently ("agent cannot start without a working LLM provider"). Same doctrine as our
  fail-closed gate.
- CORRECTED 2026-08-10 22:00 (owner, sourced to NSE): SME classification is NOT "series ST".
  NSE documents **SM** (rolling-settlement SME), **ST** (trade-for-trade), **SO** (SME odd-lot).
  Correct rule: `instrumentType = SME_EQUITY` with `series ∈ {SM, ST, SO}` carried as metadata —
  never series-as-type. My 20:30 note calling ST "the SME series" is superseded. Likewise
  REIT/INVIT must come from NSE's DEDICATED unit files, not inferred from the broad equity file
  (which itself may contain ETFs, REIT/InvIT units and partly-paid shares).

- VERIFIED 2026-08-10 19:50: every Playwright-spawned Next DEV server auto-appends its
  `.tmp/next-playwright-<pid>` type globs into tsconfig `include` — eleven stale entries had
  accumulated, and tsc was typechecking a foreign server's MID-WRITE generated validator.ts.
  Root fix: entries stripped + `.tmp` added to `exclude` (exclude filters include globs, so
  Next's re-appending — observed again immediately — is now harmless). 
- VERIFIED 2026-08-10 19:50 (verification-of-the-verifier): `tsc | tail; echo $?` measures
  TAIL's exit, not tsc's. Prior clean claims stood on absence of error output (valid); the
  pattern is banned — check tsc's exit directly, unpiped.
- Port discipline (OBSERVED): the engine lane holds :3100 with a live dev server; UI-lane
  verification servers now use :3101 to avoid EADDRINUSE races (one earlier run silently
  reused the old server because the new one died on the occupied port — caught because the
  delta-based assertions still held; recorded so nobody trusts "ready after 1" again).

- VERIFIED 2026-08-10: MCP truncation defect — bounded() replaced >20k-char payloads with an
  envelope carrying neither ok nor data (256KB quantcore universe artifact tripped it); fixed to
  ok:false + RESPONSE_TRUNCATED; integration test accepts the code. Follow-on (§58): bounded
  slice tools queued so truncation is backstop, not normal path.
- VERIFIED 2026-08-10: /brain was nav-orphaned (nav-coverage.test); workspaces are capped at six
  views by nav.test.ts design → meeting-critical always-available pages belong in UTILITY_LINKS.
- VERIFIED 2026-08-10: server components make no client fetches — a Playwright waitForResponse
  on /api/readiness during /brain goto hangs forever; assert server-rendered pages via direct
  API calls (meeting-journey defect found+fixed during authoring).
- OBSERVED 2026-08-10: engine lane landed resolveInstrument + security-master search and
  extended meeting-journey to the NSE leg (master >3,000 rows; canonical SBIN/ISIN
  INE062A01020); brain gained a Paper orders count. Their nse-security-master.spec: 6 legs
  failing at the 16:33 full run — in-flight, not closed.
- VERIFIED 2026-08-09/10 (standing): vitest threads pool raced process.env across env-mutating
  suites → forks pool; stale dist/mcp bundle made integration tests test old code → test:full
  rebuilds first; npm absent from spawned shells → call node binaries directly.
- OBSERVED 2026-08-10 14:13 (flake, capture-less): one unit FILE failed at suite level while the
  e2e server consumed CPU (import phase 559s vs ~330s clean); two clean runs green after.
  Lesson: never run verification unit suites beside a serving e2e server. See FLAKE_LOG.md.
- STATICALLY_CONFIRMED (this session, full-repo read ~300 files): the item-13 class (provider
  window silently substituting for snapshots) is closed at every research entry point
  (snapshotFromStore + no-provider-pin test); missing-≠-zero is enforced at panel-state,
  readiness, gate, correlation, and MCP layers.
