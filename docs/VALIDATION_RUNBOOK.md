# Validation runbook

How to check the system actually works. Ordered by value: the automated gate first because it is
cheap and catches most things, then the browser checks, then the negative tests — which are the
ones that distinguish "it renders" from "it is honest".

Run this after any significant change, and before believing any result.

---

## 1. The automated gate

```bash
npm run check
```

That is typecheck + tests + production build. If you want them separately:

```bash
npx tsc --noEmit          # types — catches what tests cannot, incl. pages and components
npx vitest run            # the whole suite
npm run build             # production build, catches server/client boundary mistakes
```

**Pass:** typecheck silent, every test file green, build completes with a route list.

**What a real failure looks like:** vitest only covers `lib/**`, `app/**/*.test.ts` and `mcp/**`
(see `vitest.config.ts`). Page and component code is checked by `tsc` and `build`, not by the
suite — so a green test run alone does **not** mean the screens compile. Always run all three.

### The guardrail suite on its own

```bash
npx vitest run lib/governance
```

These tests fail the build if a prohibited action becomes reachable. If they ever go green after
you loosened something, read the diff rather than trusting the colour.

---

## 2. Browser checks

Start the server, then walk these. Each has a **specific expected value**, because "the page
loads" proves almost nothing.

```bash
npm run dev     # http://localhost:3000
```

| Route | What to check | Expected right now |
|---|---|---|
| `/data-quality` | Aggregate badge, per-resource badges | `OFFLINE` overall. The quant core is not on this machine, so it must **not** show green |
| `/simulations` | Click each of the 4 fixtures | `edge` passes 5/5 · `noise` fails 5/5 · `lucky` fails **only** walk-forward · `thin` fails **only** cost-stress |
| `/premarket` | Phase per market, "Not visible to this deployment" | Phase matches the real clock; refusal list is **non-empty** (3 per market) |
| `/memory` | The lane graph | Nodes in 6 lanes, edges flowing left→right, lane counts shown |
| `/learning` | Self-inspection panel | Findings listed with a suggested action each |
| `/analyze/US:XNAS:AAPL` | Chart + timeframe buttons | Candles render; clicking 5D either redraws or **says why it could not** |

Note the instrument id format: `US:XNAS:AAPL`, three parts. A bare `AAPL` is rejected by design.

### The one that matters most on `/simulations`

If all four fixtures give the same verdict, the battery has stopped discriminating and is
worthless regardless of what it prints. Two of them are *designed* to fail exactly one
simulation each — that is the check.

---

## 3. Negative tests — break it on purpose

This is the part that actually validates the system's central claim: **missing is never
rendered as zero.** A screen that shows a confident number when it cannot see anything is worse
than one that crashes.

### 3a. Bad input must be refused, not absorbed

```bash
curl -i "http://localhost:3000/api/premarket?at=not-a-date"
curl -i "http://localhost:3000/api/candles?resolution=D"
```

**Expect:** `400` on both, with a message naming the problem.
**Failure:** a `200` with a plausible-looking body. That means an invalid input produced a
confident answer.

### 3b. A symbol that does not exist

```bash
curl -s "http://localhost:3000/api/candles?ticker=ZZZZNOTREAL&resolution=D&from=1750000000&to=1780000000"
```

**Expect:** `200` with `"count":0`.
**Failure:** any candles at all. `count: 0` is the honest answer — an empty result from a
successful call, which the chart then reports as "no candles returned" rather than silently
redrawing the previous range.

### 3c. Take the quant core away

```bash
# PowerShell
$env:QUANT_CORE_ROOT="E:\definitely-not-here"; npm run dev
```

Open `/data-quality`.

**Expect:** every resource `OFFLINE` or `UNAVAILABLE`, and the Kronos panel
`UNAVAILABLE` with a reason.
**Failure:** anything green, any zero presented as a count, any empty list rendered as "nothing
found". Those are the exact bugs the panel-state vocabulary exists to prevent — `empty` means
the source answered and returned nothing; `unavailable` means it was never asked.

### 3d. Confirm execution is still impossible

```bash
curl -i -X POST "http://localhost:3000/api/trade/place" -H "Content-Type: application/json" -d '{}'
```

**Expect:** `EXECUTION_ADAPTER_MISSING`.
**Failure:** anything resembling an accepted order. This must never change.

---

## 4. Determinism spot-check

Any result that moves between runs cannot be used as evidence, because the next run is a new
trial. Run the same fixture twice on `/simulations` and compare the numbers, not just verdicts.

```bash
npx vitest run lib/simulation
```

The suite contains explicit determinism tests, including one asserting the seed genuinely
changes the outcome — a seed that is accepted but ignored would otherwise pass every other test.

---

## 5. What "working" does not mean

- **Green tests do not mean the screens work.** Run `tsc` and `build`.
- **A rendering page does not mean the data is real.** Check `/data-quality` first; if it is
  `OFFLINE`, several panels are legitimately empty and that is correct behaviour.
- **A passing simulation battery does not mean a strategy makes money.** It means the strategy
  was not distinguishable from luck *by these five tests, on this sample*. Survivors are
  candidates for forward paper evidence, not conclusions.
- **A rehearsal is not a trial.** `/learning` reports what the gauntlet *would* say. Running the
  gauntlet for real consumes holdout budget and permanently raises that strategy's bar.
