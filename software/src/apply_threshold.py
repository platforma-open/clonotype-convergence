"""Stage 2 — apply threshold to Nb_freq, emit fastStar column.

Cheap operation, isolated from Stage 1 (compute_neighbours.py) so the
expensive neighbour-count cache survives threshold tweaks (R56).

CLI:
    apply_threshold.py
        --input <tsv>        # Stage 1 output
        --output <tsv>
        --threshold <float>
        --sample-id <str>
        --chain <str>

Adds one column to the input TSV:
    fastStar  — Int 0/1 hit flag, using STRICT inequality nb_freq > threshold.
                Nb_freq == threshold is NOT a hit (R32).

Structured stdout per R44.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--threshold", required=True, type=float)
    parser.add_argument("--sample-id", required=True, dest="sample_id")
    parser.add_argument("--chain", required=True)
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}", flush=True)


def main() -> int:
    args = parse_args()
    prefix = f"[sample {args.sample_id}, chain {args.chain}]"
    t0 = time.monotonic()

    df = pd.read_csv(args.input, sep="\t")

    if "Nb_freq" not in df.columns:
        log(prefix, "error: input TSV missing required column Nb_freq")
        return 2

    # Strict inequality per R32. `Nb_freq` may be NaN if Stage 1 found no
    # neighbours; `>` against NaN is False, so those rows get fastStar=0.
    df["fastStar"] = (df["Nb_freq"] > args.threshold).astype(int)

    hit_count = int(df["fastStar"].sum())
    log(prefix, f"threshold: {args.threshold}")
    log(prefix, f"hit count: {hit_count} / {len(df)} rows")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, sep="\t", index=False)

    elapsed = time.monotonic() - t0
    log(prefix, f"elapsed: {elapsed:.2f}s")
    log(prefix, "apply-threshold done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
