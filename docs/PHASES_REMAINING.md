# Remaining phases

Written 2026-08-06, after reading the extracted Threepio reel package
(`analysis/`, `research/`) and scoring this repository against it.

The package's own framing governs this plan: the reel is **a workflow and information-
architecture reference, not evidence that the claimed system is profitable**. Its
claims-versus-evidence table lists what the reel never shows — source code, data entitlements,
broker statements, live fills, audited performance, proof of persistent edge. Nothing below
treats a displayed number from the reel as a target to reproduce.

## Scoring against the twelve bounded capabilities

From `analysis/reel_full_analysis.md` §"Architecture translation".

| # | Capability | State | Gap |
|---|---|---|---|
| 1 | Evidence vault, typed research graph | done | — |
| 2 | Hypothesis + reusable strategy-brick registry | partial | No brick registry; specs are authored whole |
| 3 | Canonical strategy IR, deterministic compiler | done | — |
| 4 | Experiment service, immutable manifests | partial | Trials recorded; no dataset fingerprint manifest per run |
| 5 | Gauntlet, trial accounting, sealed holdout | done | — |
| 6 | Graveyard, rejection reasons, rediscovery prevention | done | — |
| 7 | Regime-aware portfolio research | partial | `regime` resource exists; nothing consumes it |
| 8 | Risk gate agents cannot bypass | done | Hook-protected, test-enforced |
| 9 | Human confirmation for every trade | done, stronger | No execution path exists at all |
| 10 | Durable scheduler independent of the browser | done | — |
| 11 | Observability, incidents, resource budget | partial | No incident model, no budget ceiling |
| 12 | India + USA adapters, separate session/fee semantics | done | — |

## Phase D — panel state language *(done 2026-08-06)*

`ui_inventory.md` requires every panel to distinguish fourteen states. `lib/ui/panel-state.ts`
implements the vocabulary and `components/system/PanelState.tsx` renders it. `/data-quality`
consumes it, including an aggregate badge.

The pairs that justify the work, each of which renders identically in a naive implementation:

- `empty` vs `unavailable` — we looked and there is nothing, vs we could not look
- `unavailable` vs `unsupported` — not configured here, vs cannot exist here
- `unauthorized` vs `unavailable` — you lack entitlement, vs nobody has it
- `stale` vs `delayed` — should have updated and did not, vs late by design
- `invalid` vs `compute_error` — the input was wrong, vs our code failed on good input

## Phase E — event envelope and lineage

`research/data_sources.md` specifies a canonical envelope every event should carry: event id,
instrument, venue, exchange event time, provider receive time, platform ingest time, sequence,
correction reference, schema version, provider and entitlement, quality flags, raw object hash,
lineage ids.

Today's `Provenance` carries provider, `sourceEventAt`, `ingestedAt`, quality and `delayedBySeconds`
— five of thirteen. The missing fields that change behaviour rather than merely record it:

- **correction/cancel reference** — without it a corrected print silently overwrites the original
  and no backtest can be reproduced against what was known at the time;
- **raw object hash** — the only way to prove a stored bar is the bar the provider sent;
- **sequence** — the only way to detect a gap rather than infer one from timestamps.

Acceptance: a stored quote can be traced to a raw payload hash, and a correction is visible as a
correction rather than as history changing.

## Phase F — incidents and resource budget (capability 11)

The reel's status rail carries an incident count; the architecture reference asks for a
"resource-budget control plane". Neither exists here.

Acceptance: a provider outage, a malformed resource and an exhausted retry budget each raise a
typed incident with a start, an end and an effect on which panels are actionable. A learning
cycle that exceeds its declared budget stops and says so, rather than running until something
else breaks.

## Phase G — regime consumption (capability 7)

`QUANT_RESOURCES` already includes `regime`, and `RegimeSchema` carries state, `asOf`,
confidence and calibration. Nothing reads it. A strategy that was validated in one regime and is
being rehearsed in another should say so.

Acceptance: the rehearsal and the gauntlet both report the regime their evidence came from, and
a regime change since validation is visible on the strategy.

## Phase H — strategy bricks (capability 2)

Specs are authored whole today. A brick registry — reusable, individually tested condition and
sizing fragments — is what makes generated strategies auditable rather than opaque.

**Deliberately not scheduled:** automatic strategy generation over those bricks. Mining
candidates on a timer manufactures false positives faster than the multiple-testing correction
absorbs them, and `countSelectionTrials` would have to count every generated sibling. Bricks
first, generation only behind a declared and budgeted search.

## Phase I — Kronos runtime *(blocked on the owner)*

`lib/forecast/` holds the reader, the scorer, the manifest and `docs/KRONOS_RUNNER.md`. The
model is PyTorch and runs in the Python quant core, which is not present on this machine.
Nothing in this repository changes when the weights are downloaded.

First run when it exists: Kronos-mini, daily bars, twenty instruments, horizon 5 — then
`scoreForecast` against the persistence baseline. If it does not beat "the next close equals
this close" on these instruments at these costs, stop there.

## Standing constraints

- No broker adapter, no execution. `EXECUTION_ADAPTER_MISSING` stands.
- Autonomous paper-order placement requires a new permitted action in
  `lib/governance/policy.ts`, which is owner-only. The agent does not grant itself capabilities.
- Every trial permanently raises the statistical bar. The rehearsal exists so candidates can be
  triaged without spending one.
