import type { ParsedToken, SyntaxParse } from "./resolver";

/**
 * Which feature a comparison operator actually governs, derived from the dependency tree.
 *
 * ## Why not character distance
 *
 * Four consecutive live-probe fixes tried: the clause's FIRST feature, then the NEAREST feature to
 * the LEFT, then the nearest operand, then a nearest-wins tie-break between a number and a feature.
 * Each fixed the previous one's counterexample and authored a new wrong strategy that passed every
 * unit test. "Nearest" is not a weak version of the right rule; it is a different rule that happens
 * to agree sometimes.
 *
 * ## The three structures that cover the corpus
 *
 * Measured against the real TCS · RELIANCE · NIFTYBEES · SBIN probe prose (see
 * `quant/syntax_benchmark.py`), every operator in the corpus resolves through one of:
 *
 *   1. COPULA      "close IS above SMA20"        operator → head `is` → subject-like child.
 *                  spaCy tags the finance noun "close" as ADJ, so it arrives as `acomp`/`amod`
 *                  rather than `nsubj`. Both are accepted — this is a tagging artefact of domain
 *                  vocabulary, not a different grammatical relation.
 *   2. QUANTIFIER  "RSI-14 between 50 and 70"    operator hangs off the NUMBER (`quantmod`), which
 *                  hangs off the feature (`nummod`). A one-hop walk stops on `50` and reports the
 *                  number as the subject. Numeric links are climbed through.
 *   3. COORDINATED "above SMA20 and below SMA50" the second operator is a `conj` of the first (or
 *                  of the first's object). It inherits the first operator's subject.
 *
 * Anything else is AMBIGUOUS_ATTACHMENT and the compiler refuses. There is deliberately no
 * fallback: a refusal costs one strategy, a misattachment costs trust in every strategy.
 */

export interface Attachment {
  operatorIndex: number;
  operatorText: string;
  subject: ParsedToken;
  /** The object of the comparison — a feature token or a numeric literal. */
  operand: ParsedToken | null;
  /** "between 50 and 70" carries 70 here; coordinated objects generally. */
  operandConjuncts: ParsedToken[];
  /** "3 percent" — the quantity modifying a unit operand. Null when the operand is itself the value. */
  operandQuantifier: ParsedToken | null;
  /** How it was derived, in words a reader can disagree with. Recorded as provenance. */
  route: string;
}

export type AttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; code: "AMBIGUOUS_ATTACHMENT"; reason: string };

/** Does this token name a tradeable quantity? Supplied by the compiler, which owns the vocabulary. */
export type FeaturePredicate = (token: ParsedToken) => boolean;

const SUBJECT_DEPS = new Set(["nsubj", "nsubjpass"]);
/** Domain nouns spaCy tags as adjectives ("close") surface here instead of as subjects. */
const SUBJECT_LIKE_DEPS = new Set(["acomp", "amod", "attr", "dobj"]);
const CLIMBABLE_POS = new Set(["NUM", "SYM"]);

function headOf(tokens: readonly ParsedToken[], token: ParsedToken): ParsedToken | null {
  const head = tokens[token.headIndex];
  if (!head || head.index === token.index) return null;
  return head;
}

function childrenOf(tokens: readonly ParsedToken[], token: ParsedToken): ParsedToken[] {
  return tokens.filter((candidate) => candidate.headIndex === token.index && candidate.index !== token.index);
}

/**
 * The object of a comparison: its prepositional object, plus anything coordinated with it.
 *
 * "between 50 and 70" is ONE condition with two bounds, so 70 is returned alongside 50 rather than
 * treated as a second comparison.
 */
