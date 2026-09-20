/**
 * Raising a spec's declared cost to what its trading actually pays — without breaking the spec.
 *
 * This lived in two places (the cycle's self-repair and `scripts/repair-strategy-costs.mts`) and
 * the two agreed until they didn't. Both replaced the whole `costs` object with two fields, which
 * silently dropped `assumedSpreadBps` — a field the DSL *requires* at intraday resolution. The
 * result was found in the live database on 2026-09-20: all ten intraday specs unreadable, every
 * cycle refusing them with "cannot be replayed until it is recompiled", and the intraday research
 * lane quietly dead while every unit test passed.
 *
 * One function now, so a future correction cannot land in one copy and miss the other.
 */
import { ASSUMED_SLIPPAGE_BPS } from "@/lib/paper/capital";
import type { IndiaProduct } from "@/lib/paper/fees";
import { costStanding, requiredCostBps } from "./cost-gate";
import { parseStrategyDefinition } from "./definition";
import { isIntradayResolution } from "./dsl";

export type CostRepair =
  | { kind: "sound" }
  /** The DSL cannot be read, before or after the repair. Report it; never guess its shape. */
  | { kind: "unrepairable"; message: string }
  | { kind: "repaired"; json: string; product: IndiaProduct; declaredBps: number; requiredBps: number };

/** The product a spec's resolution implies. Intraday never pays the delivery DP fee. */
export function impliedProduct(dslJson: string): IndiaProduct {
  try {
    const resolution = (JSON.parse(dslJson) as { universe?: { resolution?: unknown } })?.universe?.resolution;
    return typeof resolution === "string" && isIntradayResolution(resolution) ? "INTRADAY" : "DELIVERY";
  } catch {
    return "DELIVERY";
  }
}

export function repairDeclaredCosts(dslJson: string): CostRepair {
  const product = impliedProduct(dslJson);
  const standing = costStanding(dslJson, product);
  if (!standing.understated) return { kind: "sound" };

  const requiredBps = requiredCostBps(product);
  let json: string;
  try {
    const parsed = JSON.parse(dslJson) as Record<string, unknown>;
    const costs = (parsed.costs ?? {}) as Record<string, unknown>;
    // The spread is charged once per round trip (`roundTripCostBps`), so it counts toward the
    // requirement rather than on top of it — and it is kept, not overwritten.
    const spread = typeof costs.assumedSpreadBps === "number" ? costs.assumedSpreadBps : 0;
    const perSide = Math.max(0, Math.ceil(Math.max(0, requiredBps - spread) / 2) - ASSUMED_SLIPPAGE_BPS);
    parsed.costs = { ...costs, commissionBps: perSide, slippageBps: ASSUMED_SLIPPAGE_BPS };
    json = JSON.stringify(parsed);
  } catch {
    return { kind: "unrepairable", message: "its DSL will not parse, so it cannot be repaired without guessing its shape" };
  }

  // A repair that leaves the subject unreadable is not a repair. Checked here, once, for both callers.
  const readable = parseStrategyDefinition(json);
  if (!readable.ok) return { kind: "unrepairable", message: `the corrected DSL would not parse (${readable.message})` };

  return { kind: "repaired", json, product, declaredBps: standing.declaredBps, requiredBps };
}
