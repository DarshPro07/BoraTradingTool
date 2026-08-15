# Data OS integrity — identity, capability, gap auditing, family readiness (2026-08-16)

Owner directive after the truncation fix: **no new connectors**. Four things instead — the
generic identity invariant, declared source capabilities, persisted fetch telemetry with gap
auditing, and family-specific readiness as the metric that governs the trial switch.

## 1. IDENTITY_MISMATCH — every provider, not one

`lib/market/identity-guard.ts`. A successful fetch of the WRONG instrument stored under the
right name is the worst bug this pipeline can have: once written it is indistinguishable from
history, and every downstream verdict is computed on it. The guard compares what was requested
against what the provider says it served and throws before a single bar is built.

Three verdicts: `MATCHED` (may proceed silently), `MISMATCHED` (throws — nothing stored),
`UNSTATED` (proceeds, but the caller RECORDS that verification was impossible — the same rule
this repo applies to unmeasured tokens and unpriceable costs). Wired into the production
provider (`getYahooCandles`, which reads `chart.result[0].meta.symbol`) and threaded into
`Provenance.identityVerdict` so the ledger records what was actually verified rather than
assuming. Fail-first proven: with the guard call removed, a NIFTY-for-TCS response is accepted;
with it, refused.

The motivating hazard is real and recorded — openchart 0.2.0's search ignores its query and its
own fallback is "use the first result", so a TCS request would have been served NIFTY 50.

## 2. Declared source capabilities

`lib/market/source-capability.ts`. Each source declares dailyHistorical, intradayHistorical,
intradayLookbackDays / intradayHistoryFloor, canonicalIdentity, validationAuthority,
authenticated, realtime — each carrying an `ExternalCapabilityClaim` with a **sourceCitation OR
probeEvidence, plus verifiedAt**. A claim older than 90 days reads `UNKNOWN`, never truth.

This is the generalization of the rule the wrong "cannot backfill" claim broke. `canSatisfy()`
now answers planning questions from declarations instead of failed requests:

- 55 days of 5m → **YES** (Yahoo, inside its 60-day trailing window)
- 18 months of 5m → **NO**, with the reason: only the most recent 60 days; a deeper source is
  needed — Upstox's declared floor of 2022-01 could serve it, but its access is `NO` for a
  separate and honest reason (no owner credentials). Capability and access stay distinct facts.

## 3. Gap auditing + the ingestion ledger

`lib/market/bar-audit.ts` classifies every fetch: COMPLETE / PARTIAL / SESSION_GAPS /
DUPLICATES / OUT_OF_SESSION / TIMEZONE_ERROR / EMPTY. Two checks kept deliberately separate by
how much they can be trusted: per-session bar counts (exact, no calendar needed — catches
truncated sessions) and window coverage (bounded by this deployment's declared holiday model,
tolerance-guarded so an unmodelled holiday is never asserted as missing data). An EMPTY response
still records what was EXPECTED — "nothing arrived" only means something beside "this many
sessions were in the window". The audit's first test is the defect that motivated it: a wide
window answered with one session.

`lib/market/bar-ingestion-ledger.ts` persists the request beside the response — requestedStart/
End, returnedFirstBar/LastBar/Count, identity verdict, and the full audit — on both write paths
(daily ingest and intraday accumulation).

**Pending owner action:** the migration is staged in `pending-migration/`, NOT in `drizzle/`,
because `lib/db/migrate.ts` is owner-protected and two existing tests correctly refuse a
migration file that would "apply to no database while looking applied to a reader of the
directory". Until promoted (two steps, README beside it), recording no-ops and the panel says
so; the audit still travels in each ingest outcome.

## 4. Family-specific readiness — the new decision metric

`lib/market/family-readiness.ts` + each NSE-QC-001 family's declared `dataRequirement` (with its
basis stated — no magic numbers). Verified: adding these requirements does NOT change any
family's `declaration_hash`, so the production pins hold (asserted against the five registered
hashes).

**Live on a production backup, 2026-08-16 02:30 IST — and it changes the picture:**

| Family | Requires | Ready | Coverage | Short on daily | Short on 5m |
|---|---|---|---|---|---|
| Opening Range Breakout | 60d + 40×5m | **6** | 0.3% | 2,036 | 80 |
| RVOL momentum breakout | 60d + 40×5m | **6** | 0.3% | 2,036 | 80 |
| Intraday mean reversion | 60d + 40×5m | **6** | 0.3% | 2,036 | 80 |
| Swing cross-sectional momentum | 340d | **77** | 3.6% | 2,045 | — |
| Swing mean reversion | 250d | **78** | 3.7% | 2,044 | — |

This is exactly why the owner replaced the global number: "143 research-ready" is 6 for every
intraday family. The actionable gap is named — **80 instruments hold the daily history and lack
only 5m sessions**, and since the truncation fix one fetch delivers ~40 sessions. The
12-instrument-per-session accumulator discipline is deliberately UNCHANGED (owner: measure the
repaired throughput before touching rate policy); this table is that measurement's baseline.

## Verification

Units **169 files / 1876 passed / 2 skipped / 0 failed**; tsc silent; identity-guard fail-first
proven; live e2e green on a fresh DB and on a production backup. Trials remain OFF.
