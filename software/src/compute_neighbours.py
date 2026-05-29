"""Stage 1 — multiplicity-weighted Hamming-1 aa CDR3 neighbour count.

Wraps statbiophys/STAR's Get_df (vendored to ./get_df.py). For each
clonotype row, emits the multiplicity-weighted neighbour count and the
normalised neighbour frequency. Threshold is intentionally NOT consumed
here so this stage's pure-template cache survives threshold tweaks (R56).

CLI:
    compute_neighbours.py
        --input <tsv>
        --output <tsv>
        --nMin <int>
        --sample-id <str>
        --chain <str>

Input TSV must contain `aaSeqCDR3` and `nSeqCDR3` columns. Additional
columns (e.g. clonotype-key axes, abundance) are passed through unchanged.

Output TSV is the input TSV with three columns appended:
    multiplicity  — nt-CDR3 count per aa CDR3 (informational)
    neighbours    — multiplicity-weighted Hamming-1 neighbour count
    Nb_freq       — neighbours / N_nt (continuous density)

Structured stdout per R44 — one event per line, prefixed
``[sample <id>, chain <chain>]``.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

from get_df import Get_df


SAMPLE_SIZE_WARN = 10_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--nMin", required=True, type=int)
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
    log(prefix, f"input rows: {len(df)}")

    required = {"aaSeqCDR3", "nSeqCDR3"}
    missing = required - set(df.columns)
    if missing:
        log(prefix, f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    # Drop rows with null / empty / NaN in either CDR3 column (R13).
    before = len(df)
    df = df[df["aaSeqCDR3"].notna() & df["nSeqCDR3"].notna()]
    df = df[(df["aaSeqCDR3"] != "") & (df["nSeqCDR3"] != "")]
    dropped = before - len(df)
    if dropped > 0:
        log(prefix, f"dropped {dropped} rows with null/empty aaSeqCDR3 or nSeqCDR3")

    n_nt = df["nSeqCDR3"].nunique()
    n_aa = df["aaSeqCDR3"].nunique()
    log(prefix, f"unique nt CDR3: {n_nt}")
    log(prefix, f"unique aa CDR3: {n_aa}")

    # Sample-size floor (R11, R12).
    if n_nt < args.nMin:
        log(
            prefix,
            f"error: unique nt CDR3 count {n_nt} below nMin {args.nMin}; "
            "sample skipped (N_nt below the floor where neighbour density is meaningful)",
        )
        return 3

    # Reliability warning (R11). Hardcoded 10 000 per spec.
    if n_nt < SAMPLE_SIZE_WARN:
        log(
            prefix,
            f"warning: unique nt CDR3 count {n_nt} below {SAMPLE_SIZE_WARN}; "
            "signal may be unreliable (paper-reported lower bound for stable STAR estimates)",
        )

    # Get_df expects a DataFrame with at least aaSeqCDR3 and nSeqCDR3.
    # Pass a clean view restricted to those columns to avoid surprising it.
    star_input = df[["aaSeqCDR3", "nSeqCDR3"]].reset_index(drop=True)
    per_aa = Get_df(star_input).make()  # one row per unique aa CDR3

    # Join the per-aa stats back onto the original per-row table by aaSeqCDR3
    # so every input clonotype row carries the value for its aa CDR3.
    stats = per_aa.rename(
        columns={
            "Neighbours": "neighbours",
            "Nb_freq": "Nb_freq",
            "Multiplicity": "multiplicity",
        }
    )[["aaSeqCDR3", "multiplicity", "neighbours", "Nb_freq"]]
    out = df.merge(stats, on="aaSeqCDR3", how="left")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, sep="\t", index=False)

    elapsed = time.monotonic() - t0
    log(prefix, f"elapsed: {elapsed:.2f}s")
    log(prefix, "compute-neighbours done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
