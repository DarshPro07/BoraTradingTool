import { getDb, schema } from "@/lib/db";
import { isDerivable } from "@/lib/backtest/features";
import { collectFeatures } from "@/lib/backtest/engine";
import { StrategyDslSchema } from "@/lib/strategy/dsl";
import { lastCycleRun } from "@/lib/learning/run-log";

/**
 * What to do next.
 *
 * The problem this solves is stated plainly by the owner: someone who does not know how to trade
 * opens this and cannot tell what any of it is for. Every screen is honest about its own state
 * and none of them says *what to do about it*, so an empty system and a broken one look the same.
 *
 * This reads the actual state of the pipeline and returns the single next action, in plain
 * language, with the reason it matters. One step at a time, deliberately: a checklist of nine
 * things is another way of saying "figure it out".
 *
 * It never invents progress. When the honest answer is "nothing can move until you supply a data
 * source", it says that rather than inventing busywork.
 */

export type StepId =
  | "author_first"
  | "fix_unsupported"
  | "run_cycle"
  | "review_candidate"
  | "spend_trial"
  | "await_forward"
  | "review_proposals"
  | "all_clear";

export interface NextStep {
  id: StepId;
  /** Imperative, six words or fewer. */
  title: string;
  /** Why this matters, for someone who has never traded. */
  why: string;
  /** Exactly what to do. */
  action: string;
  href: string;
  /** Where the pipeline currently stands, as plain counts. */
  progress: { authored: number; evaluable: number; wouldPass: number; validated: number; forward: number };
  /** True when the step needs the owner rather than the system. */
  needsYou: boolean;
}

export function nextStep(): NextStep {
  const db = getDb();
  const specs = db.select().from(schema.strategySpecs).all();
  const results = db.select().from(schema.validationResults).all();
  const forward = db.select().from(schema.forwardOutcomes).all();
  const run = lastCycleRun();

  // A strategy is evaluable when every feature it needs can be derived from price data. This is
  // the check that separates "not tested yet" from "can never be tested here", and conflating
  // them is what left two strategies sitting in draft for weeks.
  const evaluable = specs.filter((spec) => {
    try {
      const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
      if (!parsed.success) return false;
      const required = new Set<string>();
      collectFeatures(parsed.data.entry, required);
      if (parsed.data.exit.condition) collectFeatures(parsed.data.exit.condition, required);
      return [...required].every((feature) => isDerivable(feature));
    } catch {
      return false;
    }
  });

  const progress = {
    authored: specs.length,
    evaluable: evaluable.length,
    wouldPass: run?.wouldPass ?? 0,
    validated: results.length,
    forward: forward.length,
  };

  if (specs.length === 0) {
    return {
      id: "author_first",
      title: "Create your first strategy",
      why: "A strategy is just a rule: when to buy and when to sell. Nothing in this system can run until one exists — that is why every screen is currently empty.",
      action: "Open Studio and press one of the presets, then Compile and save. The SMA crossover is the simplest: buy when the 20-day average price crosses above the 50-day.",
      href: "/strategies",
      progress,
      needsYou: true,
    };
  }

  if (evaluable.length === 0) {
    return {
      id: "fix_unsupported",
      title: "Your strategies need missing data",
      why: `All ${specs.length} of your strategies rely on something this system cannot compute from price history — company size, for instance, or earnings surprises. They will never produce a result, however long you wait.`,
      action: "Create one using only price-based rules. In Studio, the SMA crossover and RSI presets use nothing else, so they can be tested immediately.",
      href: "/strategies",
      progress,
      needsYou: true,
    };
  }

  if (!run || run.rehearsed === 0) {
    return {
      id: "run_cycle",
      title: "Test your strategy on history",
      why: "Before risking anything, the system replays the strategy over three years of real prices across twelve instruments and attacks the result with five independent statistical tests. This costs nothing and changes nothing.",
      action: "Press Run cycle now on Command. It takes a few seconds and the result appears in the activity feed.",
      href: "/command",
      progress,
      needsYou: true,
    };
  }

  if (progress.wouldPass === 0 && progress.validated === 0) {
    return {
      id: "review_candidate",
      title: "Nothing survived the tests",
      why: "Your strategies were replayed and none held up. This is the normal outcome — most rules that look good on a chart are indistinguishable from luck once resampled, and finding that out here costs nothing.",
      action: "Try a different rule in Studio. Change the averages, the stop, or the market. Each attempt is free until you deliberately spend a trial.",
      href: "/strategies",
      progress,
      needsYou: true,
    };
  }

  if (progress.wouldPass > 0 && progress.validated === 0) {
    return {
      id: "spend_trial",
      title: "One candidate is worth a real trial",
      why: `${progress.wouldPass} strategy survived every simulation in rehearsal. The full gauntlet is the real examination — it uses a sealed slice of data that can only be looked at once, so running it permanently raises the bar for that strategy.`,
      action: "Review it in Studio before committing. Once you run the gauntlet, that data is spent and cannot be reused.",
      href: "/strategies",
      progress,
      needsYou: true,
    };
  }

  if (progress.forward === 0) {
    return {
      id: "await_forward",
      title: "Collect forward evidence",
      why: "A strategy that passed on history has still never been tested on a day it had not seen. Past performance is the weakest kind of evidence there is; forward results are the only unbiased kind.",
      action: "Let it run in paper. Positions and realised results appear on the Paper desk as they close.",
      href: "/paper",
      progress,
      needsYou: false,
    };
  }

  if (progress.forward > 0) {
    return {
      id: "review_proposals",
      title: "Review proposals in Execute",
      why: "A strategy with forward evidence can produce a trade proposal: quantity, entry, stop, target and the exact amount you lose if the stop is hit.",
      action: "Open Execute. This software cannot place orders — you place them yourself, with your broker, after reading the ticket.",
      href: "/trades",
      progress,
      needsYou: true,
    };
  }

  return {
    id: "all_clear",
    title: "Nothing needs you right now",
    why: "The pipeline is running and no stage is waiting on a decision.",
    action: "Check back after the next cycle, or author another strategy to widen the search.",
    href: "/command",
    progress,
    needsYou: false,
  };
}
