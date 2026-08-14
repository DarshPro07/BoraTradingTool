# NSE 30-Stock Breadth Acceptance (masterclass A75/C33) — COMPLETE, 2026-08-14

**Program:** the full two-stage breadth acceptance on ONE fresh database against a production build
(`next start`, isolated dist dir, `:3100`, TEST_MODE fixture data providers, REAL model runs),
identity-gated (`/api/system/identity` pinned by start time; build `ef35ae0-dirty`, schema 0021).

## The chain proven per stock (A75): Search → Identity → Analyze → Provenance → Research → Terminal → Persistence

### Stage 1 — fresh database: 34/34 passed (2.5m)

Every one of the 30 stratified stocks (10 large / 10 mid / 10 smaller-cap incl. hyphenated
`MCDOWELL-N`, `BECTORFOOD`, `JYOTHYLAB`) resolved through the real UI (no TickerNotFound
fall-through), ran research via the real control, and reached the TRUTHFUL terminal refusal
`FAILED :: NO_STORED_DATA` with the full diagnostic ("Missing history is an ingestion task…").
Plus: catalog ≥30 canonical XNSE with zero duplicates and every acceptance symbol present; no BSE
contamination (`.BO`/XBOM absent); search → canonical `IN:XNSE:` identity via the real combobox.
Zero console errors, zero failed requests, zero 5xx across all pages.

### Defect found by the program and FIXED (the run is a bug-finder, per C35)

First Stage-2 sweep: only **3/30** became researchable — 27 × `INSTRUMENT_UNKNOWN`. Root cause: the
TEST_MODE disposable fixture master (`lib/db/index.ts seedTestSecurityMaster`) seeded only 5
securities (3 real + 2 synthetic), so the ingestion guard (correctly) refused everything else.
Fix: the fixture master now carries the full pinned 30-symbol acceptance universe (+ the 2 synthetic
series rows), with computed sync row-counts. Everything stays TEST_MODE-gated, empty-DB-gated, and
TEST_FIXTURE/playwright-fixture provenanced — nothing can masquerade as exchange truth; the 27
added identities are explicitly synthetic fixture identities. Master-dependent unit suites 28/28
after the change; the sweep's `MIN_READY >= 25` floor (which forbids a refusal-only Stage 2 from
passing) is what caught this — it failed honestly with `3/30`.

### Stage 2 — after product-path ingestion: 38/38 passed across sweep + 6 research chunks + gate

- **Ingestion sweep 30/30 INGESTED** (`ready=true`, 260 daily bars each) through the product route
  (`POST /api/market/ingest`, same route the UI button drives; the button path is separately
  UI-proven by `ingestion-unlock.spec.ts`). Every outcome a stated code; unfit-for-validation
  declarations preserved.
- **Research 30/30 → `PROPOSAL READY`** through the REAL UI (`research-stock-run` click → terminal
  state → proposal rendered), each a REAL model run (claude-code CLI, sonnet alias) over the
  deterministic evidence packet, with MarketPulse's citation verification passing —
  `SOURCE_VERIFIED` on every one. Zero hangs, zero bare failures, zero console/network problems
  (matrix `problems: 0` across all 30).
- **Matrix gate:** `{"total":30,"researchable":30,"terminals":{"PROPOSAL READY":30}}` — no silent
  gaps (every researchable stock carries a recorded outcome).

### Persistence (the DB after the program)

- `agent_runs`: **30 COMPLETED / SOURCE_VERIFIED** (Stage 2) + **30 REFUSED** (Stage 1's honest
  NO_STORED_DATA refusals) — the two-stage story is durably recorded, refusals with the same
  weight as completions.
- `price_candles`: **30 distinct tickers × 260 = 7,800 canonical bars.**
- Per-stock matrix artifact: `docs/plans/nse-30-breadth/matrix-2026-08-14.json` (30 rows:
  ingestion code/bars/ready + research terminal/refusal + problems).

## Per-stock matrix (compact)

All 30 identical in shape — `ingest INGESTED ready=true bars=260 → research PROPOSAL READY,
problems 0`: RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK, HINDUNILVR, SBIN, BHARTIARTL, ITC, LT,
TATAMOTORS, SUNPHARMA, TATASTEEL, WIPRO, ASIANPAINT, MARUTI, TITAN, BAJFINANCE, HCLTECH, POWERGRID,
BECTORFOOD, JYOTHYLAB, CHAMBLFERT, GAIL, SIEMENS, AMBUJACEM, BERGEPAINT, DABUR, COLPAL, MCDOWELL-N.

## Stated limitations (not hidden)

- Market DATA is TEST_MODE fixture-served (deterministic, declared unfit-for-validation) — the
  point under test is the product chain (identity→ingestion→research→verification→persistence),
  not provider quality. The research MODEL runs are real.
- 27 of the 30 fixture-master identities are synthetic (clearly provenanced); a REAL-master run
  (`MARKETPULSE_E2E_REAL_BOOTSTRAP=1`, live NSE sync + live providers) is the non-deterministic
  variant available when wanted.

## Verdict: **VERIFIED_FOR_DEFINED_SCOPE** — 30-stock breadth (Stage 1 + Stage 2) complete.
