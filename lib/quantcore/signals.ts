import { collectFeatures, evaluate } from "@/lib/backtest/engine";
import { buildFeaturePanel, isDerivable, warmupBarsFor } from "@/lib/backtest/features";
import { getAllCapabilities, updateCapabilityHealth } from "@/lib/brain/capability-registry";
import { emit } from "@/lib/brain/event-bus";
import type { Candle } from "@/lib/providers/types";
import { marketOf, type StrategyDsl } from "@/lib/strategy/dsl";
import type { QuantCandidate } from "./contract";

/**
 * The board's candidate scan: which strategies have a live entry signal, on which instruments.
 *
 * `lib/factory/screen.ts` is not this. That screens *strategies* against one instrument's history
 * and ranks them — it answers "which candidate strategy is worth a trial?". The board answers a
 * different question: "given the strategies I already have, what fired at today's close?".
 *
 * ## The three-valued evaluation is the whole point
 *
 * `evaluate` returns `boolean | undefined`, where `undefined` means a referenced feature is still
 * inside its warm-up window. Collapsing that to `false` would silently drop every signal on an
 * instrument with short history — the strategy would look like it simply never triggered there,
 * which is indistinguishable from a real absence of signal and far more misleading than a stated
 * refusal. Unknown is reported as a blocker, never as "no signal".
 *
 * ## Verdicts come from governance, not from the signal
 *
 * A firing entry condition is not permission. The verdict is decided by how far the strategy has
 * got through the gauntlet, and `PAPER_CANDIDATE` is the strongest thing this system can say —
 * there is no execution path here at all, and `/api/trade/place` returns
 * `EXECUTION_ADAPTER_MISSING`.
 */

export interface ScannableSpec {
  id: string;
  name: string;
  status: string;
  dsl: StrategyDsl;
}

export interface SignalScan {
  candidates: QuantCandidate[];
  /** Strategy × instrument pairs actually evaluated, so an empty board is explicable. */
  evaluated: number;
  /** Why pairs could not be evaluated, deduplicated. */
  refusals: string[];
}

/** One strategy's entry condition firing on one instrument's last bar. */
export interface FiredSignal {
  spec: ScannableSpec;
  instrumentId: string;
  bars: readonly Candle[];
  /** Index of the bar whose close produced the signal. Always the last bar in `bars`. */
  at: number;
}

/**
 * A warm-up refusal as a COUNTABLE data condition, not an opaque string.
 *
 * `barsHeld < barsNeeded` says exactly how much history is missing, so the dependency resolver can
 * treat it as a DATA prerequisite (ingest more bars) with a knowable resume, and compose it with a
 * strategy's market-state/time conditions rather than sniffing a sentence.
 */
export interface WarmupRefusal {
  instrumentId: string;
  specName: string;
  barsHeld: number;
  barsNeeded: number;
  /**
   * True when the gap is TIME, not DATA: enough bars are held, but a session-gated feature (an
   * opening range whose window has not yet closed) is still forming. The market clock resolves
   * this, not more history — the owner's two-concept warm-up (DATA bar-count vs TIME session).
   */
  timeGated: boolean;
}

export interface SignalSweep {
  fired: FiredSignal[];
  evaluated: number;
  refusals: string[];
  /** Structured warm-up refusals, beside the human-readable `refusals` strings. */
  warmups: WarmupRefusal[];
}

/**
 * How a strategy's lifecycle status becomes a contract verdict.
 *
 * Fails closed: an unrecognised status is `BLOCKED`, never widened to a tradable state. The same
 * rule the filesystem reader applies to unknown verdicts arriving from outside.
 */
function verdictFor(status: string): { verdict: QuantCandidate["verdict"]; blockers: string[] } {
  switch (status) {
    case "paper_challenger":
      return { verdict: "PAPER_CANDIDATE", blockers: [] };
    case "draft":
    case "validating":
      return { verdict: "RESEARCH_ONLY", blockers: ["gauntlet_not_passed"] };
    case "rejected":
      return { verdict: "BLOCKED", blockers: ["strategy_rejected"] };
    default:
      return { verdict: "BLOCKED", blockers: [`unrecognised_status_${status}`] };
  }
}

