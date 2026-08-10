"""
Persistent dependency-parse worker.

## Why a worker and not a script per clause

The model is the cost. `en_core_web_sm` loads in ~0.5s and `en_core_web_trf` in several seconds;
paying that once per clause would make compilation slower than the Claude research request that
produced the prose. The model loads once, then each request is a parse.

## What this deliberately does NOT do

It returns GRAMMAR. It does not know what ENTRY, EXIT, RSI14 or BUY mean, and it must never learn.
MarketPulse owns trading semantics; this process owns sentence structure. A parser that returns
Strategy IR would be a second, untested authoring path with no span guard, no dimensional analysis
and no satisfiability gate in front of it — exactly the failure the semantic compiler exists to
prevent.

## Protocol

One JSON object per line on stdin, one JSON object per line on stdout, in request order.

    -> {"requestId": "1", "text": "Enter when close is above SMA20."}
    <- {"requestId": "1", "ok": true, "sentences": [...], "tokens": [...]}

    -> {"requestId": "2", "op": "health"}
    <- {"requestId": "2", "ok": true, "parser": "spacy", ...}

Character offsets in the response index the EXACT text that was sent, so the caller can merge
syntax back onto its own prose without re-deriving positions.
"""

from __future__ import annotations

import json
import sys


def _load(model_name: str):
    import spacy

    nlp = spacy.load(model_name)
    meta = nlp.meta
    return nlp, f"{meta.get('lang', '')}_{meta.get('name', '')}", str(meta.get("version", ""))


def _parse(nlp, text: str) -> dict:
    doc = nlp(text)
    return {
        "sentences": [
            {"start": sent.start_char, "end": sent.end_char, "text": sent.text}
            for sent in doc.sents
        ],
        "tokens": [
            {
                "index": token.i,
                "text": token.text,
                "lemma": token.lemma_,
                "pos": token.pos_,
                "tag": token.tag_,
                "dep": token.dep_,
                # A token that heads its own clause points at itself in spaCy; keep that convention
                # rather than inventing a null, so the caller can detect roots structurally.
                "headIndex": token.head.i,
                "start": token.idx,
                "end": token.idx + len(token.text),
                "isSentStart": bool(token.is_sent_start),
            }
            for token in doc
        ],
    }


def main() -> int:
    # The model name is an argument, never a default. Choosing a parser silently is how a benchmark
    # result stops describing the thing actually running in production.
    if len(sys.argv) < 2:
        sys.stdout.write(
            json.dumps({"ok": False, "error": "USAGE: syntax_parser.py <model-name>"}) + "\n"
        )
        sys.stdout.flush()
        return 2

    model_name = sys.argv[1]
    try:
        nlp, resolved, version = _load(model_name)
    except Exception as caught:  # noqa: BLE001 - the caller needs the reason, whatever it is
        sys.stdout.write(
            json.dumps({"ok": False, "error": f"MODEL_LOAD_FAILED: {model_name}: {caught}"}) + "\n"
        )
        sys.stdout.flush()
        return 3

    import spacy

    ready = {
        "ok": True,
        "ready": True,
        "parser": "spacy",
        "parserVersion": spacy.__version__,
        "model": resolved,
        "modelVersion": version,
        "python": sys.version.split()[0],
    }
    sys.stdout.write(json.dumps(ready) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as caught:
            sys.stdout.write(json.dumps({"ok": False, "error": f"BAD_REQUEST: {caught}"}) + "\n")
            sys.stdout.flush()
            continue

        request_id = request.get("requestId")
        if request.get("op") == "health":
            sys.stdout.write(json.dumps({**ready, "requestId": request_id}) + "\n")
            sys.stdout.flush()
            continue
        if request.get("op") == "shutdown":
            return 0

        try:
            payload = _parse(nlp, request.get("text") or "")
            response = {"requestId": request_id, "ok": True, **payload}
        except Exception as caught:  # noqa: BLE001
            response = {"requestId": request_id, "ok": False, "error": f"PARSE_FAILED: {caught}"}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
