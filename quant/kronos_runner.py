"""
The Kronos runner — the last piece of the forecast seam.

Reads the manifest written by `scripts/forecast-manifest.mts`, runs the model over each
request's bars, and writes one forecast file per instrument in the shape
`lib/forecast/kronos.ts` validates.

## The rule this file exists to obey

`docs/KRONOS_RUNNER.md`:

    Never regenerate forecasts over history and write them with a current `generatedAt`.

A forecast for bar t+1 produced at bar t is legitimate. The same file produced today, over last
year's bars, and scored as though it had been available at each of them, is lookahead — and it
will make any model look prophetic. `scoreForecast` drops predicted bars at or before
`generatedAt` specifically to catch this, but that guard only works if `generatedAt` is honest.

So `generatedAt` is stamped **once, before any inference runs**, and every predicted bar is
placed strictly after the last observed bar. There is no code path here that backfills.

## What this deliberately does not do

- It does not write `epistemicStatus`. The reader stamps `not_forward_validated` itself and
  ignores anything the file claims. A producer must not be able to promote its own standing.
- It does not re-clamp `lookbackBars`. The manifest has already clamped it to the checkpoint's
  context window; silently clamping again would hide a mismatch rather than surface it.
- It does not write an empty `bars` array. An empty forecast is a refusal, so no file is written.

Usage:
    python quant/kronos_runner.py [--device cpu] [--samples 1]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# The published checkpoints and their context windows, mirroring KRONOS_CHECKPOINTS in
# lib/forecast/kronos.ts. An unknown name is refused rather than having its window guessed.
CHECKPOINTS = {
    "Kronos-mini": 2048,
    "Kronos-small": 512,
    "Kronos-base": 512,
}

DEFAULT_MODEL_ROOT = Path(os.environ.get("KRONOS_MODEL_ROOT", r"D:\models\kronos"))

# Bars per timeframe, used only to place future timestamps. Kronos needs the future stamps to
# forecast against; getting the spacing wrong shifts every predicted bar.
TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "1d": 86_400,
    "D": 86_400,
}


class RunnerError(RuntimeError):
    """A refusal. Raised rather than writing a file that would be wrong."""


def safe_name(value: str) -> str:
    """Mirrors `forecastPath` in lib/forecast/kronos.ts."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", value)


def load_predictor(model_root: Path, checkpoint: str, device: str):
    src = model_root / "src"
    if not src.exists():
        raise RunnerError(
            f"{src} does not exist. Clone the Kronos source beside the weights, or set "
            "KRONOS_MODEL_ROOT to a directory containing src/, Kronos-base/ and "
            "Kronos-Tokenizer-base/."
        )
    sys.path.insert(0, str(src))

    from model import Kronos, KronosPredictor, KronosTokenizer  # noqa: E402

    weights = model_root / checkpoint
    tokenizer_dir = model_root / "Kronos-Tokenizer-base"
    for directory in (weights, tokenizer_dir):
        if not directory.exists():
            raise RunnerError(f"{directory} does not exist. Cannot run {checkpoint} without it.")

    tokenizer = KronosTokenizer.from_pretrained(str(tokenizer_dir))
    model = Kronos.from_pretrained(str(weights))
    return KronosPredictor(model, tokenizer, device=device, max_context=CHECKPOINTS[checkpoint])


def future_timestamps(last_time: int, step_seconds: int, horizon: int):
    import pandas as pd

    return pd.to_datetime(
        [(last_time + step_seconds * (i + 1)) for i in range(horizon)], unit="s", utc=True
    ).tz_localize(None)


