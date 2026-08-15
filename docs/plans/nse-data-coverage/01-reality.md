# NSE Data Coverage Expansion — Gate 0 reality + design (2026-08-16)

Owner directive: trials stay OFF (`MARKETPULSE_AUTONOMOUS_TRIALS=0` — correct, untouched); the
bottleneck is DATA COVERAGE (28 research-eligible of 3,325 canonical). Mission: define the real
research universe, show coverage honestly, expand it deterministically, and let AUTO prepare
candidates without spending trials.

## What exists (all STATICALLY_CONFIRMED / OBSERVED on the production DB)

- **The master already categorizes the owner's NSE lists**: `security-master-bootstrap.ts`
  syncs the five official archives (MAIN/SME/ETF/REIT/INVIT CSVs) into effective-dated
  `nse_listing_versions` rows carrying `series`, `assetType`, `listingStatus`. Current
  distribution (production, effective rows): EQ/EQUITY 2,122 · SM+ST+SZ/EQUITY 561 (SME) ·
  EQ/ETF 342 · BE/EQUITY 253 + BZ/EQUITY 39 (trade-restricted surveillance series) ·
  IV/INVIT 5 · RR/REIT 3 · INACTIVE 15. `InstrumentClass` taxonomy already exists in
  `canonical-identity.ts`.
- **The Dependency Resolver v2** (`lib/brain/dependency-resolver.ts`) already: states a DATA
  requirement → enqueues a durable `ingest_history` job (dedupe key
  `ingest-history-<instrument>`, priority 140/150 below human 100), classifies
  SATISFIED/QUEUED/ACTIVE/COOLING/BLOCKED_PERMANENT/UNKNOWN_INSTRUMENT from durable rows. The
  cycle calls `resolveUniverseDataGaps({ quota: 30 })` each pass — currently the ALPHABETICAL
  head of the master, with an in-code ponytail note naming tonight's exact upgrade: "a
  readiness index / batch planner is the upgrade path when full-universe coverage matters."
- **Research floor**: `MIN_BARS_FOR_RESEARCH` (60 daily bars, `lib/research/bridge`) via
  `instrumentReadiness`. Candle store keys `IN:XNSE:SYMBOL`; 28 instruments ≥ 60 D bars; the
  intraday accumulator has real per-session 5m history (e.g. HDFCBANK 67 sessions — 5m history
  grows by live accumulation AND is historically backfillable — Upstox Historical V3 (minute candles from Jan 2022) and OpenChart both serve NSE intraday history; the "cannot be backfilled" claim in an earlier revision of this file was WRONG, corrected 2026-08-16).
- `nse_provider_mappings` is EMPTY in production — the connector resolves symbols directly, so
  "PROVIDER_MAPPING_MISSING" is not a real failure mode today and is NOT invented as one.
- Trial spending, forward enrollment and holdout looks remain owner-gated job kinds
  (`confirmed: true` / dedicated switch) — candidate PREPARATION is autonomous, spending is not.

## Design (freeze-compatible: one read-model, one planner behind an existing seam, one panel)

1. **`lib/market/universe-coverage.ts`** — the readiness index:
   - Tier classification per current listing: `MAIN_BOARD` (EQ+EQUITY+LISTED — the NSE-QC
     tradable research universe), `SME` (SM/ST/SZ — a SEPARATE research universe, never
     silently merged), `SURVEILLANCE_RESTRICTED` (BE/BZ), `ETF`, `REIT_INVIT`, `INACTIVE`.
   - Readiness classes with DERIVED thresholds, basis stated on each: `RESEARCH_READY`
     (≥ MIN_BARS_FOR_RESEARCH=60 — the bridge's own refusal floor), `BACKTEST_READY` (≥ 250 —
     one development year for walk-forward splits), `VALIDATION_READY` (≥ 340 = 250 development
     + ~90 holdout-generation window incl. purge/embargo margin — provisional until a live
     holdout definition supplies exact bars, and SAYS so), `INTRADAY_READY` (≥ 20 accumulated
     5m sessions — the campaign's longest rvol baseline).
   - One grouped candle query (never per-instrument N+1); per-security missing reason:
     `NO_HISTORY`, `INSUFFICIENT_BARS`, `INGEST_QUEUED/ACTIVE/COOLING/BLOCKED` from the durable
     ingest jobs by dedupe key, `UNKNOWN_INSTRUMENT` where identity cannot resolve.
2. **Deterministic batch planner** replacing `resolveUniverseDataGaps`'s alphabetical head
   (same signature, same cycle call-site, same quota): P1 instruments referenced by active
   strategies/challengers or already partially covered (finish what is started), P2+P3
   MAIN_BOARD by deterministic order (liquidity-ranked once bars exist; alphabetical
   until then, stated), SME/ETF/REIT/restricted EXCLUDED from QC-001 ingestion (separate
   universes; segregated, not silently mixed). Quota bounds readiness checks per pass; the
   durable queue + dedupe keys already prevent thundering herds; the ingest worker's own
   provider chain owns rate limiting per call.
3. **/brain DATA COVERAGE panel**: tier counts, readiness ladder with coverage %s,
   missing-reason histogram, ingest pipeline state, and per-family candidate pools
   (candidates / rehearsed / ready-for-gauntlet from evidence-derived standings
   `blockedOn === "gauntlet"`).
4. **PBO note** recorded for NSE-QC-002 (docs/plans/quant-quality-program/06-pbo-note.md) —
   the pinned NSE-QC-001 gate is NOT touched.

## Explicitly out (stated, not smuggled)

Flipping the trials switch (owner's); ~~5m backfill~~ (CORRECTED 2026-08-16: historical
intraday backfill IS available — Upstox Historical V3, OpenChart — and is the follow-on leg,
see 02-correction.md); SME campaign (needs its own declaration); AUTO consuming
rejectionDiagnosis (owner approves that only after coverage expands); liquidity-eligible and
execution-feasible gates of the campaign ladder (they PRUNE an already-ingested universe at
scan time — coverage must come first and their inputs are the bars this mission fetches).
