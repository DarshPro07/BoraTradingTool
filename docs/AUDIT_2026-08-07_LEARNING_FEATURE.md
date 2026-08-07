# LEARNING FEATURE AUDIT — 2026-08-07

Scope: verify what `/learning` (the autonomy + study + knowledge loop) actually does, whether
it "trains" anything, and audit the surrounding plot code, the claimed "fever" file, and the DP
(data pipeline).

## Verdict

**It is not faking, and it is not training a model. It is a real, deterministic
evidence/governance loop.** It runs on a genuine schedule, rehearses real strategies against
real candles, writes an audit trail, and never changes its own policy. The "learning" in
`/learning` is knowledge *management and rehearsal*, not weight-fitting — and there is a
material dead feature inside it.

## What actually runs (proven, not assumed)

| Claim | Evidence |
|---|---|
| Autonomous loop runs | 165 `learning_cycle` rows in `audit_events`; UI header `24 cycles today` |
| Durable scheduler | Windows Task Scheduler task `MarketPulse Cycle` is **registered and Ready** (Next Run 2:11 PM). UI shows `(scheduler)` runs alongside `(browser)` |
| Cycle performs real work | Live run via `RUN ONE CYCLE` → `Rehearsed 5 candidate(s). Would survive the battery: sma_cross_20_50 (89 trades / 12 instruments), sma_cross_ui_probe` |
| Rehearsal is honest | says "A rehearsal is not evidence — the gauntlet still has to be run deliberately." Records **nothing** back (`recordedNothing` invariant in tests) |
| Research drain | `Processed 0 research job(s)` every cycle. `research_jobs` table is empty (0 rows) — nothing enqueues via UI; the only writer is MCP tool `marketpulse_enqueue_research` or `POST /api/research/jobs` |
| System state | `2 finding(s), 1 needing attention, across 47 memory nodes` — introspection works |
| Quant core | `reachable:false` — Python sidecar not running; candidate review skipped rather than guessed |

## Is it actually training?

**No model, no weights, no fitting — by design, and it is explicit in the code and UI.**
The page states "It cannot read papers unattended: there is no model inside this
application." What the loop actually does per cycle (from `lib/learning/cycle.ts` + DB trail):

1. Collect state (strategies, proposals, study queue, mastery).
2. Introspect memory → orphan/stalled findings.
3. Drain research queue (external agents must fill it).
4. Rehearse up to N candidate strategies against live candle data.
5. Record the run in `audit_events` (never mutates strategy state).

Nothing the loop does feeds back. Rehearsal "would pass" means *a human is told to run the
gauntlet spuriously*. Promotion from `draft`→`validating`→`paper_challenger` still requires
the owner running the deliberate gauntlet (verified earlier: rsi_reversion_30 → rejected,
DSR 0.936 < 0.95 approval line, held out for 2 weeks).

## UPDATED 2026-08-07 (second pass, live UI study test): the producer now EXISTS

The original finding below ("no production caller") was correct at the time but is now
**stale**. The working tree contains an untracked producer: `lib/learning/study.ts`
(which self-documents as "the producer recordQuizResult never had"), the API route
`app/api/study/route.ts`, and `components/learning/StudyPanel.tsx`.

Live-proven end-to-end (dev server, Playwright):

- `/learning` renders STUDY QUEUE; `GET /api/study` returns a recall card
  ("Lookahead bias").
- Reveal -> "I knew it" -> "Correct. Recorded from your own report. Mastery 100% over
  1 attempt(s). Due again in 2 days. Next card".
- After reload a new card appears ("Indicator warm-up sufficiency").
- DB now has: `knowledge_mastery` 1 row
  `{"concept_id":"cpt_0f64110282e248d3","attempts":1,"correct":1,"score":1,
  "last_reviewed_at":1786106812,"next_review_at":1786279612}` — spaced repetition
  advances (next due +2 days).

**Remaining gap (still real): `knowledge_quizzes` still has no production writer**
(only `study.test.ts` inserts). Quiz cards can never appear — `nextStudyCard` always
picks `recall` (`study.ts:87`), so every card degrades to recall/self-report mode.
Curriculum/quiz-bank seeding + a quiz-grade writer is the missing piece.