def run_request(predictor, request: dict, generated_at: str, generated_epoch: int, samples: int) -> dict | None:
    import pandas as pd

    checkpoint = request["checkpoint"]
    if checkpoint not in CHECKPOINTS:
        raise RunnerError(
            f'"{checkpoint}" is not a published Kronos checkpoint. Refusing rather than guessing '
            "its context window."
        )

    bars = request.get("bars") or []
    if not bars:
        raise RunnerError(f"{request['instrumentId']}: manifest carried no bars.")

    lookback = request["lookbackBars"]
    if lookback > CHECKPOINTS[checkpoint]:
        # Loudly, per the runner spec. Reading the last N silently is the one mistake that is
        # invisible at runtime.
        raise RunnerError(
            f"{request['instrumentId']}: manifest asks for {lookback} bars but {checkpoint} "
            f"attends to {CHECKPOINTS[checkpoint]}. Refusing rather than silently truncating."
        )

    frame = pd.DataFrame(bars)[["open", "high", "low", "close", "volume"]].astype(float)
    # Kronos expects a turnover column; volume × mean price is the standard stand-in and is what
    # the reference implementation fills in when it is absent.
    frame["amount"] = frame["volume"] * frame[["open", "high", "low", "close"]].mean(axis=1)

    stamps = pd.to_datetime([bar["time"] for bar in bars], unit="s", utc=True).tz_localize(None)
    step = TIMEFRAME_SECONDS.get(request["timeframe"], 86_400)
    last_time = int(bars[-1]["time"])
    horizon = request["horizonBars"]

    predicted = predictor.predict(
        df=frame,
        x_timestamp=pd.Series(stamps),
        y_timestamp=pd.Series(future_timestamps(last_time, step, horizon)),
        pred_len=horizon,
        T=1.0,
        top_p=0.9,
        sample_count=samples,
        verbose=False,
    )

    out_bars = []
    dropped = 0
    for index in range(len(predicted)):
        row = predicted.iloc[index]
        bar_time = last_time + step * (index + 1)

        # The lookahead guard, enforced at write time rather than left to the scorer.
        #
        # Bars are placed relative to the last *observed* bar, and the feed can lag: when the
        # last daily bar is yesterday's and the model runs after today's open, "the next bar"
        # is already in the past. `scoreForecast` drops those, so leaving them in would produce
        # a file claiming a 5-bar horizon of which only 4 could ever be scored — the count would
        # be a lie even though every number in it was honest.
        if bar_time <= generated_epoch:
            dropped += 1
            continue

        out_bars.append(
            {
                "time": bar_time,
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume", 0.0)),
            }
        )

    if dropped:
        print(
            f"  {request['instrumentId']}: dropped {dropped} predicted bar(s) already in the past "
            f"(the feed's last bar is {step * dropped}s or more behind the run).",
            file=sys.stderr,
        )

    if not out_bars:
        # An empty array is a refusal, so write no file rather than an empty one.
        raise RunnerError(
            f"{request['instrumentId']}: every predicted bar fell at or before the run time. The "
            "input series is too stale to forecast from; refresh the manifest before rerunning."
        )

    return {
        "instrumentId": request["instrumentId"],
        "timeframe": request["timeframe"],
        "checkpoint": checkpoint,
        "generatedAt": generated_at,
        "lookbackBars": lookback,
        "bars": out_bars,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Kronos over the forecast manifest.")
    parser.add_argument("--device", default="cpu", help="torch device (default: cpu)")
    parser.add_argument("--samples", type=int, default=1, help="samples averaged per series")
    parser.add_argument(
        "--model-root", default=str(DEFAULT_MODEL_ROOT), help="directory holding weights and src/"
    )
    parser.add_argument(
        "--quant-root",
        default=os.environ.get("QUANT_CORE_ROOT", str(REPO_ROOT / "data" / "quantcore")),
        help="quant core root; the manifest and output directory live under it",
    )
    args = parser.parse_args()

    quant_root = Path(args.quant_root)
    manifest_path = quant_root / "forecast-manifest.json"
    if not manifest_path.exists():
        print(
            f"No manifest at {manifest_path}. Run `npx tsx scripts/forecast-manifest.mts` first.",
            file=sys.stderr,
        )
        return 2

    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    requests = manifest.get("requests") or []
    if not requests:
        print("Manifest has no requests. Nothing to forecast.", file=sys.stderr)
        return 0

    # Stamped once, before any inference. Every bar written below is placed after the last
    # observed bar, so no output can predate the instant the model ran.
    now = datetime.now(timezone.utc)
    generated_at = now.isoformat().replace("+00:00", "Z")
    generated_epoch = int(now.timestamp())

    checkpoint = requests[0]["checkpoint"]
    if any(item["checkpoint"] != checkpoint for item in requests):
        print("Manifest mixes checkpoints; run one checkpoint at a time.", file=sys.stderr)
        return 2

    predictor = load_predictor(Path(args.model_root), checkpoint, args.device)

    out_dir = quant_root / manifest.get("outputDir", "data/forecasts/kronos")
    out_dir.mkdir(parents=True, exist_ok=True)

    written, refused = 0, 0
    for request in requests:
        try:
            payload = run_request(predictor, request, generated_at, generated_epoch, args.samples)
        except Exception as caught:  # noqa: BLE001 - one bad instrument must not stop the run
            print(f"  refused {request['instrumentId']}: {caught}", file=sys.stderr)
            refused += 1
            continue

        if payload is None:
            refused += 1
            continue

        name = f"{safe_name(request['instrumentId'])}_{safe_name(request['timeframe'])}.json"
        (out_dir / name).write_text(json.dumps(payload, indent=2), encoding="utf8")
        written += 1
        print(f"  wrote {name} ({len(payload['bars'])} bars)")

    print(f"{written} forecast(s) written to {out_dir}, {refused} refused.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
