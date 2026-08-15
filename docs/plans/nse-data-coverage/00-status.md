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
      intraday marked "grows only by live accumulation". e2e green on a fresh DB AND a live
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
