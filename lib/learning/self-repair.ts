import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/brain/event-bus";
import { recordAudit } from "@/lib/knowledge/repository";
import { ASSUMED_SLIPPAGE_BPS, OWNER_CAPITAL } from "@/lib/paper/capital";
import { costStanding, requiredCostBps } from "@/lib/strategy/cost-gate";

/**
 * What the system fixes about itself, and what it refuses to fix.
 *
 * ## The line, and why it is drawn here
 *
 * A system that repairs itself is useful. A system that *decides* things about itself and then
 * repairs them is a system that can talk itself into anything. So the rule is narrow:
 *
 * > **Repair only what is provably a defect against an external fact. Report everything that is
 * > a judgement.**
 *
 * A strategy declaring 20 bps of round-trip cost when the published fee schedule says 24 is not
 * an opinion — the rates are facts, the arithmetic is checkable, and no reading of the evidence
 * makes the declaration correct. That is repairable.
 *
 * The paper account starting at ₹1,00,000 when the owner said ₹1,000 is *not* repairable, even
 * though it is just as wrong. Which figure is right depends on what the owner meant, and a system
 * that quietly rewrites the owner's stated capital to match its own database has stopped being
 * a tool. It is reported, loudly, every cycle, and left alone.
 *
 * ## Why repairs are recorded as governed actions
 *
 * A repair is a write the owner did not ask for. Every one goes through `recordAudit` with its
 * before and after values, so "the system changed something while I was asleep" is always
 * answerable with what, when and why. An unlogged self-repair is indistinguishable from a bug.
 *
 * ## Why nothing here deletes
 *
 * `repair-strategy-costs.mts` — the manual version of the first repair below — also discards
 * validation rows computed under the wrong cost, because pairing an honest declaration with
 * numbers measured against a cheaper market is worse than either alone. Deletion is deliberately
 * *not* automated: evidence destroyed on a schedule cannot be reviewed before it goes. The loop
 * repairs the declaration and reports the stale rows for the owner to clear.
 */

export type RepairOutcome = "repaired" | "reported" | "failed";

export interface Repair {
  defect: string;
  subject: string;
  outcome: RepairOutcome;
  detail: string;
}

export interface SelfRepairReport {
  repaired: number;
  reported: number;
  failed: number;
  repairs: Repair[];
  summary: string;
}

export function runSelfRepair(actor = "self-repair"): SelfRepairReport {
  const repairs: Repair[] = [
    ...repairUnderstatedCosts(actor),
    ...reportCapitalDrift(),
  ];

  for (const repair of repairs) {
    if (repair.outcome === "repaired" || repair.outcome === "reported") {
      emit({ kind: "INCIDENT_CREATED", incidentId: `incident_${repair.subject.replace(/\s+/g, "_")}`, severity: repair.outcome === "repaired" ? "low" : "medium", description: `${repair.defect}: ${repair.detail}` });
    }
  }

  const count = (outcome: RepairOutcome) => repairs.filter((repair) => repair.outcome === outcome).length;
  const repaired = count("repaired");
  const reported = count("reported");
  const failed = count("failed");

  return {
    repaired,
    reported,
    failed,
    repairs,
    summary:
      repairs.length === 0
        ? "Self-repair found nothing to fix."
        : `Self-repair: ${repaired} fixed, ${reported} reported for the owner, ${failed} failed.`,
  };
}

/**
 * Strategies whose declared cost is below the published schedule.
 *
 * Repairable because the gap is arithmetic against rates this system did not invent. The DSL is
 * rewritten to declare the true cost; the strategy then drops back down the ladder on its own,
 * because `evidenceFor` will pair the new declaration with validation rows measured against the
 * old one — which is exactly the state the owner should see rather than a silently promoted spec.
 */
function repairUnderstatedCosts(actor: string): Repair[] {
  const db = getDb();
  const required = requiredCostBps();
  const perSide = Math.max(0, Math.ceil(required / 2) - ASSUMED_SLIPPAGE_BPS);
  const repairs: Repair[] = [];

  for (const spec of db.select().from(schema.strategySpecs).all()) {
    const standing = costStanding(spec.dsl);
    if (!standing.understated) continue;

    let updated: string;
    try {
      const parsed = JSON.parse(spec.dsl) as Record<string, unknown>;
      parsed.costs = { commissionBps: perSide, slippageBps: ASSUMED_SLIPPAGE_BPS };
      updated = JSON.stringify(parsed);
    } catch {
      // A spec whose DSL will not parse cannot be repaired without guessing its shape. Reported
      // rather than rewritten: inventing a structure for it would destroy whatever it held.
      repairs.push({
        defect: "cost_understated",
        subject: spec.name,
        outcome: "failed",
        detail: `${spec.name} declares too little cost, but its DSL will not parse, so it cannot be repaired without guessing its shape.`,
      });
      continue;
    }

    try {
      db.update(schema.strategySpecs).set({ dsl: updated }).where(eq(schema.strategySpecs.id, spec.id)).run();

      const stale = db
        .select()
        .from(schema.validationResults)
        .where(eq(schema.validationResults.strategySpecId, spec.id))
        .all().length;

      const detail =
        `Declared cost raised from ${standing.declaredBps} to ${required} bps to match the published ` +
        `schedule at the owner's capital.` +
        (stale
          ? ` ${stale} validation result(s) were computed against the old figure and are now stale — ` +
            `they are left in place for review rather than deleted on a schedule.`
          : "");

      recordAudit({
        actor,
        action: "self_repair",
        decision: "allowed",
        subject: spec.id,
        detail,
      });

      emit({ kind: "REPAIR_COMPLETED", incidentId: `repair_${spec.id}`, action: "cost_understated_fixed" });
      repairs.push({ defect: "cost_understated", subject: spec.name, outcome: "repaired", detail });
    } catch (caught) {
      repairs.push({
        defect: "cost_understated",
        subject: spec.name,
        outcome: "failed",
        detail: caught instanceof Error ? caught.message.split("\n")[0] : String(caught),
      });
    }
  }

  return repairs;
}

/**
 * The paper account disagreeing with the owner's stated capital.
 *
 * **Deliberately not repaired.** Both numbers are assertions by a human — one typed into
 * `OWNER_CAPITAL`, one seeded into the account — and nothing here can tell which is current. A
 * system that resolves that by overwriting either has decided how much money the owner has.
 *
 * Reported every cycle instead, because the consequence is severe and silent: paper results from
 * an account ten thousand times too large describe a regime where costs round to nothing, which
 * is the one regime this owner is not in.
 */
function reportCapitalDrift(): Repair[] {
  try {
    const account = getDb()
      .select()
      .from(schema.paperAccounts)
      .where(eq(schema.paperAccounts.currency, "INR"))
      .get();
    if (!account) return [];
    if (Math.abs(account.startingCash - OWNER_CAPITAL.amount) <= 1) return [];

    return [
      {
        defect: "capital_drift",
        subject: "INR paper account",
        outcome: "reported",
        detail:
          `The INR paper account starts at ${account.startingCash.toLocaleString("en-IN")} but the owner's ` +
          `stated capital is ${OWNER_CAPITAL.amount.toLocaleString("en-IN")}. Not repaired automatically: ` +
          "which figure is current is the owner's to say, and a system that rewrites either has decided " +
          "how much money they have. Run `npx tsx scripts/set-paper-capital.mts` to align them.",
      },
    ];
  } catch {
    return [];
  }
}
