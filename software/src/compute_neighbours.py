"""Stage 1 — multiplicity-weighted Hamming-1 aa CDR3 neighbour count.

Wraps statbiophys/STAR's Get_df (vendored to ./get_df.py). Threshold is
intentionally NOT consumed here so this stage's pure-template cache
survives threshold tweaks (R56).

CLI:
    compute_neighbours.py
        --input <tsv>
        --output <tsv>
        --nMin <int>
        --chain <str>
        [--sample-column <name>]   # defaults to sampleId; pass empty to disable

Input TSV must contain `aaSeqCDR3` and `nSeqCDR3` columns. If
`--sample-column` (default `sampleId`) is present, rows are grouped by
that column and Get_df runs independently per group. Otherwise the
whole TSV is treated as one sample.

Other columns (clonotype-key axis, abundance, etc.) pass through.

Output TSV is the input TSV with three columns appended:
    multiplicity  — nt-CDR3 count per aa CDR3 (informational)
    neighbours    — multiplicity-weighted Hamming-1 neighbour count
    Nb_freq       — neighbours / N_nt (continuous density)

Per-group structured stdout per R44 — one event per line, prefixed
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
    parser.add_argument("--chain", required=True)
    parser.add_argument(
        "--sample-column",
        default="sampleId",
        dest="sample_column",
        help="Column to group rows by (pass empty string to disable grouping).",
    )
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}", flush=True)


def process_group(
    group_df: pd.DataFrame,
    sample_id: str,
    chain: str,
    n_min: int,
):
    """Run Get_df on one sample's rows. Returns annotated dataframe, or
    None if the group fails the nMin floor."""
    prefix = f"[sample {sample_id}, chain {chain}]"
    log(prefix, f"input rows: {len(group_df)}")

    # Drop rows with null / empty / NaN in either CDR3 column (R13).
    before = len(group_df)
    df = group_df[group_df["aaSeqCDR3"].notna() & group_df["nSeqCDR3"].notna()]
    df = df[(df["aaSeqCDR3"] != "") & (df["nSeqCDR3"] != "")]
    dropped = before - len(df)
    if dropped > 0:
        log(prefix, f"dropped {dropped} rows with null/empty aaSeqCDR3 or nSeqCDR3")

    n_nt = df["nSeqCDR3"].nunique()
    n_aa = df["aaSeqCDR3"].nunique()
    log(prefix, f"unique nt CDR3: {n_nt}")
    log(prefix, f"unique aa CDR3: {n_aa}")

    if n_nt < n_min:
        log(
            prefix,
            f"error: unique nt CDR3 count {n_nt} below nMin {n_min}; "
            "group skipped (N_nt below the floor where neighbour density is meaningful)",
        )
        return None

    if n_nt < SAMPLE_SIZE_WARN:
        log(
            prefix,
            f"warning: unique nt CDR3 count {n_nt} below {SAMPLE_SIZE_WARN}; "
            "signal may be unreliable (paper-reported lower bound for stable STAR estimates)",
        )

    star_input = df[["aaSeqCDR3", "nSeqCDR3"]].reset_index(drop=True)
    per_aa = Get_df(star_input).make()

    stats = per_aa.rename(
        columns={
            "Neighbours": "neighbours",
            "Nb_freq": "Nb_freq",
            "Multiplicity": "multiplicity",
        }
    )[["aaSeqCDR3", "multiplicity", "neighbours", "Nb_freq"]]
    out = df.merge(stats, on="aaSeqCDR3", how="left")
    log(prefix, f"output rows: {len(out)}")
    return out


def main() -> int:
    args = parse_args()
    t0 = time.monotonic()

    df = pd.read_csv(args.input, sep="\t")

    required = {"aaSeqCDR3", "nSeqCDR3"}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}", flush=True)
        return 2

    sample_col = args.sample_column.strip() if args.sample_column else ""
    grouping = bool(sample_col) and sample_col in df.columns

    outputs = []
    skipped = []

    if grouping:
        sample_ids = sorted(df[sample_col].astype(str).unique().tolist())
        for sample_id in sample_ids:
            group = df[df[sample_col].astype(str) == sample_id]
            result = process_group(group, sample_id, args.chain, args.nMin)
            if result is None:
                skipped.append(sample_id)
                continue
            outputs.append(result)
    else:
        result = process_group(df, "all", args.chain, args.nMin)
        if result is None:
            return 3
        outputs.append(result)

    if not outputs:
        print(
            f"[chain {args.chain}] error: all groups below nMin; "
            f"skipped sample ids: {skipped}",
            flush=True,
        )
        return 3

    if skipped:
        print(
            f"[chain {args.chain}] skipped groups (below nMin): {skipped}",
            flush=True,
        )

    out = pd.concat(outputs, ignore_index=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, sep="\t", index=False)

    elapsed = time.monotonic() - t0
    print(f"[chain {args.chain}] elapsed: {elapsed:.2f}s", flush=True)
    print(f"[chain {args.chain}] compute-neighbours done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