function operandOf(
  tokens: readonly ParsedToken[],
  operator: ParsedToken,
): { operand: ParsedToken | null; conjuncts: ParsedToken[]; quantifier: ParsedToken | null } {
  // A symbolic operator takes its quantity as a `nummod` CHILD rather than a prepositional object:
  // "relative volume >= 2" hangs the 2 off the `=`.
  const direct =
    childrenOf(tokens, operator).find((child) => child.dep === "pobj") ??
    childrenOf(tokens, operator).find((child) => child.dep === "nummod" || child.pos === "NUM");
  // In the QUANTIFIER structure the operator hangs off its own object, so the object is the head.
  const head = headOf(tokens, operator);

  /**
   * SYMBOLIC comparators have no prepositional object.
   *
   * Researchers write "gap >= 3%" and "relative volume >= 1" constantly, and spaCy parses `>=` as
   * loose SYM/ADP tokens hanging off the SUBJECT — so the quantity is a sibling of the operator
   * under the same head, not a child of it. Reading only `pobj` reported NO_OPERAND and threw away
   * both thresholds of the one hypothesis in this repository that is actually expressible.
   *
   * Siblings are ranked by relation, never by distance: a bare number first, then an apposed
   * nominal (the "%" in "3%") whose own `nummod` carries the value.
   */
  const sibling = (() => {
    if (direct || head === null) return null;
    const siblings = childrenOf(tokens, head).filter(
      (child) =>
        child.index !== operator.index &&
        child.pos !== "PUNCT" &&
        child.pos !== "SYM" &&
        child.pos !== "ADP" &&
        // `amod` is part of the subject's own name ("RELATIVE volume"), never its operand.
        child.dep !== "amod",
    );
    return (
      siblings.find((child) => child.pos === "NUM") ??
      siblings.find((child) => child.dep === "appos" || child.dep === "attr" || child.dep === "dobj") ??
      null
    );
  })();

  const operand =
    direct ?? (head !== null && CLIMBABLE_POS.has(head.pos) ? head : null) ?? sibling;
  if (!operand) return { operand: null, conjuncts: [], quantifier: null };

  // A coordinated OPERATOR is not a bound. In "close is above SMA20 and below SMA50" the token
  // `below` is a `conj` of `SMA20`, so an unfiltered sweep reports it as the upper bound of the
  // first comparison and "between 55 and below" becomes representable. Only nominal and numeric
  // conjuncts are bounds.
  const conjuncts = tokens.filter(
    (candidate) =>
      candidate.headIndex === operand.index &&
      candidate.dep === "conj" &&
      candidate.pos !== "ADP" &&
      candidate.pos !== "VERB",
  );

  // "above 3 percent" — the object of the preposition is the UNIT (`percent`), and the quantity is
  // its `nummod` child. Reading the object alone reports "percent is not a number" and throws away
  // a perfectly explicit threshold.
  const quantifier =
    tokens.find((candidate) => candidate.headIndex === operand.index && candidate.dep === "nummod") ?? null;

  return { operand, conjuncts, quantifier };
}

/**
 * Resolve one operator, or refuse.
 *
 * `isFeature` decides which of several grammatically valid candidates names a tradeable quantity.
 * Without it, "When NIFTYBEES closes above X" resolves to the INSTRUMENT — the grammatical subject
 * — instead of the PRICE, which is grammatically correct and financially useless.
 */
