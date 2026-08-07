# ADR 0005 — Instrument scope: NSE and US equities on daily bars

Status: Accepted

Date: 2026-08-07

## Context

The Threepio reel — the design reference for this product — shows a system trading **MNQ**
(Micro E-mini Nasdaq futures) with intraday strategies. Frame 1216 shows variants named
`MOM 15m thr1.5 2R cut12:00`: fifteen-minute bars, a 1.5 threshold, a 2R target, a 12:00 time
cut. Frame 1440's results table shows `MNQ` in every row.

This repository is built for **NSE and US cash equities on daily bars**: a forty-instrument
catalog, a decide-on-close/fill-next-open engine, India STT and GST fee schedules, and
three-phase NSE pre-open modelling.

The owner asked which to pursue, or whether to do both, and asked for the most profitable.

## The question that can actually be answered

Nobody can say which is more profitable in advance. That claim is exactly what this system is
built to refuse. The answerable question is **which can this system honestly validate**, and
that has a clear answer.

## Decision

**NSE and US equities on daily bars. MNQ intraday is out of scope. Both is rejected.**

### 1. The engine cannot measure an intraday futures edge

From `research/researched_architecture.md`, in the reel package itself:

> A candle-only simulator cannot validate a true scalping edge that depends on spread, queue
> priority, partial fills and latency. […] otherwise label the result as bar-based research, not
> execution-grade scalping evidence.

`lib/backtest/engine.ts` decides on close and fills at the next open. It models no spread, no
queue, no partial fill, no latency. An MNQ result from it would be a number the validation stack
then treats with full statistical rigour — deflated Sharpe, PBO, a five-way simulation battery —
applied to a fundamentally mismeasured input. **That is worse than having no backtest**, because
the output carries the appearance of evidence.

Doing it properly needs a microstructure engine (hftbacktest and its class) plus licensed
Level-2/Level-3 tick data. Neither exists here, and the data is not free.

### 2. The data dependency runs the wrong way

The provider already times out on **daily** bars on this machine — the `UND_ERR_CONNECT_TIMEOUT`
flood in the server log, and the reason paper orders are refused as `INELIGIBLE_QUOTE`. A
fifteen-minute strategy needs more data, more often, more reliably. It puts the greatest new
load on the weakest existing link.

Yahoo also caps intraday history at roughly sixty days. `SIMULATION_GATES.minTrades` is 30 and
the walk-forward wants the edge spread across the calendar; sixty days of history cannot support
that honestly.

### 3. Breadth is what makes the validation machinery mean anything

A single instrument gives one series. `maxPositions` never binds, so the portfolio engine's
capacity constraint — the thing that stops a strategy reporting trades it could never have taken
— is inert. Pairwise correlation has nothing to correlate. The Star Map has one family.

Cross-sectional breadth across forty instruments is what gives the multiple-testing correction
something to correct.

### 4. Both is the worst of the three

They share vocabulary and almost no machinery: two engines, two fee models, two session models,
two data pipelines. The same research document warns against it directly — *"choose one primary
engine after a parity benchmark; do not maintain two full engines initially."*

## Consequences

- `lib/scalping/**` stays, and stays **honest about its own limits**. It is bar-based intraday
  research, not execution-grade scalping evidence, and any result it produces must be labelled
  as such. It is not promoted to a validation path.
- The instrument catalog, fee model, session phases and pre-market work already built are the
  right investment and continue.
- If MNQ is revisited, it needs a microstructure engine and licensed tick data first. Adding it
  to the current engine would produce confident numbers about a thing that was never measured.

## What this does not claim

That daily equities are more profitable than intraday futures. They may well not be. This says
only that a daily-equity result from this system can be trusted to mean what it says, and an
MNQ result from this system could not — and an unverifiable edge is worth nothing regardless of
how large it appears.
