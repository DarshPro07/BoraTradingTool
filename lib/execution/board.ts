import { getDb, schema } from "@/lib/db";
import { findCurrentInstrument } from "@/lib/market/catalog";
import type { Candle } from "@/lib/providers/types";
import { firedSignals, type ScannableSpec } from "@/lib/quantcore/signals";
import { DEFAULT_RULES, type RiskRules } from "@/lib/risk/gate";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { isActionable, type Stage } from "@/lib/strategy/lifecycle";
import { standings } from "@/lib/strategy/promotion";
import { buildGateContext } from "./context";
import { buildProposal, type Proposal } from "./proposal";

/**
 * The trade board — the loop's last leg.
 *
 * The reference architecture's autonomy loop ends
 * `PaperForward → OwnerReview → ConfirmationQueue`. Every stage before that was built: a compiler,
 * a gauntlet, a sealed holdout, a forward record, a promotion ladder, a risk gate, a proposal type
 * with a computed maximum loss. The last arrow was never drawn. `app/trades/page.tsx` opened with
 * `const proposals: Proposal[] = []` and `evaluateGate` was called from nothing but its own test —
 * so the risk kernel was enforced on no path at all, while looking exactly like a gate that had
 * simply never had cause to block.
 *
 * This module draws that arrow: eligible strategies → live signals → priced tickets → gate verdict.
 *
 * ## What it refuses to do
 *
 * - **Price a strategy that declares no stop.** The maximum loss would be unbounded, and an
 *   unbounded worst case on a ticket is the single most dangerous thing this system could print.
 * - **Invent a target.** A strategy exiting on time or condition has no take-profit price. A
 *   conventional 2R target would appear on the ticket as though the strategy had produced it.
 * - **Clamp size to the risk ceiling.** If a strategy asks for more units than the owner's rules
 *   permit, the gate blocks and the board says so. Quietly trimming the size would place a
 *   different trade from the one that was validated, under the validated one's name.
 * - **Propose below `owner_review`.** Every rung up to and including `validated` is measured on
 *   data the strategy was selected against. Only forward observations are unbiased.
 */

export interface BoardEntry {
  proposal: Proposal;
  specId: string;
  stage: Stage;
  /** Gate rule → why its input was not establishable. Drives "missing input" vs "risk breach". */
  unavailable: Record<string, string>;
  /** Units the strategy's own sizing rule asked for, before the gate saw it. */
  requested: number;
}

export interface EligibleStrategy {
  specId: string;
  name: string;
  stage: Stage;
  /** Forward observations that have resolved. The only unbiased evidence behind a proposal. */
  forwardResolved: number;
}

export interface TradeBoard {
  entries: BoardEntry[];
  /** Strategies that have earned the right to propose, whether or not one fired today. */
  eligible: EligibleStrategy[];
  /** Why fewer tickets exist than instruments scanned. Deduplicated. */
  refusals: string[];
  /** Strategy × instrument pairs actually evaluated. Zero means nothing was looked at. */
  scanned: number;
  /** Configuration conflicts the owner has to resolve — not failures, decisions. */
  notes: string[];
}

const DECISION_RANK = { ALLOW_FOR_CONFIRMATION: 0, DEFER: 1, BLOCK: 2 } as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Paper equity: settled cash plus the cost basis of what is held. */
function paperEquity(): number {
  const db = getDb();
  const cash = db
    .select()
    .from(schema.paperAccounts)
    .all()
    .reduce((total, account) => total + account.cash, 0);
  const held = db
    .select()
    .from(schema.paperPositions)
    .all()
    .reduce((total, position) => total + position.quantity * position.averageCost, 0);
  return cash + held;
}

/**
 * Markets the board would need bars for, computed before any are fetched.
 *
 * Called first by the page so that a system with nothing at `owner_review` — the normal state —
 * fetches nothing at all. Building the board first and discovering it had no eligible strategies
 * would mean two dozen provider calls per render to produce an empty list.
 */
export function eligibleMarkets(): ("US" | "NSE" | "BSE")[] {
  const specsById = new Map(getDb().select().from(schema.strategySpecs).all().map((spec) => [spec.id, spec]));
  const markets = new Set<"US" | "NSE" | "BSE">();

  for (const standing of standings()) {
    if (!isActionable(standing.stage)) continue;
    const spec = specsById.get(standing.specId);
    if (!spec) continue;
    try {
      const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
      if (parsed.success) markets.add(parsed.data.universe.market);
    } catch {
      // Reported properly by `buildTradeBoard`, which has somewhere to put the refusal.
    }
  }
  return [...markets];
}

export interface BoardInput {
  /** Instrument id → bars, most recent last. The same dataset the cycle already fetched. */
  dataset: Readonly<Record<string, readonly Candle[]>>;
  now?: Date;
  rules?: RiskRules;
  /** Injectable so a test does not need a paper account seeded. */
  equity?: number;
}

