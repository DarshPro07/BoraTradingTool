# Trade inspection + owner-seat diagnosis - status

**2026-08-09 evening - Verdict: VERIFIED** (chart overlay deferred, stated below)

## Part 0 - the owner's "buttons don't work" complaint, diagnosed with Playwright

Against a production build on a COPY of the real database: pages load 0.3-2.1s, hypothesis submit
1.1s EXPRESSIBLE, RUN CYCLE settles ~3s with no failed HTTP call. The first probe's "error shown"
was the probe's own regex matching static page prose - a false positive, corrected.

Root cause of the owner's experience: the :3000 dev server had been running since before ~40 files
changed. **Restarted it**; read-only Playwright against :3000 confirms all pages load and the new
panels render. (One probe assertion failed due to probe error - asserted a /learning panel while on
/paper - not an app fault.)

## Part 1 - authoring provenance ("you said -> interpreted -> tested")

`AuthoringProvenance` on every authored outcome: the owner's words, each condition with the exact
text it was read from, every system-added default named, family + why, engine version, timestamp.
Persisted as an `authoring_provenance` audit event; returned by the route (with owner-review field
aliases outcome/created/missingFeatures); rendered in the composer under
"YOU SAID -> MARKETPULSE INTERPRETED -> STRATEGY ACTUALLY TESTED".

## Part 2 - per-trade inspection (#12)

- `lib/backtest/inspect.ts` - per trade: signal-bar clause verdicts (bar BEFORE the fill), MFE/MAE
  from the held bars, economics at a STATED quantity of 1 decomposed by the real fee engine
  (statutory / DP / total - no fabricated finer split), execution assumptions attached.
- `app/api/strategy/trades` - replay-only; spends no trial, touches no holdout; NO_DATA is a 503
  with missing-is-not-zero language, never an empty table.
- `TradeInspector` on /strategies: strategy select -> trade table -> click row -> full detail.
- 6 unit tests (clause verdicts, MFE>=gross on a ramp, fee reconciliation, deadline audit, empty
  refusal) + journey e2e block.

## Evidence

- Unit: **1,300 passed / 0 failed**. Browser: **74 passed / 0 failed** on a fresh database.
- Live, real stored bars (owner-copy DB): "73 trade(s), 27 net-positive, across 6 instruments";
  trade0 TCS square_off net -0.611%; all four clauses checked true on the signal bar;
  MFE 0.596% MAE -0.429%; fees 2.55+0=2.55 reconciles; **exits past 15:25: 0 of 73**.
- A real layout defect found by the suite and fixed: the inspector's select sized itself to the
  longest strategy name (630px at a 391px viewport); constrained with max-w + truncate.

## Deferred, stated

- Chart entry/exit markers (CandlestickChart supports markers; wiring click-to-chart is the next
  slice of this feature).
- **New defect found by the inspector**: `marketCandleLoader` serves only the provider's sliding
  window and ignores the 30,832 stored bars - the same defect family as the factory's dataset,
  fifth occurrence. The rehearsal is affected too. Recorded as the next master-plan item.
