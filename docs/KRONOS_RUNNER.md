# Kronos runner specification

What the Python side must implement so the TypeScript app can consume Kronos forecasts. See
`docs/adr/0004-kronos-forecast-intake.md` for *why* the seam is shaped this way.

Nothing in this repository changes when the model is downloaded. The reader, the manifest, the
scorer and the `/data-quality` panel already exist and already report the model as absent. A
runner that satisfies this document is the last piece.

## The two files

```
<QUANT_CORE_ROOT>/data/forecasts/kronos/<instrumentId>_<timeframe>.json   ← runner writes
```

`QUANT_CORE_ROOT` comes from the env var of that name, defaulting to `E:/Trading_BOT`.
`instrumentId` and `timeframe` have every character outside `[A-Za-z0-9._-]` replaced with `_`,
so `US:AAPL` at `1d` becomes `US_AAPL_1d.json`.

## Output shape

```json
{
  "instrumentId": "US:AAPL",
  "timeframe": "1d",
  "checkpoint": "Kronos-mini",
  "generatedAt": "2026-08-06T13:05:00.000Z",
  "lookbackBars": 512,
  "bars": [
    { "time": 1780086400, "open": 231.1, "high": 233.0, "low": 230.4, "close": 232.7, "volume": 41200000 }
  ]
}
```

| Field | Rule |
|---|---|
| `instrumentId` | Must match the requested id. A mismatch is refused, not adapted — otherwise one instrument's forecast lands on another's chart. |
| `checkpoint` | One of `Kronos-mini`, `Kronos-small`, `Kronos-base`. An unknown name is refused rather than having its context window guessed. |
| `generatedAt` | ISO 8601. **The instant the model ran.** Everything at or before it is dropped when scoring. |
| `lookbackBars` | Bars actually fed to the model. Compared against the checkpoint's context window; a larger value sets `contextOverrun` on the reading. |
| `bars[].time` | Unix **seconds** at the bar open, strictly future relative to `generatedAt`. |
| `bars` | At least one. An empty array is a refusal, so write no file rather than an empty one. |

Do not add an `epistemicStatus` field. The reader stamps `not_forward_validated` itself and
ignores anything the file claims — a producer must not be able to promote its own standing.

## Input manifest

`buildForecastManifest()` in `lib/forecast/manifest.ts` produces the job list:

```json
{
  "version": 1,
  "createdAt": "2026-08-06T13:00:00.000Z",
  "outputDir": "data/forecasts/kronos",
  "requests": [
    { "instrumentId": "US:AAPL", "providerSymbol": "AAPL", "timeframe": "1d",
      "checkpoint": "Kronos-mini", "lookbackBars": 512, "horizonBars": 5 }
  ],
  "rejected": []
}
```

`lookbackBars` is **already clamped** to the checkpoint's context window. Do not re-clamp
silently — if you cannot honour the number, fail the request loudly. A model handed 2000 bars
with a 512-token context reads the last 512 and produces a forecast that looks like it used
four years of history and used ten months.

`horizonBars` is capped at 30. Past that, autoregressive error compounds and the later bars are
generated from generated bars.

## The rule that makes the whole thing worth having

**Never regenerate forecasts over history and write them with a current `generatedAt`.**

A forecast for bar *t+1* produced at bar *t* is legitimate. The same file produced today, over
last year's bars, and scored as though it had been available at each of them, is lookahead — and
it will make any model look prophetic. `scoreForecast` drops predicted bars at or before
`generatedAt` specifically to catch this, but that guard only works if `generatedAt` is honest.

For a backfill, write one file per historical decision point with that point's timestamp.

## What happens after delivery

1. `/data-quality` flips from `RESOURCE_NOT_PROVIDED` to a delivered count.
2. `readKronosForecast()` returns the bars, stamped `not_forward_validated`.
3. `scoreForecast()` grades them against the persistence baseline — "the next close equals this
   close" — with the paired bootstrap the gauntlet uses.

If it does not beat persistence on your instruments at your costs, stop there. The AAAI
acceptance and the 12-billion-bar corpus are facts about the model, not about your edge.

## Suggested first run

Kronos-mini, daily bars, 20 instruments, horizon 5, and score it. That answers the only question
that matters before any of the rest is worth building.
