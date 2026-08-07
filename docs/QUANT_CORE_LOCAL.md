# The quant core, supplied locally

`docs/CONTRACT_QUANTCORE_V1.md` describes a seam to a Python quant core at `E:\Trading_BOT`.
**That directory does not exist on this machine.** Not empty — absent. This document records what
replaced it, what that costs, and how to reconnect a real quant core later.

---

## What the quant core was for

It was a **second, independently written implementation**. This repository has its own backtest
engine, strategy compiler and gauntlet; the quant core answered the same questions from the same
market data using different code, in a different language, written by a different agent.

Two engines built separately agreeing on a result is evidence that neither one's bugs produced it.
That was the whole value — not extra features.

It also carried history this repository never had: the last board packet reported 582 historical
wins, 1,038 losses, 3,297 expired and 11 live-resolved observations over a daily range of
`2016-01-01 .. 2026-07-17`. Those numbers are preserved only as a test fixture in
`lib/quantcore/quantcore.test.ts`. They cannot be recomputed here.

## What now supplies it

`lib/quantcore/generate.ts` writes the contract's artifacts from this repository's own data, into
`data/quantcore/`, in exactly the layout the filesystem transport already reads.

| Resource | Source | Honest? |
|---|---|---|
| `universe` | `INSTRUMENT_CATALOG` | `liquid` reports **catalog membership**, not measured ADV. `sector` is null because this repo does not store sectors. |
| `trials` | `trials` table | Direct. Every gauntlet attempt including failures. |
| `forwardOutcomes` | `forward_outcomes` table | Direct. Empty until paper positions resolve. |
| `health` | The app's own state | `liveExecution: false` is structural — there is no broker adapter. |
| `board` | Strategy specs + trials + forward outcomes + a live signal scan | `candidates` is empty only when no bars were supplied — see below. |
| `regime` | `lib/quantcore/regime.ts` over QQQ daily bars | New. Descriptive, not predictive — see below. |

### Why files instead of a new transport

`lib/quantcore/contract.ts` is frozen and hook-protected. `QuantTransport` is `"http" |
"filesystem"` and a third member cannot be added. Writing real files means `transport:
"filesystem"` stays literally true, `source` is a genuine path, and `generatedAt` is a genuine
timestamp — no field has to lie.

It also makes generation a **default rather than a monopoly**: drop a real board packet into
`data/quantcore/reports/board_history/` and it is read identically. The reader cannot tell the
difference and does not need to.

### The candidate scan

`lib/quantcore/signals.ts`. For every strategy in the registry, against every instrument in the
market sample: does the entry condition fire on the most recent bar?

This is **not** `lib/factory/screen.ts`. That screens *strategies* against one instrument's history
and ranks them — "which candidate strategy is worth a trial?". The board asks a different
question: "given the strategies I already have, what fired at today's close?".

**Three-valued evaluation.** `evaluate()` returns `boolean | undefined`, where `undefined` means a
referenced feature is still warming up. Collapsing that to `false` would silently drop every signal
on a short-history instrument — the strategy would look as though it simply never triggered there,
which is indistinguishable from a real absence of signal and far more misleading than a stated
refusal. Unknown is reported as a blocker, never as "no signal".

**Verdicts come from governance, not from the signal.** A firing entry condition is not permission:

| Spec status | Verdict | Blocker |
|---|---|---|
| `paper_challenger` (gauntlet passed) | `PAPER_CANDIDATE` | — |
| `draft`, `validating` | `RESEARCH_ONLY` | `gauntlet_not_passed` |
| `rejected` | `BLOCKED` | `strategy_rejected` |
| anything else | `BLOCKED` | `unrecognised_status_<x>` |

A buried strategy still triggers on price. The signal is real; the permission is not. Unknown
statuses fail closed, matching how the filesystem reader treats unknown verdicts arriving from
outside.

`score` is always null — an entry condition is a boolean and carries no strength, and a fabricated
score would be ranked on by whoever reads the board. `side` is always `PAPER_LONG_CANDIDATE`
because the engine computes `(exit - entry) / entry` with no short path; claiming a short would
describe a trade this system cannot model.

Candidates are sorted strongest-first then by symbol, so two boards can be diffed without churn
that means nothing.

### The regime module

The one resource with no prior equivalent anywhere — the Python core never delivered it either.

Realised volatility over 20 bars, ranked as a percentile against the trailing 252 bars.
`LOW_VOL` below the 33rd percentile, `HIGH_VOL` above the 67th, `NORMAL` between.

- **Ranked, not absolute.** "20% annualised is high" is wrong in both directions across
  instruments and across decades. A percentile is at least a statement about this series.
- **`confidence` is distance from the nearest label boundary**, normalised — *not* a probability
  the regime is correct. A reading on the line is a coin toss and reports as one.
- **`calibration` is `realised_vol_percentile_<n>b`**, never `walk_forward`. The contract's
  example shows `walk_forward`; nothing here has been walk-forward validated and borrowing that
  string to look established would be a fabrication.
- **Too little history returns null and writes no file.** `NORMAL` is the tempting fallback and
  the dangerous one: a real label a caller acts on, produced by a measurement that never happened.

## What this costs

**Parity is gone.** A repository supplying its own quant-core resources is one engine agreeing
with itself. Any agreement between these artifacts and local backtests is circular and must not be
read as corroboration. The generated board packet says so in `data_status.primary_limit`, and a
test asserts that string is present.

**The historical population changed.** `outcome_audit.historical_*` now counts *this* repository's
gauntlet verdicts, not the Python core's 4,917 forward observations. Same field names, different
meaning, far smaller numbers.

## What independent verification survives

`lib/backtest/parity.test.ts` — unaffected by any of this. It checks the engine two ways:

1. A golden fixture whose every trade was worked out by hand, so the expected numbers were not
   produced by the code under test.
2. A differential test against a reference implementation written separately in that file — no
   shared helpers, no shared constants — over randomised series.

That is genuine second-implementation corroboration and it lives inside this repository.

## Reconnecting a real quant core

One environment variable:

```
QUANT_CORE_ROOT=E:/Trading_BOT     # filesystem transport
QUANT_CORE_URL=http://127.0.0.1:8787   # HTTP transport, tried first
```

`QUANT_CORE_URL=off` disables the HTTP attempt. The client, the contract, the schemas and the
provenance envelope are unchanged — nothing was deleted, only re-pointed.
