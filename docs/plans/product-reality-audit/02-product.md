# Gate 1: Product

## User Problem

A non-programmer cannot rely on a fresh MarketPulse install to search NSE instruments. The app creates an empty master and tells the user to run an undiscoverable script, while readiness misleadingly calls the state partial.

## User

The product owner demonstrating MarketPulse on a fresh desktop server and database.

## Current Behavior

An owner database with prior sync works. A clean production database returns HTTP 503 for NSE-only searches and unscoped NSE symbols such as `SBIN`.

## Desired Outcome

The first NSE search automatically initializes the canonical universe from the official main and SME files, persists it, and returns the requested canonical instrument. Existing verified data remains immediately usable when a later refresh fails.

## Success Evidence

- A clean non-test database bootstraps from injected official-source responses.
- `SBIN` returns `IN:XNSE:SBIN` with ISIN, series, asset type, and sync provenance.
- Concurrent first requests share one bootstrap operation.
- Fetch failure with no verified master returns an explicit 503 and records the failed attempt.
- Readiness reports empty as MISSING, current as READY, and stale/failed-last-attempt as PARTIAL.
- BSE catalog rows cannot make the NSE item partial or ready.

## Failure Conditions

- Manual sync remains required.
- Network I/O runs inside migration/seed transactions.
- Missing data is replaced with hardcoded NSE fixtures in production.
- A refresh failure destroys or hides last-good results.
- The test passes without failing against the pre-fix behavior.

## User Journey

Start fresh app -> focus search -> enter NSE symbol/company/ISIN -> app initializes verified master once -> select/open result -> canonical analysis page loads.

## Non-goals

- India sector/VIX/corporate-event ingestion.
- Scout installation or research bridge.
- Strategy/backtest/replay/paper behavior changes.
- Mobile verification.
- Real broker execution.
