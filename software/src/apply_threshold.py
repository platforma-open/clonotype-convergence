"""Stage 2 — apply threshold to Nb_freq, emit fastStar column.

Cheap per-row op, isolated from Stage 1 (compute_neighbours.py) so the
expensive neighbour-count cache survives threshold tweaks (R56).

CLI:
    apply_threshold.py
        --input <tsv>          # Stage 1 output
        --output <tsv>
        --threshold <float>
        --chain <str>
        [--sample-column <name>]   # defaults to sampleId

Adds one column to the input TSV:
    fastStar  — Int 0/1 hit flag, strict inequality nb_freq > threshold (R32).
                Nb_freq == threshold is NOT a hit.

Per-group hit counts logged when sample column is present (R44).
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
    parser.add_argument("--chain", required=True)
    parser.add_argument(
        "--sample-column",
        default="sampleId",
        dest="sample_column",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    t0 = time.monotonic()

    df = pd.read_csv(args.input, sep="\t")

    if "Nb_freq" not in df.columns:
        print("error: input TSV missing required column Nb_freq", flush=True)
        return 2

    # Strict inequality per R32. NaN > x is False, so NaN rows get fastStar=0.
    df["fastStar"] = (df["Nb_freq"] > args.threshold).astype(int)

    sample_col = args.sample_column.strip() if args.sample_column else ""
    label_col = "sampleLabel" if "sampleLabel" in df.columns else None

    if sample_col and sample_col in df.columns:
        for sample_id, group in df.groupby(df[sample_col].astype(str), sort=True):
            hits = int(group["fastStar"].sum())
            display = (
                str(group[label_col].iloc[0])
                if label_col and len(group) > 0 and pd.notna(group[label_col].iloc[0])
                else sample_id
            )
            print(
                f"[sample {display}, chain {args.chain}] "
                f"threshold: {args.threshold}, hit count: {hits} / {len(group)}",
                flush=True,
            )
    else:
        hits = int(df["fastStar"].sum())
        print(
            f"[chain {args.chain}] threshold: {args.threshold}, "
            f"hit count: {hits} / {len(df)}",
            flush=True,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, sep="\t", index=False)

    elapsed = time.monotonic() - t0
    print(f"[chain {args.chain}] elapsed: {elapsed:.2f}s", flush=True)
    print(f"[chain {args.chain}] apply-threshold done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
