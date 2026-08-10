"""Half two of the Engle-Granger parity corpus.

Scores the SAME synthetic series that `scripts/statarb-parity-corpus.mts` wrote with
statsmodels.tsa.stattools.coint (Augmented Engle-Granger, MacKinnon critical values and
approximate p-values), then reports agreement with MarketPulse's in-house approximation.

Neither implementation grades itself: the TypeScript side records its verdicts before this runs.
"""

import json
import pathlib
import sys

import numpy as np
from statsmodels.tsa.stattools import coint

CORPUS = pathlib.Path(".tmp/statarb-parity-corpus.json")
REPORT = pathlib.Path(".tmp/statarb-parity-report.json")

if not CORPUS.exists():
    sys.exit(f"corpus not found at {CORPUS}; run: npx tsx scripts/statarb-parity-corpus.mts")

data = json.loads(CORPUS.read_text())
cases = data["cases"]

rows = []
for case in cases:
    a = np.asarray(case["a"], dtype=float)
    b = np.asarray(case["b"], dtype=float)
    # maxlag=1, autolag=None mirrors our fixed-lag choice as closely as the library allows.
    stat, pvalue, critical = coint(a, b, trend="c", maxlag=1, autolag=None)
    reference_verdict = "COINTEGRATED" if stat < critical[1] else "NOT_COINTEGRATED"
    rows.append(
        {
            "id": case["id"],
            "kind": case["kind"],
            "length": case["length"],
            "ours": case["ourVerdict"],
            "ourStatistic": case["ourStatistic"],
            "reference": reference_verdict,
            "referenceStatistic": float(stat),
            "referencePValue": float(pvalue),
            "reference5pct": float(critical[1]),
            "agree": case["ourVerdict"] == reference_verdict,
            "statisticDelta": (
                None if case["ourStatistic"] is None else float(case["ourStatistic"]) - float(stat)
            ),
        }
    )

by_kind = {}
for row in rows:
    bucket = by_kind.setdefault(row["kind"], {"total": 0, "agree": 0, "deltas": []})
    bucket["total"] += 1
    bucket["agree"] += 1 if row["agree"] else 0
    if row["statisticDelta"] is not None:
        bucket["deltas"].append(abs(row["statisticDelta"]))

summary = {}
for kind, bucket in by_kind.items():
    deltas = bucket["deltas"]
    summary[kind] = {
        "total": bucket["total"],
        "agreement": round(bucket["agree"] / bucket["total"], 4),
        "meanAbsStatisticDelta": round(float(np.mean(deltas)), 4) if deltas else None,
        "maxAbsStatisticDelta": round(float(np.max(deltas)), 4) if deltas else None,
    }

overall = {
    "cases": len(rows),
    "agreement": round(sum(1 for r in rows if r["agree"]) / len(rows), 4),
    "byKind": summary,
    "referenceLibrary": "statsmodels.tsa.stattools.coint(trend='c', maxlag=1, autolag=None)",
    "disagreements": [
        {k: r[k] for k in ("id", "kind", "length", "ours", "reference", "ourStatistic", "referenceStatistic")}
        for r in rows
        if not r["agree"]
    ][:40],
}

REPORT.write_text(json.dumps({"summary": overall, "rows": rows}, indent=1))
print(json.dumps(overall["byKind"], indent=1))
print("overall agreement:", overall["agreement"], "| cases:", overall["cases"])
print("report:", REPORT)
