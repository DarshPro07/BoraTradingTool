/**
 * The initial economic hypothesis classes.
 *
 * Six classes rather than twenty strategies, in the owner's priority order (2026-08-17). Each can
 * later produce several pre-registered hypotheses, and each of those is a **separate economically
 * justified protocol choice** — not one idea sprayed across a parameter grid. `M01` (3m/1m) and
 * `M02` (6m/1m) differ because the literature's information-diffusion window is a real question,
 * not because two lookbacks were available.
 *
 * Every hypothesis here answers all nine questions and carries its evidence basis. Nothing in this
 * file has been tested; the expected-effect figures are **priors from the mechanism**, which is the
 * only kind of number the plausibility gate is allowed to read.
 *
 * Costs are this system's own measured figures (`docs/plans/rehearsal-funnel/05-gross-vs-cost.md`):
 * 38 bps round trip for delivery-settled positions, 29 bps intraday.
 */
import type { EconomicHypothesis, HypothesisClass } from "./hypothesis-foundry";

/** Delivery round-trip friction: (commission + slippage) * 2 + spread, measured not assumed. */
export const DELIVERY_COST_BPS = 38;

/** What a monthly-rebalanced cross-sectional strategy pays per rebalance at this system's costs. */
export const CLASS_PRIORITY: readonly HypothesisClass[] = Object.freeze([
  "LIQUIDITY_CONDITIONED_MOMENTUM",
  "LOTTERY_MAX_EFFECT",
  "HIGHER_MOMENT_SKEWNESS",
  "LIQUIDITY_CONDITIONED_REVERSAL",
  "IDIOSYNCRATIC_VOLATILITY",
  "RETURN_VOLUME_REGIME",
]);

const INDIAN_MOMENTUM_LIQUIDITY =
  "Momentum, reversals and liquidity: Indian evidence (2023) — 3,956 Indian stocks, 2000-2021; " +
  "intermediate/long-horizon momentum stronger and more persistent among liquid stocks, reversals " +
  "concentrated among illiquid ones.";

const INDIAN_LOTTERY =
  "Lottery factor and stock returns: Evidence from India (2024) — MAX carries predictive " +
  "information distinct from skewness, tail risk and idiosyncratic volatility.";

const INDIAN_HIGHER_MOMENTS =
  "Higher moments anomaly: evidence from the Indian equity market — 3,085 stocks, 2000-2019, " +
  "portfolio sorts with factor controls.";

const INDIAN_IVOL =
  "A parsimonious five-factor model for the Indian stock market: revisiting the idiosyncratic " +
  "volatility anomaly (2026) — BSE 500, reports a POSITIVE IVOL/return relation, against much of " +
  "the international literature.";

const INDIAN_RETURN_VOLUME =
  "Turnover tales: investigating investor biases through return-volume dynamics in the Indian " +
  "stock market (2026) — regime-dependent dynamics consistent with overconfidence and disposition " +
  "effects. Documents mechanisms, NOT a trading rule.";

/** Price and volume only — everything derivable from the daily bars already held. */
const PRICE_VOLUME: readonly string[] = Object.freeze(["daily_close", "daily_volume"]);

