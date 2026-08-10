# Gate 2: Architecture

## Proposed Fit

```text
Existing learning-cycle lease
  -> deterministic NSE scanner manager
  -> append-only scan run and entries
  -> /scanner funnel
  -> /brain daily decision brief
```

## Data Flow

Verified NSE master -> stored point-in-time candles -> availability filters -> pure factor calculation -> deterministic percentile rank -> existing strategy/risk/feasibility reads -> persisted evidence -> UI.

## Contracts

- `CandidateScoreV1`: raw factors, percentiles, coverage, rank score, version.
- `StageFunnel`: stage, input, passed, named exclusions.
- `CandidateDecision`: instrument identity, evidence timestamp, score, unavailable inputs, blockers, matching strategy state, final disposition.
- `MarketScanResult`: run identity, universe and bar hashes, funnel, candidates, disposition, next action.

## Failure Paths

- Missing/incomplete security master: refuse the run.
- Missing history: exclude as `MISSING_HISTORY`.
- Insufficient bars: exclude as `INSUFFICIENT_HISTORY`.
- Missing spread/catalyst/VIX: retain `null`; never substitute zero.
- Persistence failure: fail the run; do not claim a completed scan.

## Security

The first slice is autonomy class `AUTO_ALLOWED` only for deterministic reads and append-only scanner evidence. Validation/capital mutations remain owner governed; live financial mutation remains prohibited.

## Observability

Persist run inputs, policy version, source timestamps, hashes, funnel counts, exclusion reasons, score components, and terminal state. The existing cycle audit records the scanner leg summary.
