"""
Benchmark candidate dependency parsers on the REAL MarketPulse research corpus.

## What is being measured

Not "is the parse tree good" in the abstract. One question only:

    For each comparison operator in the prose, does the parse identify the feature that operator
    actually governs?

That is the decision the positional heuristics got wrong four times in a row on live probes, and it
is the only decision the parser is being brought in to make.

## Corpus provenance

Every case below is real prose from a live `claude-sonnet-5` research probe on TCS · RELIANCE ·
NIFTYBEES · SBIN (2026-08-11), recovered from the literals captured in
`lib/research/semantic-compiler.test.ts` and `docs/autonomous-build/FINDINGS.md`.

It is NOT drawn from persisted research envelopes: there are none. `agent_runs` and
`stock_analysis_reports` are both empty (see docs/plans/syntax-attachment/01-reality.md, R3). The
corpus is real research text; it is not evidence that the persistence path works.

Run:
    python quant/syntax_benchmark.py en_core_web_sm [en_core_web_trf ...]
"""

from __future__ import annotations

import json
import sys
import time

# (label, prose, [(operator_text, occurrence_index, expected_subject_substring)])
#
# `expected_subject_substring` is the token the operator's SUBJECT must fall inside. Stated as
# prose, not as a compiler feature id, so this file stays a statement about English and does not
# silently encode the compiler's own opinion.
CORPUS: list[tuple[str, str, list[tuple[str, int, str]]]] = [
    (
        "NIFTYBEES-band-vs-sma (the defect that authored 50<=sma20<=70)",
        "Enter when close is above both its 20-day and 50-day SMAs with RSI-14 between 50 and 70.",
        [("above", 0, "close"), ("between", 0, "RSI")],
    ),
    (
        "NIFTYBEES-real-probe",
        "When NIFTYBEES closes above both its 20-day and 50-day SMAs while RSI-14 sits in the 50-70 "
        "range, the resulting uptrend regime tends to persist rather than immediately reverse.",
        [("above", 0, "closes")],
    ),
    (
        "TCS-real-probe-entry",
        "Entry: enter when close is above sma_20 and rsi_14 is between 45 and 65.",
        [("above", 0, "close"), ("between", 0, "rsi_14")],
    ),
    (
        "TCS-real-probe-exit",
        "Exit: exit when close falls below sma_50.",
        [("below", 0, "close")],
    ),
    (
        "crossing-with-trailing-feature (produced 'rsi14 crosses above close')",
        "Exit when rsi_14 crosses above 70 on the daily close.",
        [("above", 0, "rsi_14")],
    ),
    (
        "two-operators-one-subject",
        "Enter when close is above SMA20 and below SMA50.",
        [("above", 0, "close"), ("below", 0, "close")],
    ),
    (
        "feature-to-feature",
        "Enter when the 20-day SMA is above the 50-day SMA.",
        [("above", 0, "SMA")],
    ),
    (
        "adversative-clause",
        "Price has pulled back but remains above SMA20.",
        [("above", 0, "remains")],
    ),
    (
        "crossing-features",
        "Enter when EMA20 crosses above EMA50.",
        [("above", 0, "crosses")],
    ),
    (
        "SBIN-band",
        "Enter while RSI-14 is between 55 and 70 and close is above SMA20.",
        [("between", 0, "RSI"), ("above", 0, "close")],
    ),
]


# Words that NAME a tradeable quantity. The parser supplies structure; this supplies the only
# domain knowledge the walk is allowed — which of several grammatically-valid candidates is a
# feature at all. Without it "When NIFTYBEES closes above X" resolves to the INSTRUMENT (the
# grammatical subject) instead of the PRICE (the verb), which is grammatically right and
# financially useless.
FEATURE_WORDS = (
    "close", "closes", "price", "open", "high", "low", "volume",
    "sma", "ema", "wma", "vwap", "rsi", "macd", "atr", "adx", "bollinger", "average", "averages",
)