export function buildTradeBoard(input: BoardInput): TradeBoard {
  const now = input.now ?? new Date();
  const rules = input.rules ?? DEFAULT_RULES;
  const refusals = new Set<string>();
  const notes = new Set<string>();

  const db = getDb();
  const specsById = new Map(db.select().from(schema.strategySpecs).all().map((spec) => [spec.id, spec]));
  const outcomes = db.select().from(schema.forwardOutcomes).all();

  const eligible: EligibleStrategy[] = [];
  const scannable: ScannableSpec[] = [];
  const dslById = new Map<string, StrategyDsl>();

  for (const standing of standings()) {
    if (!isActionable(standing.stage)) continue;
    const spec = specsById.get(standing.specId);
    if (!spec) continue;

    eligible.push({
      specId: standing.specId,
      name: standing.name,
      stage: standing.stage,
      forwardResolved: outcomes.filter((row) => row.strategySpecId === standing.specId && row.outcome !== "open").length,
    });

    // A spec that will not parse cannot be scanned. Reported rather than skipped silently: a
    // strategy that reached owner review and then failed to load is a data-integrity problem,
    // not an absence of signal.
    let parsed: StrategyDsl;
    try {
      const result = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
      if (!result.success) {
        refusals.add(`${standing.name}: stored DSL no longer validates — ${result.error.issues[0]?.message ?? "unknown"}.`);
        continue;
      }
      parsed = result.data;
    } catch {
      refusals.add(`${standing.name}: stored DSL is not readable JSON.`);
      continue;
    }

    dslById.set(standing.specId, parsed);
    scannable.push({ id: standing.specId, name: standing.name, status: standing.stage, dsl: parsed });
  }

  if (scannable.length === 0) {
    return { entries: [], eligible, refusals: [...refusals], scanned: 0, notes: [...notes] };
  }

  const symbolFor = (instrumentId: string) =>
    findCurrentInstrument(instrumentId)?.symbol ?? instrumentId;

  const sweep = firedSignals(scannable, input.dataset, symbolFor);
  for (const refusal of sweep.refusals) refusals.add(refusal);

  const equity = input.equity ?? paperEquity();
  const entries: BoardEntry[] = [];

  for (const signal of sweep.fired) {
    const dsl = dslById.get(signal.spec.id);
    if (!dsl) continue;
    const symbol = symbolFor(signal.instrumentId);

    const entryPrice = signal.bars[signal.at].close;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      refusals.add(`${symbol}: last close is not a usable price.`);
      continue;
    }

    // No stop, no ticket. `compileStrategy` only warns about this; here it is disqualifying,
    // because a warning at authoring time and an unbounded max loss on a live ticket are not the
    // same severity of problem.
    if (dsl.exit.stopLossPct === undefined) {
      refusals.add(
        `${signal.spec.name} fired on ${symbol} but declares no stop loss. ` +
          "Its worst case is unbounded, so no ticket can be written for it.",
      );
      continue;
    }

    const stopPrice = round(entryPrice * (1 - dsl.exit.stopLossPct / 100));
    const targetPrice =
      dsl.exit.takeProfitPct === undefined ? null : round(entryPrice * (1 + dsl.exit.takeProfitPct / 100));

    // The strategy's own cap, in units. Not clamped to the owner's ceiling — see the module note.
    const requested = Math.floor((equity * (dsl.sizing.maxPositionPct / 100)) / entryPrice);
    if (requested < 1) {
      refusals.add(
        `${signal.spec.name} on ${symbol}: ${dsl.sizing.maxPositionPct}% of ${round(equity)} equity does not buy ` +
          `one unit at ${round(entryPrice)}.`,
      );
      continue;
    }
    if (requested > rules.maxContracts) {
      notes.add(
        `${signal.spec.name} sizes to ${requested} unit(s) of ${symbol}, above the ceiling of ${rules.maxContracts}. ` +
          "The gate blocks on max_contracts. Reconcile the strategy's maxPositionPct with the risk rules — " +
          "the board will not quietly trim the size, because that places a different trade from the validated one.",
      );
    }

    const { context, unavailable } = buildGateContext({
      universeMarket: dsl.universe.market,
      requestedContracts: requested,
      strategySpecId: signal.spec.id,
      now,
      rules,
    });

    const currency = findCurrentInstrument(signal.instrumentId)?.currency ?? "USD";
    const forwardResolved = eligible.find((item) => item.specId === signal.spec.id)?.forwardResolved ?? 0;

    entries.push({
      specId: signal.spec.id,
      stage: signal.spec.status as Stage,
      unavailable,
      requested,
      proposal: buildProposal(
        {
          instrumentId: signal.instrumentId,
          symbol,
          side: "BUY",
          strategyId: signal.spec.id,
          strategyName: signal.spec.name,
          forwardObservations: forwardResolved,
          quantity: requested,
          entryPrice: round(entryPrice),
          stopPrice,
          targetPrice,
          currency,
        },
        context,
        rules,
        now,
      ),
    });
  }

  entries.sort(
    (a, b) =>
      DECISION_RANK[a.proposal.decision] - DECISION_RANK[b.proposal.decision] ||
      a.proposal.symbol.localeCompare(b.proposal.symbol) ||
      a.proposal.strategyName.localeCompare(b.proposal.strategyName),
  );

  return { entries, eligible, refusals: [...refusals], scanned: sweep.evaluated, notes: [...notes] };
}

/** One-line summary for the cycle report and the daemon log. */
export function boardSummary(board: TradeBoard): string {
  if (board.eligible.length === 0) {
    return "No strategy has reached owner review, so none has earned the right to propose a trade.";
  }
  if (board.scanned === 0) {
    // Distinct from "scanned and found nothing". No bars means nothing was looked at, and
    // reporting that as an absence of signal is the mistake this codebase keeps refusing to make.
    return `${board.eligible.length} strategy(ies) eligible, but no bars were available, so nothing was evaluated.`;
  }
  if (board.entries.length === 0) {
    return `${board.eligible.length} strategy(ies) eligible; ${board.scanned} pair(s) scanned, none fired an entry condition.`;
  }
  const counts = { ALLOW_FOR_CONFIRMATION: 0, DEFER: 0, BLOCK: 0 };
  for (const entry of board.entries) counts[entry.proposal.decision] += 1;
  return (
    `${board.entries.length} proposal(s) from ${board.scanned} scanned pair(s): ` +
    `${counts.ALLOW_FOR_CONFIRMATION} awaiting confirmation, ${counts.DEFER} deferred, ${counts.BLOCK} blocked.`
  );
}