export const INITIAL_HYPOTHESES: readonly EconomicHypothesis[] = Object.freeze([
  {
    id: "M01",
    klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
    title: "Intermediate momentum among liquid NSE equities, 3m formation / 1m hold",
    mechanism:
      "Information about a firm's prospects diffuses gradually across investors rather than " +
      "repricing at once. Under-reaction to that information leaves part of the move unrealised " +
      "for weeks, so past intermediate-horizon winners continue to outperform past losers.",
    counterpartyOrConstraint:
      "Investors who adjust positions gradually — through mandate constraints, periodic review " +
      "cycles, or the disposition effect (selling winners too early and holding losers). They are " +
      "not mispricing by choice; the constraint is structural, which is why it recurs.",
    persistenceReason:
      "Arbitraging it requires holding a large, high-turnover, factor-exposed book through drawdowns " +
      "that can last quarters — momentum crashes are severe and correlated. Capital that could " +
      "remove the effect is exactly the capital least able to survive its worst periods.",
    formationHorizon:
      "Three months. Short enough to capture the diffusion window the Indian evidence identifies, " +
      "long enough to be dominated by information rather than by microstructure noise.",
    holdingHorizon:
      "One month. The Indian evidence places momentum persistence at roughly one to six months; a " +
      "one-month hold sits inside that and keeps rebalancing friction to twelve round trips a year.",
    // A prior, not a measurement: a monthly-rebalanced decile spread of a few hundred bps annually
    // implies a low-hundreds figure per rebalance if the effect is real at this horizon.
    expectedGrossEffectBps: 120,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "Restricted to the top liquidity cohort, with position size capped at a small fraction of " +
      "20-day median traded value so a rebalance does not move the price it is measured against. " +
      "Beyond roughly a few percent of ADV per name the modelled friction is no longer the friction.",
    falsificationCondition:
      "No positive gross spread across independent eras; or the effect confined to a single era; " +
      "or a positive spread that does not survive 38 bps of round-trip cost at the decision unit " +
      "with HAC-corrected inference.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_MOMENTUM_LIQUIDITY],
    conditioning: "top liquidity cohort by 20-day median traded value",
    direction: "CROSS_SECTIONAL_SPREAD",
    requiredData: PRICE_VOLUME,
  },
  {
    id: "M02",
    klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
    title: "Intermediate momentum among liquid NSE equities, 6m formation / 1m hold",
    mechanism:
      "The same gradual-diffusion mechanism as M01, but testing whether the informative window is " +
      "six months rather than three. This is a distinct claim about how long information takes to " +
      "be absorbed, not a second parameterisation of one claim.",
    counterpartyOrConstraint:
      "Investors who adjust positions gradually — mandate constraints, periodic review cycles, and " +
      "the disposition effect. Identical to M01; the two differ in the diffusion window asserted.",
    persistenceReason:
      "As M01: removing the effect means carrying a high-turnover factor book through correlated " +
      "momentum crashes, which is the condition under which arbitrage capital withdraws.",
    formationHorizon:
      "Six months. The classical momentum formation window, and the one most Indian studies use " +
      "when they report the effect at its strongest.",
    holdingHorizon:
      "One month. Held fixed against M01 deliberately, so the comparison isolates formation length " +
      "rather than confounding it with turnover.",
    expectedGrossEffectBps: 130,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "As M01 — top liquidity cohort, position capped at a small fraction of 20-day median traded " +
      "value, with the same few-percent-of-ADV ceiling before the cost model stops describing reality.",
    falsificationCondition:
      "No positive gross spread across independent eras; or no improvement over M01 sufficient to " +
      "justify a distinct hypothesis; or failure to survive cost at the decision unit under HAC.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_MOMENTUM_LIQUIDITY],
    conditioning: "top liquidity cohort by 20-day median traded value",
    direction: "CROSS_SECTIONAL_SPREAD",
    requiredData: PRICE_VOLUME,
  },
  {
    id: "X01",
    klass: "LOTTERY_MAX_EFFECT",
    title: "Lottery demand: extreme prior-month maximum daily return predicts underperformance",
    mechanism:
      "Investors overpay for lottery-like upside. A stock that printed an attention-catching " +
      "extreme positive day is bid above fundamental value by investors buying the possibility of " +
      "repeating it, and subsequently underperforms as that premium decays.",
    counterpartyOrConstraint:
      "Retail investors with a preference for positively skewed payoffs, who are buying a small " +
      "chance of a large gain rather than an expected return. The behaviour is a preference, not " +
      "an error to be corrected by learning, so the flow recurs.",
    persistenceReason:
      "Capturing it requires shorting exactly the names that are hardest and most expensive to " +
      "short — high-attention, high-volatility, often small — and Indian short-selling is further " +
      "constrained by securities-lending availability. The long-only half is a weaker claim.",
    formationHorizon:
      "One month. MAX is defined as the maximum daily return over the prior month, which is the " +
      "window over which the attention effect is documented.",
    holdingHorizon:
      "One month. The premium is documented to decay over weeks; holding longer measures something " +
      "other than the lottery effect.",
    expectedGrossEffectBps: 100,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "Severely limited on the short side by Indian securities-lending availability; a long-only " +
      "implementation avoiding high-MAX names has much larger capacity but a correspondingly " +
      "smaller expected effect. Capacity must be assessed per side, not for the spread.",
    falsificationCondition:
      "High-MAX names do not underperform low-MAX names gross; or the effect is entirely explained " +
      "by size or volatility exposure; or it exists only in names that cannot in fact be shorted.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_LOTTERY],
    conditioning: "prior-month maximum daily return, cross-sectional quintiles",
    direction: "SHORT_WINNERS",
    requiredData: PRICE_VOLUME,
  },
  {
    id: "S01",
    klass: "HIGHER_MOMENT_SKEWNESS",
    title: "Positive rolling skewness predicts subsequent underperformance",
    mechanism:
      "The same preference for lottery-like payoffs expressed through a distributional statistic " +
      "rather than a single extreme day. Stocks whose recent return distribution is positively " +
      "skewed attract investors paying for the right tail, and that premium reverses.",
    counterpartyOrConstraint:
      "Investors with skewness preference — the same population as X01, which is precisely why the " +
      "two must be tested against each other rather than counted as independent evidence.",
    persistenceReason:
      "Skewness is not a standard risk model factor, so few mandates control for it, and the names " +
      "with the strongest exposure are again the hardest to short.",
    formationHorizon:
      "Twelve months of daily returns. Skewness is a third-moment estimate and is unstable over " +
      "short windows; a shorter formation measures noise rather than distributional shape.",
    holdingHorizon:
      "One month. Long enough for the premium to decay, short enough that the formation window " +
      "still describes the stock being held.",
    expectedGrossEffectBps: 90,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "As X01 the short leg is the binding constraint. A long-only underweight version is " +
      "implementable at size but expresses a much weaker version of the claim.",
    falsificationCondition:
      "No monotonic relation across skewness quintiles; or the effect vanishes once MAX is " +
      "controlled for, in which case S01 is X01 wearing a different statistic and must be dropped.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_HIGHER_MOMENTS, INDIAN_LOTTERY],
    conditioning: "rolling 12-month return skewness, cross-sectional quintiles",
    direction: "SHORT_WINNERS",
    requiredData: PRICE_VOLUME,
  },
  {
    id: "R01",
    klass: "LIQUIDITY_CONDITIONED_REVERSAL",
    title: "Short-horizon reversal concentrated among illiquid NSE equities",
    mechanism:
      "Short-horizon price moves in thinly traded names are substantially liquidity provision " +
      "rather than information: a seller needing immediacy pushes the price away from value, and " +
      "it returns once the pressure clears. The compensation is the reversal.",
    counterpartyOrConstraint:
      "Investors demanding immediacy in names where little is available. The reversal is the fee " +
      "they pay a liquidity provider — which means capturing it IS providing liquidity, with all " +
      "the inventory risk that implies.",
    persistenceReason:
      "It persists precisely because capital is scarce where it is largest. The effect is " +
      "concentrated in names too small and too costly to trade for most participants, which is the " +
      "same reason it is dangerous to claim.",
    formationHorizon:
      "One month. The reversal documented in the Indian evidence is short-horizon; longer formation " +
      "windows measure momentum, which points the other way.",
    holdingHorizon:
      "One month. Any shorter and the strategy is competing on execution speed rather than on the " +
      "economic claim being tested.",
    // Deliberately below the 3x illiquid hurdle. The mechanism is real and the economics are not,
    // and the gate should say so rather than this file quietly picking a number that passes.
    expectedGrossEffectBps: 90,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "Very low. By construction the names are illiquid, so realised spread and market impact are " +
      "far above the modelled 38 bps and participation of even 1% of ADV may move the price. " +
      "Capacity is the reason to doubt this, not an afterthought.",
    falsificationCondition:
      "No reversal gross; or a reversal that does not clear THREE times modelled friction, which is " +
      "the hurdle illiquid conditioning requires before the backtest can be believed.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_MOMENTUM_LIQUIDITY],
    conditioning: "bottom liquidity quintile by 20-day median traded value (illiquid)",
    direction: "LONG_LOSERS",
    requiredData: PRICE_VOLUME,
  },
  {
    id: "I01",
    klass: "IDIOSYNCRATIC_VOLATILITY",
    title: "Idiosyncratic volatility and subsequent returns, direction not asserted",
    mechanism:
      "Residual volatility after removing market exposure may proxy for compensated risk, for " +
      "lottery demand, or for arbitrage limits — and the Indian and international literatures " +
      "disagree on the sign. This is registered as a directional QUESTION rather than a prediction.",
    counterpartyOrConstraint:
      "Depends entirely on the sign. If positive, investors are compensated for bearing " +
      "undiversifiable residual risk; if negative, they are overpaying for volatile lottery-like " +
      "names. Both stories have proponents, which is exactly why this must be tested not assumed.",
    persistenceReason:
      "If the effect is compensation for risk it should persist indefinitely and is not an edge at " +
      "all. Distinguishing that from a mispricing is the point of the test, and a positive result " +
      "under the risk interpretation is NOT a tradeable finding.",
    formationHorizon:
      "Twelve months of daily residuals against a market factor, estimated without any use of " +
      "future information — the constraint the lookahead invariant exists to enforce.",
    holdingHorizon:
      "One month, matching the cross-sectional sorting literature this question comes from.",
    expectedGrossEffectBps: 70,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "High-IVOL names skew small and volatile, so the extreme quintile carries materially worse " +
      "execution than the modelled cost. Capacity is acceptable in the middle of the distribution " +
      "and poor exactly where the signal is strongest.",
    falsificationCondition:
      "No monotonic relation in either direction across IVOL quintiles; or a relation whose sign " +
      "flips across eras or across reasonable alternative definitions of the residual, which would " +
      "mark it as a specification artifact rather than an effect.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_IVOL],
    conditioning: "12-month idiosyncratic volatility vs market factor, cross-sectional quintiles",
    direction: "CROSS_SECTIONAL_SPREAD",
    requiredData: PRICE_VOLUME,
  },
  {
    id: "V01",
    klass: "RETURN_VOLUME_REGIME",
    title: "Abnormal-volume return continuation in high-turnover regimes",
    mechanism:
      "A large price move on abnormal volume is more likely to reflect information than one on " +
      "ordinary volume, because volume indicates that a broad set of participants repriced rather " +
      "than that one order crossed a thin book. Information-driven moves should continue.",
    counterpartyOrConstraint:
      "Investors trading on attention and overconfidence in high-turnover states, who supply the " +
      "volume without supplying the information — documented in the Indian return-volume evidence " +
      "as overconfidence and disposition patterns.",
    persistenceReason:
      "Weakest of the six. If the effect is real it is a well-known signal and should be competed " +
      "away quickly; this is registered largely so a negative result is recorded rather than " +
      "re-derived later.",
    formationHorizon:
      "Five days, with volume compared against its own 20-day baseline so 'abnormal' is defined " +
      "per instrument rather than against a universe-wide constant.",
    holdingHorizon:
      "One month. Shorter holds turn this into an execution-speed contest rather than a test of " +
      "whether volume identifies information.",
    expectedGrossEffectBps: 85,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint:
      "Signal is defined on abnormal volume, so the tradeable names are by construction liquid on " +
      "the signal day and may not be afterwards. Capacity must be measured on the HOLDING period's " +
      "liquidity, not the signal day's.",
    falsificationCondition:
      "No continuation gross; or continuation indistinguishable from the momentum effect M01/M02 " +
      "already captures, in which case it adds no independent evidence and must be dropped.",
    evidenceBasis: "LITERATURE",
    sourceReferences: [INDIAN_RETURN_VOLUME],
    conditioning: "abnormal 5-day volume vs 20-day baseline, high-turnover regime",
    direction: "LONG_WINNERS",
    requiredData: PRICE_VOLUME,
  },
]);
