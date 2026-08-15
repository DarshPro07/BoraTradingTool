# NSE Data Coverage Expansion — status

Owner directive 2026-08-16: coverage before trial spending. `MARKETPULSE_AUTONOMOUS_TRIALS`
stays 0 (untouched); AUTO keeps preparing candidates (scan → ingest → research → hypothesis →
strategy → rehearsal) without spending the statistical budget.

- [x] Gate 0 — reality (01-reality.md): the master already syncs the exchange's five official
      lists with series/assetType; the Dependency Resolver v2 already enqueues durable
      `ingest_history` jobs; its own in-code note named tonight's upgrade ("a readiness index /
      batch planner is the upgrade path when full-universe coverage matters")
- [x] Readiness index (`lib/market/universe-coverage.ts`): tier classification (MAIN_BOARD 2,122
      · SME 561 segregated · surveillance BE/BZ 292 · ETF 342 · REIT/InvIT 8 · inactive 15),
      derived readiness floors (60/250/340 daily bars + 20 accumulated 5m sessions, bases
      stated, validation floor marked provisional), typed missing reasons incl. durable ingest
      pipeline state — one grouped candle pass, no N+1. Units 4/4.
- [x] Deterministic batch planner (`planUniverseIngestion`): P1 = referenced by active
      strategies/challengers/watchlist or partially covered (finish what is started, rehearsal
      priority), P2/P3 = main-board expansion in stated deterministic order; SME/ETF/REIT/
      restricted never planned; in-flight/blocked/ready excluded; limit respected. Wired into
      `resolveUniverseDataGaps` (same signature, same cycle call-site, same quota) — the
      resolver test updated to pin the STRONGER property: each pass advances to the next batch,
      and the dedupe keys keep one durable job per instrument, ever. 18/18.
- [x] /brain NSE DATA COVERAGE panel: research universe measured (never extrapolated),
      readiness ladder with %s, typed missing-reason histogram, segregated universes stated,
      intraday sourced from historical backfill + live accumulation (corrected 2026-08-16 — see 02-correction.md). e2e green on a fresh DB AND a live
      production backup.
- [x] PBO threshold note recorded for NSE-QC-002 without touching the pinned campaign
      (docs/plans/quant-quality-program/06-pbo-note.md).

## Verification (Gate 5, inline for this read-model leg)

Units full suite **164 files / 1850 passed / 2 skipped / 0 failed**; tsc silent; live e2e twice
(fresh DB honest-empty; production backup real numbers). During verification the production
backup revealed the mission ALREADY MOVING: the owner's live server (AUTO on) had grown
coverage from 28 to **143 tickers ≥ 60 daily bars** over the evening (140 `ingest_history`
succeeded, 1 running, 4 queued) — main-board research coverage 118/2,122 = **5.6%** at
measurement (00:45 IST). The panel and this document state measurement-time numbers; the live
figure moves with every cycle pass. Verdict: **VERIFIED_FOR_DEFINED_SCOPE** (read-model +
planner + panel; the ingestion itself is the machine's continuing work, not this leg's claim).

## Exact next action

None for the builder — the machine expands coverage each cycle pass through the prioritized
planner, and the panel shows it. Owner switches remain: `MARKETPULSE_AUTONOMOUS_TRIALS=1` when
the READY_FOR_GAUNTLET pools justify spending; the AUTO-consumes-rejectionDiagnosis behavior
change is queued behind coverage (quant-quality-program/05-slices.md #4).

## Data OS v2 — the intraday correction leg (2026-08-16, second pass)

- [x] The wrong "cannot backfill" claim corrected everywhere (02-correction.md) — with probes.
- [x] **Root defect found and fixed while probing**: the intraday accumulator has ALWAYS
      requested 59-day windows, but the Yahoo range shortcut built `range=1d` for every 5m/15m
      call regardless, silently truncating 59 days to one — why intraday coverage grew one
      session per day. `getYahooCandles` now keys the shortcut on the requested window (≤5 days
      = live range semantics, byte-identical; wider = period-based). Fail-first proven (test
      failed against the stashed pre-fix provider), then live-proven through the exact lib path:
      2,903 5m bars / 39 sessions in one TCS call. The accumulator's NEXT session pass now
      backfills ~40 sessions per tracked instrument with NO new code — the backfill engine
      already existed; only the provider truncation hid it.
- [x] Deliberate scope cut, stated: no separate intraday ingest job/planner tier tonight — the
      accumulator owns intraday under its once-a-session, 12-instrument rate-limit discipline
      (a real past rate-limiting incident is recorded at its call site); widening that set is a
      later deliberate decision.
- [x] Second root fix: the learning-cycle tests violated their own "cycles must not reach the
      network" doctrine through the accumulation block (25 measured seconds of network in ONE
      test — passing only while the provider was fast). Accumulation is now the cycle's FOURTH
      injectable seam (beside loadCandles/loadEvidence/produce), stubbed in the suite like its
      siblings. Full suite went from 143-153s with 2 consistent timeouts to 97-103s green.
- [x] Connector roster with honest probe evidence: `docs/external/nse-data-connectors.md` —
      OpenChart 0.2.0 BROKEN tonight (charting API answers status:true/data:[] for everything;
      search ignores the query — a future connector must refuse non-exact matches), nsepython
      capability-limited, jugaad/NSEazy queued, Tier-3 archives research-only, AI-trader
      architecture-reference-only, Upstox V3 available pending owner credentials.
- Verification: yahoo-window tests 3/3 (fail-first proven); learning 23/23 hermetic; full suite
  **165 files / 1853 passed / 2 skipped / 0 failed** twice consecutively; tsc silent.