function requiredFeatures(dsl: StrategyDsl): string[] {
  const required = new Set<string>();
  collectFeatures(dsl.entry, required);
  if (dsl.exit.condition) collectFeatures(dsl.exit.condition, required);
  return [...required];
}

/**
 * Which (strategy, instrument) pairs have a live entry signal on the last bar.
 *
 * Split out from `scanForSignals` because two consumers need the same three-valued evaluation and
 * only one of them wants a `QuantCandidate`. The board (`lib/execution/board.ts`) needs the spec
 * and the bars so it can price a stop and a target; the contract type carries neither and is
 * frozen. Duplicating the loop would have meant two warm-up rules and two definitions of
 * "unknown", which is exactly the divergence this module exists to prevent.
 */
export function firedSignals(
  specs: readonly ScannableSpec[],
  dataset: Readonly<Record<string, readonly Candle[]>>,
  symbolFor: (instrumentId: string) => string = (id) => id,
): SignalSweep {
  const fired: FiredSignal[] = [];
  const refusals = new Set<string>();
  const warmups: WarmupRefusal[] = [];
  let evaluated = 0;

  const instruments = Object.entries(dataset);
  // Grouped by the features they are missing rather than reported per strategy. Three strategies
  // all needing `market_cap` is one capability gap, not three problems, and printing it three
  // times every cycle forever is how a refusal list becomes something nobody reads.
  const blockedByFeature = new Map<string, string[]>();

  for (const spec of specs) {
    const required = requiredFeatures(spec.dsl);
    const underivable = required.filter((feature) => !isDerivable(feature));
    if (underivable.length > 0) {
      // Checked once per strategy, before any panel is built. A strategy needing `market_cap`
      // cannot be scanned however much price history arrives, and discovering that per instrument
      // would repeat the same work for every symbol in the universe.
      const key = [...underivable].sort().join(", ");
      blockedByFeature.set(key, [...(blockedByFeature.get(key) ?? []), spec.name]);
      continue;
    }

    const targetPrefix = spec.dsl.universe.market === "NSE" ? "IN:XNSE:" : spec.dsl.universe.market === "BSE" ? "IN:XBOM:" : "US:";
    for (const [instrumentId, bars] of instruments) {
      // Exchange gate: NSE strategies scan NSE instruments only, BSE strategies scan BSE only.
      // This prevents BSE (.BO) instruments from leaking into NSE candidate paths and vice versa.
      if (!instrumentId.startsWith(targetPrefix)) {
        continue;
      }
      // Two bars minimum: crossover and crossunder are events *between* consecutive bars and are
      // unknowable from one.
      if (bars.length < 2) {
        refusals.add(`${symbolFor(instrumentId)}: fewer than two bars.`);
        continue;
      }

      // Session context, or an intraday strategy's opening range comes back undefined here and the
      // scan reports "still inside its warm-up window" forever — a wiring gap that reads as a
      // legitimate refusal.
      const panel = buildFeaturePanel(bars, {
        market: marketOf(spec.dsl.universe.market),
        resolution: spec.dsl.universe.resolution,
      });
      const last = bars.length - 1;
      evaluated += 1;

      if (!panel.ready(last, required)) {
        // Warm-up, split into the two concepts. If fewer bars are held than the required features
        // need, it is a DATA condition — resolvable by ingesting more history, with a countable
        // gap. If enough bars are held but a feature is still not ready, the remaining gate is
        // TIME: a session-gated feature (an opening range whose window has not yet closed), which
        // the market clock resolves, not more bars. Reporting a bar count for that case would be a
        // fabricated number.
        const barsHeld = bars.length;
        const barsNeeded = warmupBarsFor(required);
        const timeGated = barsHeld >= barsNeeded;
        warmups.push({ instrumentId, specName: spec.name, barsHeld, barsNeeded, timeGated });
        refusals.add(
          timeGated
            ? `${symbolFor(instrumentId)}: ${spec.name} has its history but is waiting on a session ` +
                `window (e.g. the opening range) to close.`
            : `${symbolFor(instrumentId)}: ${spec.name} is still inside its warm-up window ` +
                `(${barsHeld}/${barsNeeded} bars).`,
        );
        continue;
      }

      const signalled = evaluate(spec.dsl.entry, panel.at(last), panel.at(last - 1));
      if (signalled === undefined) {
        // Distinct from `false`. Reporting an unknown as "no signal" is the failure this module
        // is shaped to avoid.
        refusals.add(`${symbolFor(instrumentId)}: ${spec.name} could not be evaluated on the last bar.`);
        continue;
      }
      if (!signalled) continue;

      fired.push({ spec, instrumentId, bars, at: last });
    }
  }

  for (const [features, names] of blockedByFeature) {
    refusals.add(
      `${names.length} strateg${names.length === 1 ? "y" : "ies"} need ${features}, which price data cannot supply: ${names.sort().join(", ")}.`,
    );
  }

  // The capability graph watches the same sweeps every consumer renders from. The board's own
  // scan path never reported anything, so `scanner.run` stayed "UNKNOWN — Requires quant core
  // data" forever; this is the one choke point both the board and the candidate generator walk
  // through, so the graph updates exactly once per real scan, honestly: READY when pairs were
  // assessed, DEGRADED when data existed but nothing was evaluable (warm-up/refusals), and left
  // untouched when the dataset is empty. A health change is an event — the same ledger the Brain
  // renders lanes from.
  recordScanCapabilityHealth(evaluated, Object.keys(dataset).length);

  return { fired, evaluated, refusals: [...refusals], warmups };
}

