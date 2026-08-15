# PHASE 8 + 9 — THE TWO CONSECUTIVE CLEAN ACCEPTANCE RUNS

Paste everything below the line into Claude Code (or any Fable-5-capable harness) in
`E:\BoraTradingTool`. It is self-contained: it does not assume the pasting session remembers
anything from a previous one.

---

## ROLE

You are executing the FINAL acceptance gate of the MarketPulse OS build: two consecutive clean
Master Golden runs on one unchanged tree (masterclass C36/C50). You are not adding features. You
are proving — or failing to prove — that the tree already on disk is sound.

Do not ask routine permission. Do not stop after run 8. Do not summarize this file back. Begin.

## THE ONE RULE THAT OUTRANKS EVERYTHING

This system has **no broker adapter and places no orders**. `/api/trade/place` returns
`EXECUTION_ADAPTER_MISSING`. If you find yourself reasoning about how to place a trade, stop —
that is not a capability here. Paper and forward evidence only.

Protected, read-only (hook- and test-enforced): `lib/governance/**`, `lib/security/**`,
`lib/trading/capabilities.ts`, `lib/paper/risk.ts`, `lib/quantcore/contract.ts`, `.claude/hooks/**`,
`.mcp.json`, `mcp/**`, `dist/mcp/**`, `esbuild.mcp.mjs`, `.github/workflows/**`, `.env*`, and any
**applied** migration in `drizzle/`.

## MOBILE IS OUT OF SCOPE FOR THIS PHASE

Owner instruction: **no mobile tests.** Exclude them — do not delete them, do not weaken them,
do not mark them skipped in source. Exclude them at the runner with `--grep-invert "mobile"`.
Every command below already does this. If a mobile test somehow runs and fails, it does not
block this phase; record it and move on.

## STATE YOU ARE INHERITING (verify, do not trust)

- Branch `checkpoint/m5-research-bridge-verified`, last commit `973852a`, working tree DIRTY on
  purpose: the brain-observability leg plus this session's fixes are **deliberately uncommitted**
  until two clean runs land. A CRITICAL holdout regression was found in this set; committing
  before proving the fix would have written it into history.
- Already verified on this exact tree: units **160 files / 1829 passed / 0 failed**, `tsc` clean,
  production build clean, and **Master Golden run 8 fully green — 210 passed / 2 skipped /
  0 failed (54.4m)**.
- So run 8 is ALREADY DONE AND GREEN. **Your job is the second clean run and the commit.**
  If you cannot confirm run 8 from `.tmp/master-run8.log`, run it again rather than assuming.
- Full narrative, including every defect found and why: `docs/plans/brain-observability/07-final.md`
  and `docs/fable5-ultimate/00-STATE.md`. Read both before touching anything.

## STEP 1 — CONFIRM THE BASELINE IS REAL

```bash
cd /e/BoraTradingTool
git status --short --branch
grep -aE "[0-9]+ (passed|failed)" .tmp/master-run8.log | tail -3     # expect: 0 failed
npx vitest run                                                       # expect: 0 failed
npx tsc --noEmit                                                     # expect: silence
```

Zero tests collected is a FAILURE, not a pass. If anything here is not clean, stop the phase and
fix it first — a second "clean run" on a tree whose units are red proves nothing.

## STEP 2 — HOLD THE MACHINE AWAKE

Three failures in an earlier run were `net::ERR_NETWORK_IO_SUSPENDED` — Chromium reporting that
the OS suspended network I/O mid-run. That is the machine dozing, not the product failing.

```bash
(nohup powershell -NoProfile -ExecutionPolicy Bypass \
  -File "C:/Users/marke/.claude/jobs/bb76921e/tmp/keep-awake.ps1" > .tmp/keepawake.log 2>&1 &)
```

This is a RUNTIME request (`SetThreadExecutionState`) that releases itself when the process exits.
**Never edit the owner's power plan to achieve this.**

## STEP 3 — RUN 9 (THE SECOND CLEAN RUN)

Same tree as run 8. Fresh server, virgin database, identity pin computed BEFORE the server starts.

```bash
# 1. Free the machine
for pid in $(wmic process where "name='node.exe'" get ProcessId,CommandLine 2>/dev/null \
  | grep -i playwright | grep -oE "[0-9]+\s*$" | tr -d ' '); do taskkill //F //T //PID "$pid"; done
for pid in $(netstat -ano | grep ":3100" | grep LISTENING | awk '{print $NF}' | sort -u); do
  taskkill //F //T //PID "$pid"; done

# 2. Virgin database
rm -f .tmp/master-run9.sqlite*

# 3. Pin identity BEFORE the server starts (a pin that postdates server start is REFUSED — that
#    refusal is the gate working, not a bug to route around)
PIN=$(python -c "import datetime;print((datetime.datetime.utcnow()-datetime.timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")

# 4. Server on the EXISTING build — do NOT rebuild; the tree must not change between the two runs
MARKETPULSE_DB_PATH=E:/BoraTradingTool/.tmp/master-run9.sqlite \
MARKETPULSE_NEXT_DIST_DIR=.tmp/next-e2e-30stock \
MARKETPULSE_TEST_MODE=1 QUANT_CORE_URL=off \
nohup node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100 \
  > .tmp/master-run9-server.log 2>&1 &

until curl -sf -o /dev/null http://127.0.0.1:3100/api/system/status; do sleep 2; done

# 5. The run itself — mobile excluded per owner instruction
(MARKETPULSE_E2E_BASE_URL=http://127.0.0.1:3100 \
 MARKETPULSE_E2E_DB_PATH=E:/BoraTradingTool/.tmp/master-run9.sqlite \
 MARKETPULSE_E2E_EXPECT_STARTED_AFTER=$PIN \
 nohup npx playwright test --project=desktop-chromium --grep-invert "mobile" \
   > .tmp/master-run9.log 2>&1 &)
```

