import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { Panel, StatTile } from "@/components/system/Panel";
import {
  MAX_POSITION_PCT,
  MIN_POSITION_VALUE,
  OWNER_CAPITAL,
  minimumTradableCapital,
  viableConfiguration,
} from "@/lib/paper/capital";
import { costDrag, roundTripCost, CostModelError } from "@/lib/paper/cost-model";

/**
 * Can this account earn, at the size it actually is?
 *
 * The question the system could not previously answer anywhere. Every cost in `lib/paper/fees.ts`
 * is percentage-based and therefore size-neutral, which is exactly why the one flat charge —
 * Zerodha's DP fee, ₹13.50 + 18% GST ≈ ₹15.93 per scrip per settlement — was invisible. On a
 * ₹1,00,000 position it is 0.016% and irrelevant. On a ₹1,000 position it is 1.6%, which is an
 * order of magnitude larger than the edge published daily-equity strategies claim.
 *
 * Shown here rather than buried in a report because it is the first thing that decides whether
 * any of the rest matters. A strategy with a genuine edge and a position too small to carry it
 * loses money with perfect discipline.
 */

const LADDER = [1_000, 2_000, 5_000, 10_000, 23_000, 100_000];

function pct(value: number, digits = 3): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function CostViabilityPanel() {
  const account = getDb()
    .select()
    .from(schema.paperAccounts)
    .where(eq(schema.paperAccounts.currency, "INR"))
    .get();

  // The paper account is the truth about what is being simulated; `OWNER_CAPITAL` is what the
  // owner said. When they disagree, the paper results describe an account that does not exist —
  // so the disagreement is shown rather than silently resolved in favour of either.
  const capital = account?.startingCash ?? OWNER_CAPITAL.amount;
  const drifted = Math.abs(capital - OWNER_CAPITAL.amount) > 1;

  const intradayFloor = safely(() => minimumTradableCapital({ market: "IN", product: "INTRADAY" }));
  const deliveryFloor = safely(() => minimumTradableCapital({ market: "IN", product: "DELIVERY" }));

  let current: ReturnType<typeof viableConfiguration> | null = null;
  let refusal: string | null = null;
  try {
    current = viableConfiguration(capital, "IN");
  } catch (caught) {
    refusal = caught instanceof CostModelError ? caught.message : String(caught);
  }

  const drag = current
    ? safely(() =>
        costDrag({
          capital,
          positions: current.positions,
          roundTripsPerYear: 12,
          market: "IN",
          product: current.product,
        }),
      )
    : null;

  return (
    <Panel title="COST & CAPITAL VIABILITY">
      {drifted ? (
        <p className="text-[11px] text-amber mb-3 border border-amber/40 bg-amber/5 px-2 py-1.5">
          The paper account starts at {rupees(capital)} but the owner&rsquo;s stated capital is{" "}
          {rupees(OWNER_CAPITAL.amount)}. Paper results describe an account that does not exist — run{" "}
          <code>npx tsx scripts/set-paper-capital.mts</code> to align them.
        </p>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="Capital" value={rupees(capital)} hint={`stated ${OWNER_CAPITAL.statedOn}`} />
        <StatTile
          label="Tradable product"
          value={current ? current.product : "NONE"}
          tone={current ? "good" : "bad"}
          hint={current ? `${current.positions} × ${rupees(current.positionSize)}` : "below every floor"}
        />
        <StatTile
          label="Round trip"
          value={current ? pct(current.costPerRoundTripPct) : "—"}
          tone={current && current.costPerRoundTripPct <= 0.002 ? "good" : "warn"}
          hint="cost per completed trade"
        />
        <StatTile
          label="Break-even edge"
          value={drag ? pct(drag.breakEvenEdgePct, 2) : "—"}
          tone={drag && drag.breakEvenEdgePct > 0.005 ? "bad" : "neutral"}
          hint="per trade, before any profit"
        />
      </div>

      {refusal ? (
        <p className="text-[11px] text-loss mt-3 leading-relaxed">{refusal}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">{current?.reason}</p>
      )}

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          What each capital level can trade
        </div>
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 font-normal">Capital</th>
              <th className="py-1 font-normal">Product</th>
              <th className="py-1 font-normal">Shape</th>
              <th className="py-1 font-normal text-right">Round trip</th>
            </tr>
          </thead>
          <tbody>
            {LADDER.map((amount) => {
              const row = safely(() => viableConfiguration(amount, "IN"));
              const here = amount === LADDER.find((value) => value >= capital);
              return (
                <tr key={amount} className={`border-t border-panel ${here ? "bg-panel-alt" : ""}`}>
                  <td className="py-1">{rupees(amount)}</td>
                  <td className={`py-1 ${row ? "" : "text-loss"}`}>{row ? row.product : "refused"}</td>
                  <td className="py-1 text-muted-foreground">
                    {row ? `${row.positions} × ${rupees(row.positionSize)}` : "—"}
                  </td>
                  <td className="py-1 text-right">{row ? pct(row.costPerRoundTripPct) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-muted-foreground leading-relaxed">
        <div>
          <div className="text-foreground mb-1">Why delivery needs {deliveryFloor ? rupees(deliveryFloor) : "far more"}</div>
          The DP charge is <strong>flat</strong> — ₹15.93 per scrip per settlement, the same on ₹500 as on
          ₹5,00,000 — and delivery STT is 0.1% on <strong>both</strong> legs. A round trip therefore never
          costs less than about {pct(roundTripCost({ market: "IN", product: "DELIVERY", notional: 10_000_000 }).pctOfNotional, 2)},
          however large the position.
        </div>
        <div>
          <div className="text-foreground mb-1">Why intraday reaches {intradayFloor ? rupees(intradayFloor) : "lower"}</div>
          Nothing leaves the demat account on a square-off, so no DP charge arises, and STT is 0.025%
          sell-side only. Every remaining charge is proportional, so the ratio is flat at{" "}
          {pct(roundTripCost({ market: "IN", product: "INTRADAY", notional: 1_000 }).pctOfNotional)} from{" "}
          {rupees(MIN_POSITION_VALUE)} upward — it does not shrink, but it does not grow either.
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed border-t border-panel pt-2">
        Two floors combine: the {MAX_POSITION_PCT}% concentration cap needs at least{" "}
        {Math.ceil(100 / MAX_POSITION_PCT)} positions, and a position below {rupees(MIN_POSITION_VALUE)} cannot
        buy one share of most of the liquid NSE universe. That second figure is stated, not derived — raise it
        for a large-cap-only universe.
      </p>
    </Panel>
  );
}

/** A viability question that cannot be answered is shown as unanswered, never as a zero. */
function safely<T>(compute: () => T): T | null {
  try {
    return compute();
  } catch {
    return null;
  }
}
