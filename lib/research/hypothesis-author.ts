import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { breedingBasis, costsForCapital, OWNER_CAPITAL } from "@/lib/paper/capital";
import { compileStrategy, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { costStanding } from "@/lib/strategy/cost-gate";
import { placeStrategy, researchIdentityReady } from "@/lib/strategy/research-identity";
import {
  conditionFeatures,
  entryConditionFrom,
  hypothesisTriage,
  triageText,
  type TriageVerdict,
} from "./hypothesis-triage";
import { sharedSyntaxResolver } from "./syntax/resolver";
import { clauseSlicesOf } from "./semantic-compiler";
import type { SyntaxAttachmentResolver, SyntaxParse } from "./syntax/resolver";

/**
 * Turn a formed hypothesis into a draft strategy — or refuse it, on the record.
 *
 * This closes the last break in the research chain:
 * `papers → sources → claims → hypotheses → strategies`.
 *
 * ## A hypothesis *is* a research family
 *
 * One economic claim, with variants. So an expressible hypothesis declares a family whose
 * `economicHypothesis` is its own statement, and the spec authored from it is that family's first
 * member. Every later variant — a re-tuned threshold, a factory mutation — inherits the family and
 * costs it another selection trial.
 *
 * That makes the family a fact about the *idea* rather than a label someone invented, which is
 * exactly what the multiple-testing correction needs.
 *
 * ## Why most hypotheses are refused
 *
 * `hypothesisTriage` refuses anything that is not a trading rule, needs data this deployment cannot
 * derive, or states no threshold. Of the three hypotheses this system has formed, two are refused.
 * That ratio is the point, not a shortfall — see `docs/plans/hypothesis-to-strategy/01-reality.md`.
 *
 * ## Resolution is taken from the idea, not from what the owner can afford
 *
 * A pre-market gap screen is a daily idea. Authoring it at 5-minute resolution to make it "tradable"
 * would silently change what it means — `gap_pct` between consecutive 5-minute bars is not an
 * overnight gap. So the spec is written at the resolution the hypothesis implies, and the
 * `tradable_at_capital` guard refuses it later with an informative reason ("this needs delivery
 * capital").
 *
 * Refusing honestly beats reshaping an idea until it fits the wallet.
 */

/** One campaign for everything the research loop forms — they share a dataset and a search. */
export const RESEARCH_CAMPAIGN = Object.freeze({
  id: "camp_autonomous_research",
  name: "Autonomous research intake",
  question:
    "Which hypotheses formed from published research survive this system's own validation at the " +
    "owner's capital? Everything here shares one dataset and one search, so contamination is shared.",
});

export interface AuthorOutcome {
  hypothesisId: string;
  title: string;
  verdict: TriageVerdict;
  /** Set when a spec was authored. */
  specId?: string;
  familyId?: string;
  reason: string;
  /**
   * "You said -> MarketPulse interpreted -> strategy actually tested."
   *
   * The lexicon converting "gap >= 3%" correctly today proves nothing about the next phrasing, so
   * every authored strategy carries the full interpretation chain: the owner's words, each
   * condition with the exact text it was read from, and every default this system added that the
   * owner never stated. Recorded to the audit log and returned to the UI, so a quiet
   * misinterpretation has nowhere to hide.
   */
  provenance?: AuthoringProvenance;
}

export interface AuthoringProvenance {
  youSaid: { title: string; statement: string; rationale: string | null };
  /**
   * One entry per condition read from the prose: the author's exact words, and this engine's
   * reading of them. Deliberately NOT {feature, op, value} — a band, a feature-to-feature
   * comparison and a crossing are not scalar triples, and flattening them into one would hide
   * exactly the interpretation a reader needs to check.
   */
  interpreted: { readFrom: string; interpreted: string; features: string[] }[];
  /** Everything the system chose that the owner did not state. Silence here would be a lie. */
  assumptionsAdded: string[];
  featuresRequired: string[];
  familyId: string;
  whyThisFamily: string;
  authoringEngine: string;
  authoredAt: string;
}

export interface AuthorReport {
  considered: number;
  authored: number;
  refused: number;
  outcomes: AuthorOutcome[];
  summary: string;
}

function familyIdFor(hypothesisId: string): string {
  return `fam_${hypothesisId.replace(/^hyp_/, "").slice(0, 16)}`;
}

/** A name the DSL accepts: lowercase, digits and underscores only. */
function specNameFor(title: string, hypothesisId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${slug || "hypothesis"}_${hypothesisId.replace(/^hyp_/, "").slice(0, 8)}`;
}

function record(outcome: AuthorOutcome, actor: string, at: Date): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor,
      action: "author_from_hypothesis",
      decision: outcome.specId ? "allowed" : "refused",
      denialCode: outcome.specId ? null : outcome.verdict,
      subject: outcome.hypothesisId,
      detail: `${outcome.title} — ${outcome.reason}`,
      learningMode: null,
      createdAt: at,
    })
    .run();
}

/**
 * Author drafts from every hypothesis that can be expressed, and record every refusal.
 *
 * Idempotent: a hypothesis that already produced a spec is skipped rather than re-authored, so
 * running this every cycle does not fill the registry with duplicates or inflate the family's
 * trial count with specs nobody asked for.
 */
export async function authorFromHypotheses(
  actor = "research-loop",
  now = new Date(),
  /**
   * INJECTED so a test does not have to spawn Python.
   *
   * Loading `en_core_web_sm` costs seconds, and under a loaded parallel suite it exceeded the 30s
   * test timeout — a green unit suite turning red purely from scheduling. Production still gets
   * the real worker; tests supply a resolver backed by recorded parses of the same model.
   *
   * OPTIONAL, not defaulted, and the difference is the whole defect. As a default parameter
   * (`= SpaCyDependencyResolver.fromEnv()`) this expression ran on EVERY call that omitted it,
   * building a new worker and reloading the model each request — 17–22s per click, measured. It
   * also threw *before the function body*, where no `try` can reach it, which is why an unset
   * `SYNTAX_PARSER_PYTHON` surfaced as a 500 instead of the stated refusal below.
   */
  resolver?: SyntaxAttachmentResolver,
): Promise<AuthorReport> {
  const db = getDb();
  const hypotheses = db.select().from(schema.researchHypotheses).all();

  if (hypotheses.length === 0) {
    return { considered: 0, authored: 0, refused: 0, outcomes: [], summary: "No hypothesis has been formed yet." };
  }

  if (!researchIdentityReady()) {
    return {
      considered: hypotheses.length,
      authored: 0,
      refused: 0,
      outcomes: [],
      summary:
        "Research-identity tables are absent, so a hypothesis cannot become a family. Nothing was " +
        "authored: a spec with no family cannot be validated, and creating one would fill the " +
        "registry with strategies that can never be tested.",
    };
  }

  // Declared once. Every autonomously-formed hypothesis belongs to the same search.
  if (!db.select().from(schema.researchCampaigns).all().some((row) => row.id === RESEARCH_CAMPAIGN.id)) {
    db.insert(schema.researchCampaigns)
      .values({ ...RESEARCH_CAMPAIGN, createdAt: now, createdBy: actor })
      .run();
  }

  const basis = breedingBasis();
  const outcomes: AuthorOutcome[] = [];

  // ONE worker for the whole PROCESS — not, as before, one per call. The model load is the cost,
  // so it is paid at first use and then never again, and it is paid at this boundary precisely so
  // `hypothesisTriage` and `compileResearchProse` below it stay pure and synchronous.
  //
  // If the parser is unavailable this THROWS and nothing is authored. That is the intended
  // behaviour: attachment cannot be guessed, so a strategy cannot be written without it. The
  // learning cycle catches it and records the reason (`cycle.ts`), and the HTTP route translates it
  // into a stated 503 rather than letting it escape as a 500.
  //
  // NOT disposed here. This worker belongs to the process, and a borrower that shuts down what it
  // borrowed is how "one worker per process" became "one worker per call".
  const parser = resolver ?? sharedSyntaxResolver();

  for (const hypothesis of hypotheses) {
    // Already authored? The link is the spec's `hypothesisId` — the first non-null values this
    // registry will hold.
    const existing = db
      .select()
      .from(schema.strategySpecs)
      .where(eq(schema.strategySpecs.hypothesisId, hypothesis.id))
      .get();
    if (existing) continue;

    const input = {
      title: hypothesis.title,
      statement: hypothesis.statement,
      rationale: hypothesis.rationale,
    };
    // ONE PARSE PER CLAUSE. The parser is markedly more accurate on a single clause than on a
    // whole paragraph, and `clauseSlicesOf` is the compiler's own segmentation, so the keys it
    // will look up are exactly the ones recorded here.
    const parses: Record<string, SyntaxParse> = {};
    for (const slice of clauseSlicesOf(triageText(input))) {
      if (!parses[slice]) parses[slice] = await parser.parse(slice);
    }
    const triage = hypothesisTriage({ ...input, parses });

    if (triage.verdict !== "EXPRESSIBLE") {
      const outcome: AuthorOutcome = {
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        verdict: triage.verdict,
        reason: triage.reason,
      };
      outcomes.push(outcome);
      record(outcome, actor, now);
      continue;
    }

    const market = hypothesis.market === "US" ? "US" : "NSE";
    const candidate = {
      name: specNameFor(hypothesis.title, hypothesis.id),
      description: hypothesis.statement.slice(0, 500),
      universe: { market, maxPositions: basis.positions },
      // The ENTRY scope only. Flattening every condition into the entry would put the exit rule
      // inside it — "close above SMA20" AND "close below SMA20" — producing a rule that can never
      // fire, which is precisely the contradiction the compiler exists to prevent. The per-scope
      // fallback keeps older callers working when no compiler record is present.
      entry: triage.compiled?.scopes.ENTRY ?? entryConditionFrom(triage.conditions),
      // The research's OWN exit rule when it stated one — P0 cross-layer parity.
      //
      // The compiler computed `scopes.EXIT` and this discarded it, substituting a time-and-stop
      // default. The surface would then show "INTERPRETED: exit when close < SMA20" while the
      // backtest actually ran a 5-day timeout, so YOU SAID != INTERPRETED != ACTUALLY TESTED —
      // a violation of the product's core promise, not a missing feature.
      //
      // afterDays and stopLossPct remain as BOUNDS beside the stated rule: a research exit says
      // when the thesis is wrong, not how long capital may sit or how much may be lost, and the
      // compiler warns when an exit rests on time alone. Both are declared in `assumptionsAdded`
      // so the addition is visible rather than silent.
      exit: {
        afterDays: 5,
        stopLossPct: 2,
        ...(triage.compiled?.scopes.EXIT ? { condition: triage.compiled.scopes.EXIT } : {}),
      },
      sizing: { maxPositionPct: Math.min(25, Math.floor(100 / basis.positions)) },
      costs: costsForCapital({
        capital: basis.capital,
        positions: basis.positions,
        market: OWNER_CAPITAL.market,
        product: "DELIVERY" as const,
      }),
    };

    const parsed = StrategyDslSchema.safeParse(candidate);
    if (!parsed.success) {
      const outcome: AuthorOutcome = {
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        verdict: "UNCLEAR",
        reason: `The specification built from this hypothesis does not match the DSL schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      };
      outcomes.push(outcome);
      record(outcome, actor, now);
      continue;
    }

    const compiled = compileStrategy(parsed.data);
    if (!compiled.ok) {
      const outcome: AuthorOutcome = {
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        verdict: "UNCLEAR",
        reason: `${compiled.code}: ${compiled.message}`,
      };
      outcomes.push(outcome);
      record(outcome, actor, now);
      continue;
    }

    // Priced honestly, or not written at all. A spec below the owner's real cost is blocked at
    // every promotion rung anyway; refusing here says so while it can still be changed cheaply.
    const cost = costStanding(JSON.stringify(parsed.data));
    if (cost.understated) {
      const outcome: AuthorOutcome = {
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        verdict: "UNCLEAR",
        reason: `COST_UNDERSTATED: ${cost.reason}`,
      };
      outcomes.push(outcome);
      record(outcome, actor, now);
      continue;
    }

    const familyId = familyIdFor(hypothesis.id);
    if (!db.select().from(schema.strategyFamilies).all().some((row) => row.id === familyId)) {
      db.insert(schema.strategyFamilies)
        .values({
          id: familyId,
          researchCampaignId: RESEARCH_CAMPAIGN.id,
          // Unique per hypothesis, because the table's UNIQUE key is (campaign, NAME) while the
          // guard above checks the ID. Two hypotheses legitimately share a title — the research
          // bridge names a proposal after the instrument it is about, so researching the same
          // stock twice produces two distinct claims with identical titles — and merging them
          // into one family would understate the multiple-testing denominator. One family per
          // hypothesis is the design; the suffix is what makes the database agree.
          name: `${hypothesis.title.slice(0, 110)} · ${hypothesis.id.slice(-6)}`,
          // The hypothesis itself is the family's economic claim. Nothing invented.
          economicHypothesis: hypothesis.statement,
          mechanism: hypothesis.rationale ?? hypothesis.statement,
          allowedVariantDimensions: JSON.stringify({
            thresholds: "any, within the features this hypothesis names",
            exit: "any",
          }),
          declarationHash: createHash("sha256")
            .update(`${hypothesis.id} ${hypothesis.statement}`, "utf8")
            .digest("hex")
            .slice(0, 16),
          createdAt: now,
          createdBy: actor,
        })
        .run();
    }

    let specId: string;
    try {
      specId = recordStrategySpec({
        name: parsed.data.name,
        dsl: parsed.data,
        createdBy: actor,
        hypothesisId: hypothesis.id,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const outcome: AuthorOutcome = {
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        verdict: "UNCLEAR",
        reason: /UNIQUE constraint/i.test(message)
          ? "A strategy of this name already exists at this version; left untouched."
          : `Could not be recorded: ${message.split("\n")[0]}`,
      };
      outcomes.push(outcome);
      record(outcome, actor, now);
      continue;
    }

    placeStrategy({
      specId,
      campaignId: RESEARCH_CAMPAIGN.id,
      familyId,
      dsl: parsed.data,
      classification: "NEW_FAMILY",
      classifiedBy: actor,
      reason:
        "The hypothesis is the family. Its statement is the economic claim, and this spec is the " +
        "first expression of it — so the placement follows from the idea rather than a judgement.",
      confirmed: true,
      at: now,
    });

    const provenance: AuthoringProvenance = {
      youSaid: { title: hypothesis.title, statement: hypothesis.statement, rationale: hypothesis.rationale },
      interpreted: triage.conditions.map((condition) => ({
        readFrom: condition.evidence,
        interpreted: condition.interpreted,
        features: conditionFeatures(condition),
      })),
      assumptionsAdded: [
        // The assumption must describe what was ACTUALLY built. Claiming "the hypothesis stated
        // entries only" while its exit rule sits in the spec would be a false provenance record.
        triage.compiled?.scopes.EXIT
          ? "exit: the hypothesis's OWN exit rule, plus afterDays 5 and a 2% stop as bounds - " +
            "a stated exit says when the thesis is wrong, not how long capital may sit or how much may be lost"
          : "exit: afterDays 5 with a 2% stop - screen-class default, the hypothesis stated entries only",
        `sizing: max ${Math.min(25, Math.floor(100 / basis.positions))}% per position from the capital basis`,
        "costs: computed from the owner's capital at delivery rates, not stated in the hypothesis",
        "long-only: direction was not stated and buy-side is the conservative reading",
      ],
      // Both sides of a comparison or crossing are required, not just the left one.
      featuresRequired: [...new Set(triage.conditions.flatMap(conditionFeatures))],
      familyId,
      whyThisFamily:
        "The hypothesis IS the family: its statement is the economic claim, and this spec is its first expression. No similarity merge was applied.",
      authoringEngine: `hypothesis-author/lexicon (compiler ${parsed.data ? "1.4.0" : "unknown"})`,
      authoredAt: now.toISOString(),
    };

    const outcome: AuthorOutcome = {
      hypothesisId: hypothesis.id,
      title: hypothesis.title,
      verdict: "EXPRESSIBLE",
      specId,
      familyId,
      reason: `${triage.reason} Authored as ${parsed.data.name} in family ${familyId}.`,
      provenance,
    };
    outcomes.push(outcome);
    record(outcome, actor, now);

    // The full chain, durably. The prose audit row above answers "what happened"; this answers
    // "was the interpretation faithful" - a different question, checkable years later.
    db.insert(schema.auditEvents)
      .values({
        actor,
        action: "authoring_provenance",
        decision: "allowed",
        denialCode: null,
        subject: specId,
        detail: JSON.stringify(provenance),
        learningMode: null,
        createdAt: now,
      })
      .run();
  }

  const authored = outcomes.filter((outcome) => outcome.specId !== undefined).length;
  const refused = outcomes.length - authored;

  return {
    considered: outcomes.length,
    authored,
    refused,
    outcomes,
    summary:
      outcomes.length === 0
        ? "Every hypothesis has already been considered; nothing new to author."
        : `Considered ${outcomes.length} hypothesis(es): authored ${authored}, refused ${refused}. ` +
          (refused > 0
            ? `Refusals: ${outcomes
                .filter((outcome) => outcome.specId === undefined)
                .map((outcome) => `${outcome.title} (${outcome.verdict})`)
                .join("; ")}. A refusal is a finding, not a failure — most hypotheses this system ` +
              "forms are not expressible as strategies here."
            : ""),
  };
}