export function resolveAttachment(
  parse: SyntaxParse,
  operatorIndex: number,
  isFeature: FeaturePredicate,
  depth = 0,
): AttachmentResult {
  const tokens = parse.tokens;
  const operator = tokens[operatorIndex];
  if (!operator) {
    return { ok: false, code: "AMBIGUOUS_ATTACHMENT", reason: `no token at index ${operatorIndex}` };
  }
  if (depth > 3) {
    return {
      ok: false,
      code: "AMBIGUOUS_ATTACHMENT",
      reason: `"${operator.text}" could not be resolved within a bounded walk`,
    };
  }

  const { operand, conjuncts, quantifier } = operandOf(tokens, operator);

  // (3) COORDINATED — inherit from the operator this one is conjoined to.
  if (operator.dep === "conj") {
    const head = headOf(tokens, operator);
    if (head) {
      const anchor =
        head.pos === "ADP"
          ? head
          : tokens.find((candidate) => candidate.index === head.headIndex && candidate.pos === "ADP") ?? null;
      if (anchor && anchor.index !== operator.index) {
        const inherited = resolveAttachment(parse, anchor.index, isFeature, depth + 1);
        if (inherited.ok) {
          return {
            ok: true,
            attachment: {
              operatorIndex,
              operatorText: operator.text,
              subject: inherited.attachment.subject,
              operand,
              operandConjuncts: conjuncts,
              operandQuantifier: quantifier,
              route: `coordinated with "${anchor.text}" (${inherited.attachment.route})`,
            },
          };
        }
      }
    }
  }

  let node = headOf(tokens, operator);
  if (!node) {
    return {
      ok: false,
      code: "AMBIGUOUS_ATTACHMENT",
      reason: `"${operator.text}" heads itself — no governing token`,
    };
  }

  // (2) QUANTIFIER — climb through numeric links to the noun they quantify.
  let climbed = 0;
  const route: string[] = [];
  while (CLIMBABLE_POS.has(node.pos) && climbed < 3) {
    const next = headOf(tokens, node);
    if (!next) break;
    route.push(`through ${node.pos} "${node.text}"`);
    node = next;
    climbed += 1;
  }

  // (1) COPULA — the governing verb's subject, or its domain-noun-as-adjective stand-in.
  if (node.pos === "VERB" || node.pos === "AUX") {
    const children = childrenOf(tokens, node);
    const candidates = [
      ...children.filter((child) => SUBJECT_DEPS.has(child.dep)),
      ...children.filter((child) => SUBJECT_LIKE_DEPS.has(child.dep) && child.index < operator.index),
      node,
    ];
    const chosen = candidates.find(isFeature) ?? null;
    if (chosen) {
      return {
        ok: true,
        attachment: {
          operatorIndex,
          operatorText: operator.text,
          subject: chosen,
          operand,
          operandConjuncts: conjuncts,
          operandQuantifier: quantifier,
          route: [`subject "${chosen.text}" (${chosen.dep}) of "${node.text}"`, ...route].join(", "),
        },
      };
    }
    return {
      ok: false,
      code: "AMBIGUOUS_ATTACHMENT",
      reason:
        `"${operator.text}" governs "${node.text}", whose candidate subjects ` +
        `(${candidates.map((c) => `"${c.text}"`).join(", ") || "none"}) name no known feature.`,
    };
  }

  // A feature can arrive as a MODIFIER of the head noun rather than as the head itself: spaCy
  // reads "rsi_14 crosses" as a single nominal, tagging `crosses` NOUN with `rsi_14` as its
  // `compound` child. The comparison is still about rsi_14.
  const nominal =
    (isFeature(node)
      ? node
      : childrenOf(tokens, node).find(
          (child) => ["compound", "nmod", "amod", "poss"].includes(child.dep) && isFeature(child),
        )) ??
    // "Screen FOR relative volume >= 2" — the feature is the object of the head's preposition. The
    // operator hangs off the sentence root, so without this route a perfectly explicit screen
    // refuses.
    childrenOf(tokens, node)
      .filter((child) => child.dep === "prep")
      .flatMap((preposition) => childrenOf(tokens, preposition))
      .find((child) => child.dep === "pobj" && isFeature(child)) ??
    null;

  if (nominal) {
    return {
      ok: true,
      attachment: {
        operatorIndex,
        operatorText: operator.text,
        subject: nominal,
        operand,
        operandConjuncts: conjuncts,
        operandQuantifier: quantifier,
        route: [`${nominal === node ? "head" : "modifier of"} "${node.text}" (${node.dep})`, ...route].join(", "),
      },
    };
  }

  return {
    ok: false,
    code: "AMBIGUOUS_ATTACHMENT",
    reason: `"${operator.text}" governs "${node.text}", which names no known feature.`,
  };
}
