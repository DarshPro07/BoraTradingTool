# Final — brain execution observability

## Objective

The last infrastructure rung (owner directive 2026-08-15): `/brain` proves what the Team OS,
Agent OS and ModelRouter actually did — one correlated execution tree derived from the ledgers
they already write. A read model, not an orchestration rewrite; after this, infrastructure
freezes and the work becomes quant quality.

## What was built

- **`lib/brain/execution-trace.ts`** — the one read model: job → TeamRun → members → artifacts,
  every edge ID-EXACT (deterministic member/artifact ids recomputed from identity; no timestamp
  joins). Assigned (plan's router decision + binding) vs executed (ledger) vs verification
  (envelope's modelBinding, UNRECORDED when absent) — three facts, never collapsed. Totals
  reconcile against child runs or say so; cost is summed only from provider-reported figures in
  one currency, else COST UNAVAILABLE with tokens still measured. Job state is read from the job
  row — team completion never infers it.
- **API**: GET `/api/brain/executions` (+`/:id`) — the UI consumes one coherent truth.
- **UI**: `/brain` RECENT WORK panel → `/brain/executions/[id]` drill-in: real-timestamp CSS
  timeline (parallelism visible), member cards with the three binding lines, refusals on failed
  members, artifacts by identity (kind, id, bytes, created; consumers stated as unrecorded —
  queued for the knowledge graph), dissent VERBATIM or its absence stated, totals with the
  reconciliation note. Raw model prompts are deliberately not rendered.

## Evidence

- Unit (seeded through the runtime's own writers): id-exact role attribution; binding classes;
  failed member visible with refusal; **retry latest-wins as one truthful row (#13)**; totals
  reconcile (#11); job-above-team (#2). Full suite after the leg: **159 files / 1822 passed / 0 failed**, tsc clean. Two honest guards fired on the new dynamic route
  (route-sample + nav-coverage) and were satisfied with stated reasons.
- **E2E — the first LIVE team execution in the product's history** (all prior Team OS proof used
  injected deterministic cores): 4 real model calls, ~37s team wall, 4 members COMPLETED, 4
  artifacts, totals reconciled (6,281 tokens, $0.58 provider-reported USD). Two clean runs
  (1.2m / 1.0m), each minting its own fresh live TeamRun; acceptance #1-#17 asserted on the
  rendered tree, #14 by reload, #16 by pageerror capture.
- **The live run validated the dissent architecture in the most literal way possible**: the
  source verifier and critic INDEPENDENTLY identified the TEST_MODE fixture data as synthetic
  ("RSI pinned at 100… perfectly linear +0.77 daily increment… fixture identity"), both
  dissented, the chief preserved both dissents verbatim and downgraded the recommendation to
  NEEDS_MORE_EVIDENCE. The team caught the fixture being fake — which is simultaneously
  acceptance #9 (dissent survives), #15/#18 (no fake data passed off as real; fixture explicitly
  recognized AS fixture), and the whole point of the architecture.
- **Acceptance #20 — full Master Golden rerun** on a fresh production build + virgin DB via the
  real entry point, doubling as the consolidation gate for all five post-baseline legs (crash
  matrix, strategy progression, sealed holdout, provider transports, brain observability):
  RESULT RECORDED BELOW.

## Master Golden run 5 — what the consolidation run found

Run 5 (virgin `master-run5.sqlite`, fresh production build, real entry point) was stopped at
test 170/221 once its results no longer described the tree: five failures had been diagnosed and
the fixes for them changed source the run could not see. Its value was the diagnosis, and it
earned its hour:

| # | Test | Cause | Class |
|---|---|---|---|
| 45 | `brain-executions` | The spec boots its OWN `next dev` server; inside the master run that cold compile under full load blew the 240s readiness budget (`server on 60805 never became ready`, stderr empty). | **Real — the spec's** |
| 93 | `interaction` mobile overflow | `/command` at 413px against a 391px viewport. Binary-searched to `ol[data-testid=activity-feed]`: a 55-character authored strategy id (`gap_and_volume_screen_desktop_chromium_mstgkd94_ab3b77c3`) with no break opportunity. Data-dependent, which is why run 4 hit `/strategies` instead. | **Real — the product's** |
| 135, 136, 171 | BECTORFOOD, JYOTHYLAB, GAIL | `net::ERR_NETWORK_IO_SUSPENDED` — Chromium reporting that the OS suspended network I/O. Three independent occurrences across two suites at ~03:30 local. | **Environmental** |

The environmental class was NOT accepted on assertion. A CPU-starvation hypothesis (a concurrent
`tsc`) was raised and then **refuted by the evidence**: `ERR_NETWORK_IO_SUSPENDED` is a power-state
error, not a load error, and CHAMBLFERT — the same small-cap slow research path — passed seconds
after BECTORFOOD failed. Run 6 therefore holds the machine awake for its duration via
`SetThreadExecutionState` (a runtime request that releases itself on exit; the owner's power plan
is not edited).

## Master Golden run 6 — the fix that had a side effect

Run 6 carried every fix above and cleared test 45 in seconds (the ambient-server change worked).
Then the golden-journey suite began failing — 64, 67, 69, 70, 71 — with three different symptoms:
a research state of FAILED, a missing forward challenger, and an `ECONNRESET` on
`POST /api/strategy/author`.

The first hypothesis was that the new fail-closed holdout boundary had blinded the gauntlet below
its trade floor. **The database refuted it**: `holdout_definitions` held zero rows, so
`activeSealFor` returned null on both sides of the change and the two code paths were identical.

The actual cause was the ambient-server fix's own side effect. The spec starts the machine
(`POST /api/system/start`) and, on its own throwaway server, the process kill took it down with
it. On the SHARED acceptance server nothing did: `autonomous_runs` showed
`arun_8b73d8138660428b` (runtime_profile `default` — this spec's) still **RUNNING at 15 ticks**,
driving cycles and competing for the same real `claude-code` calls the journey chains need, while
every other spec's run sat STOPPED with reason "test teardown". Server-side model calls were
taking 58–70s under that contention.

The spec now stops the machine in its `finally`, like every other spec that starts one. Run 6 was
stopped at 68/221 rather than burning an hour proving a defect already understood, and run 7 is
the authoritative attempt. No rebuild was needed — the change is test-only.

The whole class was then closed rather than just this instance: every spec that calls
`/api/system/start` was audited for a matching stop — `auto-mode-concurrency` 1/3,
`autonomous-master-runtime` 2/2, `brain-executions` 1/1, `crash-matrix` 1/1, `crash-recovery` 1/1.
No other spec leaks a machine onto the shared server.

## Master Golden run 7 — the mobile overflow is one defect wearing three costumes

Run 7 carried the teardown fix and the journey suite came back **entirely green**: all eight
lifecycle chains (67–74), all three core journeys (64–66), and the consolidation check (75). The
fix was confirmed at the ledger, not inferred: this spec's machine finished `STOPPED` with reason
"test teardown" at 1 tick (run 6 left it RUNNING at 15), and zero machines remained running.

One failure survived, and it is the same defect for the third time. `/command` now passed, so the
test progressed to `/strategies` — 411px against a 391px viewport. Binary-searched to
`li[rehearsal-ledger-row] > span.font-bold` holding
`gap_and_volume_screen_desktop_chromium_mstjka35_8aa65953`: a ~55-character authored strategy id.
As a flex item it will not shrink below its content (`min-width: auto`), and the id offers no
break opportunity, so one row widens the page.

Three sites now (holdout panel + validation funnel, activity feed, rehearsal ledger) share one
cause: **raw strategy ids rendered into flex rows**. Each was fixed where it renders rather than
by a global rule, because `overflow-wrap: anywhere` changes intrinsic min-content sizing and a
blanket application during a verification run is a larger blast radius than the bug. The fix was
verified before rebuilding by injecting exactly the committed rule into the live page and
re-measuring: **411 → 390**, one fix sufficient on this data. The other two routes the mobile test
walks (`/paper`, `/data-quality`) were probed at the same time and are clean.

Run 7's second failure was a budget, not a bug, and the ledger settled it. TITAN sat at
`RESEARCHING` past the matrix spec's 90s poll — but `agent_runs` shows that research **COMPLETED**
in 104s (23:08:46 → 23:10:30), while the same instrument settled in 36s on an earlier pass in the
same run. Real model latency spans roughly 36–104s, so a 90s poll fails intermittently on a system
that is working correctly. The budget is now 150s poll / 180s test — **the figure its sibling spec
`nse-30-stock-stage2` already proved for the identical post-ingestion research path**, not a number
invented to make a failure go away. The assertion is untouched: a run that never settles still
fails, and the measurement is recorded in the spec so the next reader does not have to re-derive it.

A **fourth site was then found proactively, not by a failing test.** Because the rebuild for run 8
was about to happen anyway, the other phone-relevant pages were probed while the window was free:
`/jobs`, `/memory`, `/experiments` and `/learning` measured clean — and **`/brain` rendered 782px
wide on a 390px viewport**, more than double. Its activity grid quotes strategy ids verbatim
(`deep_journey_gap_jyothylab_mstjkez4_3d0df7d5`) into cells that cannot shrink below their content,
so the cockpit this entire leg exists to make readable was the worst offender on a phone, and no
test looked. Fixed the same way and verified by injection (782 → 390), and **`/brain` is now in the
mobile route list** so it cannot regress silently. The lesson generalises: the mobile overflow test
guards four routes out of twenty-odd, so absence of a failure there was never evidence of absence.

Worth the owner knowing: an id that long is itself a product smell — it embeds the Playwright
project name (`desktop_chromium`) because authored names are derived from their originating
context. Wrapping is right (truncation would hide *which* strategy is being discussed), but
shorter authored ids would end this class of bug outright. Not done here: renaming identifiers
during a verification run would invalidate the ledger those runs are proving.

## Pre-commit adversarial review — what four independent lenses found

Before committing, the uncommitted set was reviewed by four independent read-only lenses
(read-model correctness, UI truth, test truth, holdout boundary), each finding then handed to a
skeptical verifier instructed to refute it. Seven findings survived refutation; all seven are
fixed here. The one that matters:

**CRITICAL — a holdout contamination path this leg introduced.** The sealed-holdout development
exclusion had been narrowed to an allowlist of development actors
(`rehearsal`/`backtest`/`validation`/`research`) so the forward shadow could see the live stream
again. That list is **fail-open**: `gauntlet` — which spends a permanent statistical trial and
selects on what it sees — was not on it, and neither was `statarb-formation` (pair mining is
strategy search). With a seal live, the gauntlet replayed straight across the sealed window.
Proven before fixing: the regression failed with `actor "gauntlet" saw 94 sealed bar(s)`.

The fix inverts the boundary to **fail-closed**: `SEAL_SIGHTED_ACTORS` now allowlists the two
CONSUMPTION stages (`forward-shadow`, `paper-forward`) and everything else — including any actor
added by someone who never reads that file — is development and cannot see the sealed region. A
forgotten actor now loses recent bars (visible, recoverable) instead of silently contaminating the
holdout. The test pins five actors including a deliberately invented future one.

The other six, all fixed and pinned:

- **Members vanished from an interrupted run.** `createTeamRun` opens the row with an empty member
  list; only completion fills it. A kill between members finishing and the team closing rendered
  zero members holding N artifacts — the tree shrinking exactly where an operator is looking at
  what died. The member set is now the union of what the row names, what the plan's roles resolve
  to, and who produced the artifacts, with unnamed candidates admitted only if the ledger holds them.
- **A reconciliation claimed but never performed.** When a provider reports no usage the runtime
  still writes a summed `0` to the team row while every child reads null; `reconciled` defaulted to
  `true`, printing "Tokens: 0 (reconciles with members)" over nothing measured. `reconciled` is now
  `boolean | null` and the panel renders NOT COMPARABLE.
- **Cost honesty**: "COST UNAVAILABLE (tokens measured; no pricing source)" was asserted even when
  no tokens were measured; the no-usage case now says so.
- **A failed run's artifacts showed as 0** in RECENT WORK, because `failTeamRun` never fills
  `artifactIds`. The summary now counts from the artifact ledger, agreeing with its own drill-in.
- **The spec's "no console errors" could not fail on a console error** — only `pageerror` was
  listened for. Both are captured now.
- **The spec could land on a foreign execution** once it stopped booting its own server; it now
  records pre-existing executions and asserts on the row it caused, by id.

Empirically fail-first proven: the holdout regression. Structurally certain (assertions target the
exact rewritten lines): the three read-model regressions.

## Master Golden run 8 — the first fully green consolidation run

Run 8 (fresh production build after the run-7 fixes, virgin `master-run8.sqlite`, keep-awake held):
**210 passed / 2 skipped / 0 failed in 54.4m — mobile INCLUDED and passing**, confirming the
run-7 overflow fixes on all five mobile routes. The 2 skips are the two deliberate in-suite
`app.spec.ts` skips, present in every run.

## Master Golden run 9 — the budget class returns one tail wider

Run 9 (same tree; mobile excluded by owner instruction → 210 collected): **206 passed / 2 failed
(57.0m)**. Both failures are ONE root cause, settled by the ledger, not intuition:
`agent_runs` shows HCLTECH's post-ingestion research **COMPLETED / SOURCE_VERIFIED in 208s**
(`agr_68c76e0185d546c9`, 3,910 tokens, real claude-sonnet-5) while the stage2 spec polled 150s —
the identical "budget, not bug" class run 7 met at 104s (TITAN), now measured at 208s. The second
failure is the stage2 completeness gate correctly cascading on the missing thirtieth outcome
("30 researchable but only 29 carry a research outcome"). The fix resizes the four specs sharing
the 150s research wait (stage2, matrix, meeting-journey, golden-journey) to a **300s wait (~1.4×
the measured tail)** with remainder-preserving ceilings (330s; golden-journey chain 420→570s).
Assertions untouched — a run that never settles still fails, just later; the measurement is
recorded in-spec. Spec-only change: no rebuild, but the two-clean-run count reset to runs 10+11.

## Master Golden run 10 — the budget class at full data volume

Run 10 (six launch attempts; the sixth ran): **207 passed / 1 failed / 2 skipped (1.2h)**. The one
failure is the second budget-class instance: the replay-mode UI note waits on a forward pass
MEASURED at 7.2–8.0s server-side at master-run data volume (three timed passes on the exact
end-state server+DB) against the 10s `toContainText` default; the API sibling passed seconds
later, no machine leaked (8/8 autonomous runs STOPPED), no error element — the button still
`[disabled]` at failure means the pass was in flight, not failed. Fix: explicit 30s budgets on
the two note waits (~3.5× the measured tail), measurement recorded in-spec, assertions unchanged.

## Master Golden run 11 — the ECONNRESET diagnostic

Run 11 (diagnostic) failed ONLY test 38: the concurrency spec's status poll read ECONNRESET on
the INTERACTIVE launch too, killing the launcher-context theory — 3 of the day's 4 executions
failed this way (both launch contexts) after 0-of-6 across runs 4–9, always this spec, always an
idempotent polling GET, server alive and serving the same URL within seconds each time;
TIME_WAIT pressure ruled out (44 sockets). Fix: `getJson()` in the spec retries ONCE on that
specific signature for its polling reads (status ×2 sites, cycles, research/jobs) — a real
outage fails the retry too; every assertion unchanged.

## Master Golden run 12 — compile in the readiness path

Run 12 (virgin `master-run12.sqlite`, build `973852a-dirty.4920d47e`): **207 passed / 1 failed /
2 skipped (1.1h)**. The failure was provider-transports: its child `next dev` "never became
ready" in 240s with stderr empty — and the forensics show the child alive and MID-COMPILE when
killed (its dist manifests written 16:28–16:29, trace at 16:32). The cause is structural, not a
budget: each crash-spec dev boot auto-appends its fresh random `.tmp/crash-dist-*` dist dir to
tsconfig.json (observed mid-run at 15:37), which invalidates the Turbopack cache, so the
provider-transports boot degraded from a warm ~37s to an unbounded full recompile under co-load
(36.9s → 36.9s → 57.1s → >240s across runs 8/9/10/12) while queue-tail model calls ran on the
ambient server. No honest budget exists for an unbounded compile, and the repository had already
learned this lesson once (run 5, brain-executions). Fix: the spec boots `next start` on the
prebuilt acceptance dist when it is on disk — no compile in the readiness path, and the child
runs the EXACT build under acceptance — keeping `next dev` for standalone use. Proven standalone
×2 (38.4s cold / 11.8s warm; child identity-ready in 7s), then in-run (32.5s run 13, 31.3s
run 14). A torn `routes.d.ts` from the killed compile also broke `tsc` repo-wide; the generated
file was deleted and `tsc` returned to silence.

## Master Golden runs 13 + 14 — the clean pair

Run 13's first attempt died at its 68th test (12 minutes in) with every node process terminated
within seconds — no crash dumps, no WER entries, no OS events; the runner's dying line printed a
0ms failure with no error section. Launcher-environment class (saga defect 6 below), not a tree
defect; the attempt's logs are preserved as `.tmp/master-run13-attempt1-killed.log`. Both verdict
runs then went through the hardened detached launcher (`run-master.ps1`: keep-awake, Normal
priority, pin before server start, cmd-level file redirection, handle-based teardown):

- **Run 13: 208 passed / 2 skipped / 0 failed (57.1m)**, virgin `master-run13.sqlite`, `EXIT=0`.
- **Run 14: 208 passed / 2 skipped / 0 failed (58.3m)**, virgin `master-run14.sqlite`, `EXIT=0`.

Both on build `973852a-dirty.4920d47e` (identity-gated with a pre-server pin), both with the
2 deliberate in-suite `app.spec.ts` skips, zero failures, and the launcher surviving to run its
own teardown and write its exit marker. The tree did not change between the runs.

## The launcher saga — six environment defects, zero tree defects

Between runs 9 and 10, five launch attempts died without a single product failure. Recorded so
the next operator does not relearn any of it:

1. **Claude session teardown kills "detached" children on Windows** — `( nohup … & )` survives
   only while the launching session lives. Two runs died this way (one at 145/0 — every test
   green until the kill).
2. **Task Scheduler starts jobs BelowNormal** and children inherit it; the starved server RST a
   connection under the concurrency spec's load (`read ECONNRESET` on `/api/system/status`).
   Fixed by setting the script and server to Normal.
3. **PowerShell `-RedirectStandardOutput` pumps stdout through pipes**; a lagging pump blocks
   node mid-write and a stalled event loop resets sockets — same ECONNRESET signature at Normal
   priority. Fixed with cmd-level file redirection (the shape all nine interactive runs used).
4. **A zombie launcher's teardown `taskkill /PID` landed on a REUSED pid** and annihilated its
   successor's fresh tree at test 8. Fixed with a handle-based `HasExited` guard — never kill a
   pid you merely remember.
5. **Task Scheduler's laptop power policy** (`StopIfGoingOnBatteries`, default true) killed an
   entire healthy tree — runner, server, launcher — 35 tests in, markerless. The task is now
   battery-hardened, but the verdict runs returned to the interactive launch shape with nine
   clean runs of history; the scheduled task remains only as a documented fallback.
6. **Processes spawned as direct children of a harness tool call do not outlive the harness's
   task cleanup.** Run 13's first attempt was launched with plain `nohup … &` inside a tool
   call; 12 minutes and 67 green tests later every node process was terminated within seconds —
   no crash dumps, no OS events, keep-awake and unrelated processes untouched. The shape that
   survives is `run-master.ps1`'s: a detached PowerShell whose server and runner are grandchildren
   through `cmd /c` with file-level redirection — runs 12/13/14 all rode it; 13/14 to `EXIT=0`
   markers. Corollary learned the same hour: that detached PowerShell inherits no useful PATH, so
   the node directory is prefixed explicitly at launch.

None of these six touched `lib/`, `app/`, `components/`, or `e2e/` behaviour under test — each
was fixed in the launcher, not the tree.

## Independent claim verification (pre-commit, 14 agents)

Every claim in the drafted commit message was verified against the tree by six independent
readers plus adversarial refuters on the load-bearing confirmations: **20 of 23 confirmed**, and
the three refutations were absorbed before commit:

1. **KNOWN RESIDUAL (queued, not fixed here): the all-unmeasured COMPLETED team.**
   `runTeam` sums member tokens with `?? 0` (team-runtime.ts:488), so a COMPLETED team whose
   members all report no usage writes tokens=0 — which the drill-in reads as measured
   (`totals.tokens !== null`) and renders "COST UNAVAILABLE (tokens measured; no pricing
   source)" over nothing measured. The FAILED/interrupted no-usage path IS fixed and renders
   "no usage reported by the provider". Neither COST UNAVAILABLE string is test-pinned, and the
   doc comment at execution-trace.ts:71 still describes the old behaviour. Fixing this touches
   `lib/` and would reset the two-clean-run pair, so it is queued as the first post-commit item
   rather than smuggled in. The commit message states the residual.
2. The matrix spec's pre-resize wait was **90s**, not the 150s the sibling specs shared — the
   commit message and this document now say so precisely.
3. The golden-journey diff also carries the intended run-4-family 5m gap-session seeding
   (`e2e/lib/gap-sessions.ts`) — named in the commit message rather than riding silently.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE.**

The C36/C50 requirement — two consecutive clean Master Golden runs on one unchanged tree — is
met by **run 13 (208 passed / 2 skipped / 0 failed, 57.1m)** and **run 14 (208 passed /
2 skipped / 0 failed, 58.3m)**, both against build `973852a-dirty.4920d47e` on virgin,
identity-gated databases, with the launcher's own `EXIT=0` markers. Supporting evidence: units
160 files / 1829 passed / 0 failed, `tsc` silent, production build clean, and every failure in
runs 4→12 root-caused with ledger or filesystem evidence rather than retried (three spec-budget
resizes sized to measured distributions, one spec architecture fix, one idempotent-retry
hardening, six launcher-environment defects — zero product defects after run 7).

**The defined scope excludes mobile.** Runs 9→14 ran `--grep-invert "mobile"` by owner
instruction, so mobile behaviour is UNPROVEN in this verdict's pair. The one mobile-inclusive
green run remains run 8 (210 passed / 2 skipped / 0 failed, 54.4m) on the pre-resize tree; the
resizes and the provider-transports boot change touch no mobile-rendering path, but that is an
inference, not a run. Mobile re-inclusion is a one-flag change when the owner asks for it.

Also explicitly out of this verdict: the KNOWN RESIDUAL above (the all-unmeasured COMPLETED
team's tokens=0 reads as measured) — queued as the first post-commit item, stated in the commit
message.