def _is_feature(token) -> bool:
    text = token.text.lower()
    lemma = token.lemma_.lower()
    return any(word in text or word == lemma for word in FEATURE_WORDS)


def subject_candidates(operator_token) -> list:
    """
    The grammatically defensible readings of "what does this operator govern".

    Three structures cover the corpus, and all three are a climb — never a character distance:

      1. `close IS above X`   -> operator's head is a copula; the feature is its subject-like child.
                                 spaCy tags the finance noun "close" as ADJ, so it surfaces as
                                 `acomp`/`amod` rather than `nsubj`. Both are accepted.
      2. `RSI-14 between 50`  -> operator hangs off the NUMBER (`quantmod`), which hangs off the
                                 feature (`nummod`). A one-hop walk stops on the number and reports
                                 `50` as the subject. Numeric links are therefore climbed through.
      3. `NIFTYBEES closes above X` -> the feature is the VERB itself; its `nsubj` is the
                                 instrument. Both are offered and ranked below.

    Returns candidates in structural preference order. Ranking between them is the caller's job.
    """
    node = operator_token.head
    if node is operator_token:
        return []

    # (2) climb through numeric/quantifier links to the noun they quantify.
    hops = 0
    while node.pos_ in ("NUM", "SYM") and node.head is not node and hops < 3:
        node = node.head
        hops += 1

    if node.pos_ not in ("VERB", "AUX"):
        return [node]

    candidates = []
    for child in node.children:
        if child.dep_ in ("nsubj", "nsubjpass"):
            candidates.append(child)
    for child in node.children:
        # (1) the finance-noun-as-adjective case.
        if child.dep_ in ("acomp", "amod", "attr", "dobj") and child.i < operator_token.i:
            candidates.append(child)
    candidates.append(node)  # (3) the verb itself, e.g. "closes".
    return candidates


def subject_of(doc, operator_token):
    """Pick the candidate that names a tradeable quantity; fall back to the structural best."""
    candidates = subject_candidates(operator_token)
    if not candidates:
        return None
    for candidate in candidates:
        if _is_feature(candidate):
            return candidate
    return candidates[0]


def run(model_name: str) -> dict:
    import spacy

    load_started = time.perf_counter()
    nlp = spacy.load(model_name)
    load_seconds = time.perf_counter() - load_started

    correct = 0
    total = 0
    failures = []
    parse_seconds = 0.0

    for label, prose, expectations in CORPUS:
        started = time.perf_counter()
        doc = nlp(prose)
        parse_seconds += time.perf_counter() - started

        for operator_text, occurrence, expected in expectations:
            total += 1
            matches = [t for t in doc if t.text.lower() == operator_text.lower()]
            if occurrence >= len(matches):
                failures.append(f"{label}: operator '{operator_text}' not tokenised")
                continue

            operator_token = matches[occurrence]
            subject = subject_of(doc, operator_token)
            got = subject.text if subject is not None else "<none>"

            if subject is not None and expected.lower() in subject.text.lower():
                correct += 1
            else:
                failures.append(
                    f"{label}: '{operator_text}' -> got '{got}', expected to contain '{expected}'"
                )

    return {
        "model": model_name,
        "correct": correct,
        "total": total,
        "accuracy": round(correct / total, 4) if total else 0.0,
        "loadSeconds": round(load_seconds, 3),
        "parseSeconds": round(parse_seconds, 4),
        "failures": failures,
    }


def main() -> int:
    models = sys.argv[1:] or ["en_core_web_sm"]
    results = []
    for model_name in models:
        try:
            results.append(run(model_name))
        except Exception as caught:  # noqa: BLE001
            results.append({"model": model_name, "error": str(caught)})

    print(json.dumps(results, indent=2))

    usable = [r for r in results if "error" not in r]
    if usable:
        best = max(usable, key=lambda r: r["accuracy"])
        print(f"\nBEST: {best['model']}  {best['correct']}/{best['total']}  "
              f"({best['accuracy']:.0%})  parse={best['parseSeconds']:.3f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