/**
 * Reflect the outcome of a real scan in the capability graph, emitting CAPABILITY_HEALTH_CHANGED
 * only when the health actually changed. An empty dataset is "no evidence yet" — the capability
 * keeps whatever standing it had (UNKNOWN at startup), never a fabricated verdict.
 */
function recordScanCapabilityHealth(evaluatedPairs: number, instrumentCount: number): void {
  const capability = getAllCapabilities().find((c) => c.capabilityId === "scanner.run");
  if (!capability) return;
  const before = capability.health;

  if (instrumentCount > 0 && evaluatedPairs > 0) {
    updateCapabilityHealth(
      "scanner.run",
      "READY",
      `Quant core evaluated ${evaluatedPairs} strategy × instrument pair(s).`,
    );
  } else if (instrumentCount > 0) {
    updateCapabilityHealth(
      "scanner.run",
      "DEGRADED",
      "No strategy × instrument pair evaluable — warm-up windows or feature refusals.",
    );
  }

  const after = getAllCapabilities().find((c) => c.capabilityId === "scanner.run");
  if (after && after.health !== before) {
    emit({
      kind: "CAPABILITY_HEALTH_CHANGED",
      capabilityId: "scanner.run",
      health: after.health,
      reason: after.healthReason,
      at: new Date().toISOString(),
    });
  }
}

export function scanForSignals(
  specs: readonly ScannableSpec[],
  dataset: Readonly<Record<string, readonly Candle[]>>,
  symbolFor: (instrumentId: string) => string = (id) => id,
): SignalScan {
  const sweep = firedSignals(specs, dataset, symbolFor);

  const candidates: QuantCandidate[] = sweep.fired.map((signal) => {
    const { verdict, blockers } = verdictFor(signal.spec.status);
    return {
      symbol: symbolFor(signal.instrumentId),
      // The engine is long-only — `runBacktest` computes `(exit - entry) / entry` with no short
      // path — so claiming a short candidate would describe a trade this system cannot model.
      side: "PAPER_LONG_CANDIDATE",
      setup: signal.spec.name,
      // Null, deliberately. An entry condition is a boolean; it carries no strength, and a
      // fabricated score would be ranked on by whoever reads the board.
      score: null,
      verdict,
      blockers,
    };
  });

  // Strongest first, then by symbol so the ordering is stable across passes and two boards can be
  // diffed without spurious churn.
  const rank = { PAPER_CANDIDATE: 0, RESEARCH_ONLY: 1, BLOCKED: 2 };
  candidates.sort(
    (a, b) => rank[a.verdict] - rank[b.verdict] || a.symbol.localeCompare(b.symbol) || a.setup!.localeCompare(b.setup!),
  );

  emit({ kind: "SCANNER_COMPLETED", instrumentsScanned: Object.keys(dataset).length, signals: candidates.length });

  return { candidates, evaluated: sweep.evaluated, refusals: sweep.refusals };
}
