/**
 * The probe discovery ledger — making the search itself countable.
 *
 * ## The hole this closes
 *
 * After three probes the system could truthfully report `registeredTrialCount = 0` while having
 * inspected **thirteen market statistics on one historical dataset**. Both statements were true and
 * together they were misleading: no permanent trial had been spent, and thirteen opportunities to
 * notice something interesting had been taken. V01 made it concrete — its pre-registered primary
 * missed at t = 1.74, and a subsidiary cell came in at t = 3.01. Without a count, the second number
 * is indistinguishable from a discovery.
 *
 * PBO and DSR live at the registered-campaign stage and answer a different question — *which
 * strategy survived a declared search*. This answers the one before it: **how many chances have we
 * already given ourselves on this same data?**
 *
 * ## What counts, and what deliberately does not
 *
 * A statistic counts toward multiplicity if it **could cause a new hypothesis to be created**. That
 * is the operative test, not whether anyone called it a result.
 *
 * `CONTROL` is excluded, and the exclusion is principled rather than convenient: a control's
 * outcome is engineered in advance to validate the measuring apparatus, not to discover anything
 * about the market. Detecting a planted effect gives no licence to believe a real one. Counting
 * controls would also punish the very discipline that has now caught three fixture defects.
 *
 * ## What an adjusted p-value is not
 *
 * Holm and BH bound error rates across a family of tests. **Neither converts a post-hoc observation
 * into confirmatory evidence.** The hypothesis "a sharp fall on normal volume reverses" was formed
 * *after* seeing this dataset, and reusing one historical realisation for both discovery and
 * inference contaminates the inference no matter what the arithmetic says afterwards. An adjusted
 * p-value is not a retroactive pre-registration machine.
 *
 * ## And these adjustments are NOT anytime-valid error control
 *
 * A correction worth stating plainly, because the numbers this module prints invite the stronger
 * reading. Holm and BH are **offline** procedures: they assume a family fixed in advance. This
 * family is not. Hypotheses arrive adaptively over time, and which one is tested next depends on
 * what earlier looks showed — V01 was run because M02 and X01 had failed, and S01's MAX control
 * existed because X01 came first.
 *
 * Recomputing offline Holm over an ever-growing, adaptively-chosen family therefore gives
 * **retrospective search-burden context**, not formal sequential FWER control. Genuine anytime-valid
 * guarantees need online procedures — alpha-spending and its relatives — which this module does not
 * implement and does not need to, because the protection that matters here is structural rather
 * than statistical:
 *
 * ```
 * measured on DISCOVERY_DATA   -> cannot promote
 * POST_HOC_DISCOVERY           -> cannot promote
 * independent confirmation     -> required, on data that did not exist at discovery
 * ```
 *
 * Those are hard gates and they do the real work. The Holm column is a reader aid: it says "given
 * everything looked at, do not treat this as surprising", and it should never be quoted as though
 * it bounded an error rate over this sequence of decisions.
 */
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const DISCOVERY_ACTION = "probe_discovery";

/**
 * What a statistic was for. Only the role decides whether it consumes selection budget.
 *
 * `SECONDARY_PREDECLARED` counts even though it was declared in advance: declaring that you will
 * look at seven things does not make looking at seven things free.
 */
export type StatisticRole =
  | "PRIMARY_CONFIRMATORY"
  | "SECONDARY_PREDECLARED"
  | "DIAGNOSTIC"
  | "POST_HOC_DISCOVERY"
  | "CONTROL";

/** Data used to GENERATE hypotheses can never also serve as independent confirmation of them. */
export type DataRole = "DISCOVERY_DATA" | "INDEPENDENT_CONFIRMATION_DATA";

export interface DiscoveryLook {
  probeId: string;
  hypothesisId: string;
  statisticId: string;
  role: StatisticRole;
  /** Was this statistic named in the frozen contract before the probe ran? */
  declaredBeforeRun: boolean;
  /** Was a direction predicted, or registered as UNKNOWN? */
  directionDeclared: "POSITIVE" | "NEGATIVE" | "UNKNOWN" | "NOT_APPLICABLE";
  estimateBps: number;
  hacT: number;
  ci95Bps: [number, number];
  observations: number;
  /** The multiplicity family this look belongs to. */
  familyId: string;
  contractHash: string;
  cohortFingerprint: string;
  dataRole: DataRole;
  observedAt: string;
}

/** Roles whose looks consume selection budget. */
export function countsTowardMultiplicity(role: StatisticRole): boolean {
  return role !== "CONTROL";
}

/**
 * A post-hoc discovery can NEVER promote from the test that produced it, whatever its p-value.
 *
 * This is a hard structural rule rather than a threshold, because no amount of adjustment repairs
 * the fact that the hypothesis was read off the same data it would be tested on.
 */
