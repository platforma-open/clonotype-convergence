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
    print(f"{prefix} {msg}")


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
            f"Error: sample unique nt CDR3 count ({n_nt}) below the defined "
            f"minimum ({n_min}). This minimum defines the floor where neighbour "
            "density is meaningful; group skipped",
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

    df = pd.read_csv(args.input, sep="\t")

    required = {"aaSeqCDR3", "nSeqCDR3"}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    # Pre-grouping drop of rows with null/empty CDR3 fields. The
    # workflow's TSV builder outer-joins by axis name, which can drag
    # in spurious rows from project-wide siblings (e.g. the sampleLabel
    # column carrying labels for samples that belong to a different
    # MiXCR run with no clonotype-axis match). Those rows arrive with
    # populated sampleId + sampleLabel but NULL CDR3s — they're not
    # real per-sample groups for THIS anchor. Drop them before the
    # per-sample iteration so they don't appear as fake "sample with
    # 1 row" entries in the structured log (R13).
    pre_drop_total = len(df)
    df = df[df["aaSeqCDR3"].notna() & df["nSeqCDR3"].notna()]
    df = df[(df["aaSeqCDR3"] != "") & (df["nSeqCDR3"] != "")]
    pre_dropped = pre_drop_total - len(df)
    if pre_dropped > 0:
        print(
            f"[chain {args.chain}] dropped {pre_dropped} rows with null/empty "
            "aaSeqCDR3 or nSeqCDR3 before per-sample grouping"
        )

    sample_col = args.sample_column.strip() if args.sample_column else ""
    grouping = bool(sample_col) and sample_col in df.columns
    # Prefer the human-readable sample label for log prefixes when the
    # workflow attached one; fall back to the raw sampleId otherwise.
    label_col = "sampleLabel" if "sampleLabel" in df.columns else None

    outputs = []
    skipped = []

    if grouping:
        sample_ids = sorted(df[sample_col].astype(str).unique().tolist())
        for sample_id in sample_ids:
            group = df[df[sample_col].astype(str) == sample_id]
            display = (
                str(group[label_col].iloc[0])
                if label_col and len(group) > 0 and pd.notna(group[label_col].iloc[0])
                else sample_id
            )
            result = process_group(group, display, args.chain, args.nMin)
            if result is None:
                skipped.append(display)
                continue
            outputs.append(result)
    else:
        result = process_group(df, "all", args.chain, args.nMin)
        if result is not None:
            outputs.append(result)

    args.output.parent.mkdir(parents=True, exist_ok=True)

    if not outputs:
        # All groups below nMin — emit an empty (header-only) TSV and
        # exit 0 so the downstream pipeline (Stage 2 + xsv.importFile)
        # produces empty PColumns rather than the whole workflow
        # aborting. The UI surfaces "no data" naturally via the empty
        # histogram pframe / table rows.
        print(
            f"[chain {args.chain}] warning: all groups below nMin "
            f"(skipped: {skipped}); emitting empty output"
        )
        empty = pd.DataFrame(
            columns=list(df.columns) + ["multiplicity", "neighbours", "Nb_freq"]
        )
        empty.to_csv(args.output, sep="\t", index=False)
        return 0

    if skipped:
        print(
            f"[chain {args.chain}] skipped groups (below nMin): {skipped}"
        )

    out = pd.concat(outputs, ignore_index=True)
    out.to_csv(args.output, sep="\t", index=False)

    # Intentionally NO wall-clock log line here: this template is a pure
    # template (cache key omits threshold per R56), so stdout content must
    # be deterministic across re-runs with identical inputs. A wall-clock
    # elapsed value would mutate the captured stdout-stream resource and
    # break the cache (CID conflict when threshold-only changes attempt to
    # reuse Stage 1's slot).
    print(f"[chain {args.chain}] compute-neighbours done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