## Original finding (superseded by the update above)

`recordQuizResult` in `lib/learning/curriculum.ts` had zero production callers (only
`learning.test.ts`); `knowledge_mastery` and `knowledge_quizzes` were both 0 and the
STUDY QUEUE rendered "never studied" forever. Fixed in the working tree by the
untracked study producer above; the quiz-bank half remains unwritten.

## FEVER file

**Does not exist.** `rg -i "fever"` over the entire repo — zero matches. There is no fear
"verbatim" file by any name. (User belief contradicted; checked exhaustively.)

## Plot code

- `components/plot/Distribution.tsx` + `EquityCurve.tsx` exist and are real (histogram,
  `equityCurve`/`positionOf` in `lib/ui/plot.ts`).
- **Neither is used on `/learning`.** They render on strategy/gauntlet pages. The learning
  page shows stat tiles, policy dump, introspection, live terminal — no chart.

## DP (data pipeline) — incomplete pieces

- `lib/learning/dataset.ts` loads candles via `marketCandleLoader` → Yahoo; `getNormalizedCandles`
  involves a per-market circuit breaker (`failedUntil`/`marketIsCoolingDown`).
- DP is otherwise light: research intake (`humbled-trader-ai-pipeline`,
  `trade-ideas-scanner`) is a one-shot hardcoded ingestor, not a service.
- Rehearsal sample size = 12 instruments set; market-cap-dependent strategies are
  `not_evaluable` when the loader can't supply `market_cap` (3 of 6 specs).

## Untracked / reproducibility

- `app/api/cycles/` (the LiveTerminal data source) is **untracked** in git.
- `components/learning/LiveTerminal.tsx` is **untracked**.
- `app/learning/page.tsx` and `lib/learning/rehearsal.ts` show unstaged modifications.
- A `git checkout` / fresh clone therefore **breaks `/learning`** — the page imports the
  untracked LiveTerminal, and the build fails.

## Consistently strong

- Tests are real: 76 own learning tests; `tsc --noEmit` exit 0.
- The loop refuses to overreclaim: "rehearsal is not evidence", "candidate review skipped
  rather than guessed", "no proposals in learning mode".
- Policy enforcement (`AUTONOMOUS_PERMITTED` map in `lib/governance/policy.ts`): anything
  absent is **denied by default**; the page prints a NEVING PERMITTED list that matches DB trigger tests.
- Cycle writes `audit_events` with actor, action, decision, subject, duration — a clean,
  contradicting IO trail.

## Recommendations (ranked)

1. **Wire a producer for `recordQuizResult`.** Options: (a) MCP tool
   `marketpulse_study_session` that accepts user answers to current study queue items; (b)
   a `/api/learning/study` route the UI can POST to. Without it the curriculum/spaced
   repetition is dead weight dressed as a feature.
2. **Commit the untracked files** (`app/api/cycles/`, `LiveTerminal.tsx`) or the fresh-clone
   build is broken. This is the single highest-risk item.
3. **Seed research queue realistically** (or document `research_jobs` always 0). The loop's
   one genuinely "learning" input is currently empty forever.
4. **Run quant core / provider** so `candidate review` stops being "skipped rather than guessed"
   and library-data enlargement beyond Yahoo + FINNHUB keys can be exercised.
5. **Put a Distribution/EquityCurve chart on the live terminal** if graphs were expected there;
   today the page is chartless despite the generic reusable plotting code.

## External dependencies (for “not working” more fully)

- `FINNHUB_API_KEY` (in `.env.local`), `MARKETPULSE_OWNER_TOKEN`,
  `MARKETPULSE_AGENT_TOKEN` (only 3 keys in total).
- Windows Task Scheduler task `MarketPulse Cycle` (registered NOW, next run 2:11 PM).
- Python quant core sidecar (not running → `quantCore.reachable:false`).
- A model provider for MCP (by design none is bundled; learning input only from agents).