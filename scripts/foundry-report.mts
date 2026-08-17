/**
 * Run the plausibility gate over the initial hypothesis classes and record what survives.
 *
 * Records into `research_hypotheses` — the table that already exists — with the nine-field economic
 * record and its semantic fingerprint in `rationale`. No migration, and prior art becomes queryable
 * by the same fingerprint that decides whether an idea is new.
 *
 * Nothing here runs a backtest. Admission means an idea has earned the right to become a RESEARCH
 * PROBE, which is still not a campaign trial.
 *
 * Usage:  npx tsx scripts/foundry-report.mts [--record]
 */
import { getDb, schema } from "@/lib/db";
import { recordHypothesis } from "@/lib/knowledge/repository";
import { assessPlausibility, findPriorArt, semanticFingerprint, type HypothesisRecord } from "@/lib/research/hypothesis-foundry";
import { INITIAL_HYPOTHESES, CLASS_PRIORITY } from "@/lib/research/hypothesis-classes";

const record = process.argv.includes("--record");
// Price and volume only. Everything the store holds today, and a hard stop on the four research
// lanes whose data is absent (docs/plans/rehearsal-funnel/06-data-availability-and-horizon.md).
const AVAILABLE = new Set(["daily_close", "daily_volume"]);

const known: HypothesisRecord[] = getDb()
  .select()
  .from(schema.researchHypotheses)
  .all()
  .flatMap((row) => {
    try {
      const parsed = JSON.parse(row.rationale ?? "{}") as { fingerprint?: string; klass?: string };
      if (!parsed.fingerprint) return [];
      return [
        {
          id: row.id,
          fingerprint: parsed.fingerprint,
          klass: parsed.klass as HypothesisRecord["klass"],
          stage: "HYPOTHESIS" as const,
        },
      ];
    } catch {
      return [];
    }
  });

console.log(`Hypothesis Foundry — ${INITIAL_HYPOTHESES.length} hypotheses across ${CLASS_PRIORITY.length} classes`);
console.log(`Prior art in store: ${known.length}\n`);

let admitted = 0;
for (const klass of CLASS_PRIORITY) {
  const inClass = INITIAL_HYPOTHESES.filter((h) => h.klass === klass);
  if (inClass.length === 0) continue;
  console.log(`${CLASS_PRIORITY.indexOf(klass) + 1}. ${klass}`);

  for (const h of inClass) {
    const verdict = assessPlausibility(h, AVAILABLE);
    const art = findPriorArt(h, known);
    const mark = verdict.admitted ? "ADMIT " : "REFUSE";
    console.log(`   [${mark}] ${h.id}  ${h.title}`);
    console.log(
      `            prior ${h.expectedGrossEffectBps} bps vs ${h.expectedAllInCostBps} bps cost = ` +
        `${verdict.actualRatio.toFixed(2)}x (needs ${verdict.requiredRatio}x)  ·  ${art.status}`,
    );
    if (!verdict.admitted) console.log(`            ${verdict.reason}`);

    if (verdict.admitted) admitted += 1;

    if (record) {
      recordHypothesis({
        title: h.title,
        statement: h.mechanism,
        market: "NSE",
        createdBy: "hypothesis-foundry",
        // The whole economic record travels with the hypothesis. A title alone is not a hypothesis.
        rationale: JSON.stringify({
          fingerprint: semanticFingerprint(h),
          klass: h.klass,
          foundryId: h.id,
          stage: verdict.admitted ? "RESEARCH_PROBE_ELIGIBLE" : "HYPOTHESIS",
          plausibility: verdict,
          evidenceBasis: h.evidenceBasis,
          sourceReferences: h.sourceReferences,
          nineFields: {
            mechanism: h.mechanism,
            counterpartyOrConstraint: h.counterpartyOrConstraint,
            persistenceReason: h.persistenceReason,
            formationHorizon: h.formationHorizon,
            holdingHorizon: h.holdingHorizon,
            expectedGrossEffectBps: h.expectedGrossEffectBps,
            expectedAllInCostBps: h.expectedAllInCostBps,
            capacityConstraint: h.capacityConstraint,
            falsificationCondition: h.falsificationCondition,
          },
        }),
      });
    }
  }
  console.log();
}

console.log(`Admitted to RESEARCH PROBE: ${admitted} / ${INITIAL_HYPOTHESES.length}`);
console.log(
  record
    ? "Recorded to research_hypotheses."
    : "Report only. Re-run with --record to persist.",
);
console.log(
  "\nAdmission is permission to build ONE canonical implementation and measure gross economics.\n" +
    "It is not a campaign, not a trial, and spends no statistical budget. QC-001 is untouched.",
);