export function canPromote(look: DiscoveryLook): boolean {
  if (look.role === "POST_HOC_DISCOVERY") return false;
  if (look.dataRole === "DISCOVERY_DATA") return false;
  return look.role === "PRIMARY_CONFIRMATORY" && look.declaredBeforeRun;
}

/**
 * Two-sided p from a t-statistic, via the normal approximation.
 *
 * Every probe so far has 200+ decision units, where the t and normal tails differ in the third
 * decimal — immaterial next to the selection effects this module exists to measure. Stated rather
 * than hidden: for a probe with fewer than ~30 observations this would be optimistic.
 */
export function twoSidedP(t: number): number {
  const z = Math.abs(t);
  // Abramowitz & Stegun 7.1.26 for erf.
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const x = z / Math.SQRT2;
  const u = 1 / (1 + p * x);
  const erf = 1 - ((((a[4]! * u + a[3]!) * u + a[2]!) * u + a[1]!) * u + a[0]!) * u * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}

export interface AdjustedLook extends DiscoveryLook {
  rawP: number;
  holmP: number;
  bhQ: number;
}

/**
 * Holm-Bonferroni and Benjamini-Hochberg over the looks that consume budget.
 *
 * **Holm rather than plain Bonferroni.** Both control family-wise error; Holm is uniformly no worse
 * and matters here because these statistics are strongly correlated — the four V01 cells are
 * measured on overlapping cohorts on the same dates, so treating them as independent tests is
 * needlessly conservative.
 *
 * **BH is reported for ranking only.** Controlling a false-discovery *rate* is the right tool for
 * prioritising which lead to chase next; it is the wrong tool for granting promotion, and this
 * module never lets it do that.
 */
export function adjustFamily(looks: readonly DiscoveryLook[]): AdjustedLook[] {
  const counted = looks.filter((l) => countsTowardMultiplicity(l.role));
  const m = counted.length;
  if (m === 0) return [];

  const withP = counted
    .map((look) => ({ ...look, rawP: twoSidedP(look.hacT), holmP: 1, bhQ: 1 }))
    .sort((a, b) => a.rawP - b.rawP);

  // Holm: step-down, each p scaled by the number of remaining hypotheses, then made monotone.
  let running = 0;
  withP.forEach((look, i) => {
    running = Math.max(running, Math.min(1, look.rawP * (m - i)));
    look.holmP = running;
  });

  // BH: step-up, scaled by m/rank, then enforced non-increasing from the largest rank down.
  let previous = 1;
  for (let i = m - 1; i >= 0; i -= 1) {
    previous = Math.min(previous, Math.min(1, (withP[i]!.rawP * m) / (i + 1)));
    withP[i]!.bhQ = previous;
  }

  return withP;
}

/** Append a look. Written to `audit_events` because a look IS a governed decision. */
export function recordLook(look: DiscoveryLook): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor: "hypothesis-foundry",
      action: DISCOVERY_ACTION,
      // `limited` for anything that cannot promote — the decision column then reads correctly
      // without anyone having to parse the detail.
      decision: canPromote(look) ? "allowed" : "limited",
      subject: `${look.probeId}:${look.statisticId}`,
      detail: JSON.stringify(look),
      createdAt: new Date(),
    })
    .run();
}

/** Every look ever recorded, newest first. A malformed row is skipped, never guessed at. */
export function allLooks(familyId?: string): DiscoveryLook[] {
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, DISCOVERY_ACTION))
    .orderBy(desc(schema.auditEvents.id))
    .all()
    .flatMap((row) => {
      try {
        const parsed = JSON.parse(row.detail ?? "{}") as DiscoveryLook;
        if (!parsed.statisticId) return [];
        return familyId && parsed.familyId !== familyId ? [] : [parsed];
      } catch {
        return [];
      }
    });
}

export interface ProgrammeState {
  /** Permanent statistical trials spent. Separate from, and not a substitute for, the next number. */
  registeredTrialCount: number;
  /** Market statistics inspected that could influence what gets tested next. */
  probeDiscoveryLooks: number;
  controlsRun: number;
  probes: string[];
  postHocLeads: number;
}

/**
 * The honest two-number summary.
 *
 * Reporting `registeredTrialCount = 0` alone was true and misleading. Both numbers travel together
 * from here.
 */
export function programmeState(registeredTrialCount = 0): ProgrammeState {
  const looks = allLooks();
  return {
    registeredTrialCount,
    probeDiscoveryLooks: looks.filter((l) => countsTowardMultiplicity(l.role)).length,
    controlsRun: looks.filter((l) => l.role === "CONTROL").length,
    probes: [...new Set(looks.map((l) => l.probeId))].sort(),
    postHocLeads: looks.filter((l) => l.role === "POST_HOC_DISCOVERY").length,
  };
}
