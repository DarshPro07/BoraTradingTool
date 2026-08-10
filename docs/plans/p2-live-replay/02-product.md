# Gate 1 — Product

## User problem
The forward/paper loop can only be demonstrated while the market is open and the provider is up.
In a meeting (or any evening), pressing "Run shadow pass" produces nothing new, which reads as a
dead product — when the truthful capability is "this system can replay any recorded moment
deterministically".

## User
The owner demoing MarketPulse; later, any non-programmer following the golden journey (Meeting
Release Gate step 7: "run a deterministic forward/replay validation").

## Current behaviour
One unlabelled button runs a wall-clock pass. Off-hours it evaluates zero new bars; the result
note gives counts with no mode or instant, so a quiet market and a broken feature look identical.

## Desired outcome
On /paper the owner picks LIVE or REPLAY — HISTORICAL EVIDENCE. Replay requires an explicit
instant; the pass runs against stored, immutable history as of that instant; the result note and
the API response both state the mode and the instant. The same challengers, evaluator and
ledgers serve both modes — replay is playback of real recorded evidence, not fake data.

## Success evidence
- Playwright: switch to REPLAY, run at a fixed instant, note contains "REPLAY" + the instant and
  never claims live; switch to LIVE, note says LIVE. API response carries mode/evaluatedAsOf.
- Works on a fresh DB with zero challengers (a 0-signal replay is an honest, labelled answer).

## Failure conditions
- A replay result rendered without its label or instant (the forbidden confusion).
- Replay silently changing history (watermark must keep refusing retroactive signals — engine
  guarantee, restated not re-implemented).
- REPLAY runnable without an instant (would silently mean "now" = live in disguise).

## Non-goals
Global app-wide replay state; a bar-by-bar scrubbing player; engine changes; scheduler
integration (P4, engine lane); labelling of market DATA freshness (panel-state already does it).
