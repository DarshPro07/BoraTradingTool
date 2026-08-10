import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { forwardScorecard } from "@/lib/forward/shadow";
import { paperScorecard } from "@/lib/forward/paper";
import { alphaHealthFor } from "@/lib/quant/alpha-health";

export const dynamic = "force-dynamic";

/**
 * The forward evidence surface: every challenger with its scorecard, plus the strategies that
 * could be activated (a gauntlet experiment exists, no challenger yet).
 */
export async function GET() {
  const db = getDb();
  const challengers = db.select().from(schema.forwardChallengers).all();
  const scorecards = challengers
    .map((challenger) => forwardScorecard(challenger.id))
    .filter((card): card is NonNullable<typeof card> => card !== null)
    .map((card) => ({ ...card, paper: paperScorecard(card.challengerId), alphaHealth: alphaHealthFor(card.challengerId) }));

  const observed = new Set(challengers.map((challenger) => challenger.strategySpecId));
  const gauntleted = new Set(
    db
      .select()
      .from(schema.experiments)
      .where(eq(schema.experiments.kind, "gauntlet"))
      .all()
      .map((experiment) => experiment.strategySpecId),
  );
  const eligible = db
    .select()
    .from(schema.strategySpecs)
    .all()
    .filter((spec) => gauntleted.has(spec.id) && !observed.has(spec.id))
    .map((spec) => ({ id: spec.id, name: spec.name }));

  return NextResponse.json({ scorecards, eligible });
}