Notes that cost real hours to learn:
- `nohup npm run ...` dies silently on Windows. Call `npx playwright test` directly.
- Launch detached inside `( ... &)`. Harness-tracked background jobs get cleaned up mid-run;
  detached processes survive.
- The owner's own dev server on **:3000** must not be touched. Only :3100 is yours.

## STEP 4 — WATCH WITHOUT BURNING THE MACHINE

Poll; do not run anything CPU-heavy (no `tsc`, no build, no unit suite) while the run is live.

```bash
grep -aE "[0-9]+ (passed|failed|flaky|skipped)" .tmp/master-run9.log | tail -3
```

Expect roughly 55–60 minutes and ~212 tests.

## STEP 5 — IF ANYTHING FAILS, ROOT-CAUSE IT. NEVER RETRY BLINDLY.

For each failure read `test-results/<dir>/error-context.md`, then classify with EVIDENCE:

| Evidence you find | Class | What to do |
|---|---|---|
| `net::ERR_NETWORK_IO_SUSPENDED` | Environmental — the OS dozed | Confirm keep-awake is held; rerun |
| A ledger row shows the work COMPLETED, just slower than the poll | Budget, not bug | Size the budget to the MEASURED distribution, record the measurement in the spec, leave the assertion untouched |
| Server log shows a crash/exception | Real product defect | Reproduce → failing regression test → fix → rerun |
| Element/state assertion fails with the server healthy | Real defect | Same loop |

Forbidden, always: weakening an assertion, `test.skip` on a failing test, raising a timeout to hide
a hang, deleting a test, or calling a fixture "real market verification".

The database is the arbiter, not intuition. Read it before theorising:

```bash
python -c "import sqlite3;c=sqlite3.connect('file:E:/BoraTradingTool/.tmp/master-run9.sqlite?mode=ro',uri=True);print(c.execute('SELECT status,COUNT(*) FROM research_jobs GROUP BY status').fetchall())"
```

**Any source change invalidates both runs.** If you change app code you must rebuild
(`MARKETPULSE_NEXT_DIST_DIR=.tmp/next-e2e-30stock MARKETPULSE_TEST_MODE=1 npx next build`) and then
do TWO fresh clean runs on the new tree. Two clean runs mean two on the SAME tree.

## STEP 6 — WHEN RUN 9 IS GREEN, COMMIT

Only when runs 8 and 9 are both `0 failed` on the same tree:

```bash
git add -A
git commit -F "C:/Users/marke/.claude/jobs/bb76921e/tmp/commit-msg.txt"
```

That message is already written and describes the real evidence. Read it before committing; if
anything in it is no longer true, correct it rather than committing a claim you cannot support.
Do not push. Do not merge to main.

## STEP 7 — THE VERDICT

Update `docs/plans/brain-observability/07-final.md`:

- Replace the `PARTIALLY_VERIFIED — pending run 6/7` block with the real result.
- State both run numbers, their exact counts, their durations, and the build id both ran against.
- Use exactly one of: `VERIFIED_FOR_DEFINED_SCOPE`, `PARTIALLY_VERIFIED`, `NOT_VERIFIED`.
- **Mobile is now an explicit gap in the defined scope** — it was excluded by owner instruction,
  so the verdict must say mobile behaviour is unproven in this phase rather than implying coverage.

Then update `docs/fable5-ultimate/00-STATE.md` (current state + exact next action) and add the
DONE line to `docs/autonomous-build/WORK_QUEUE.md`.

## STOP CONDITION

Stop only when one of these is true:

1. Runs 8 and 9 are both green on one unchanged tree, the work is committed, and the verdict is
   written; **or**
2. A failure needs an owner decision you cannot make (credentials, paid data, real-money
   authorisation, a legal question). Then state precisely what is blocked, what is NOT blocked, and
   what you completed anyway.

Do not stop because documentation is written, because one run was green, or because it is taking a
while. Do not claim a clean run you did not observe in the log.

## AFTER THIS PHASE — WHAT IS NEXT (do not start it here)

Infrastructure is FROZEN by owner order. The next scoreboard is quant quality:

> Which strategy families, if any, survive gauntlet → sealed holdout → forward → paper after
> realistic costs across genuinely independent NSE data?

Anything that adds a subsystem instead of answering that question is out of order.
