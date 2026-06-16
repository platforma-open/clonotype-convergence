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
        [--stats-json <path>]      # write {above, total} for the stats modal (R65)

Adds one column to the input TSV:
    fastStar  — String "Hit" / "Not hit" (R32, R62). Strict inequality
                Nb_freq > threshold. Nb_freq == threshold is NOT a hit.
                String values pair with the column's pl7.app/discreteValues
                annotation in the workflow spec so the table renders chips.

Per-group hit counts logged when sample column is present (R44).
When `--stats-json` is given, writes a small JSON sidecar with the
cross-sample hit-count and total, consumed by the stats modal (R65).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd


HIT = "Hit"
NOT_HIT = "Not hit"


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
    parser.add_argument("--stats-json", type=Path, dest="stats_json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    df = pd.read_csv(args.input, sep="\t")

    if "Nb_freq" not in df.columns:
        print("error: input TSV missing required column Nb_freq")
        return 2

    # Strict inequality per R32. NaN > x is False, so NaN rows get "Not hit".
    df["fastStar"] = (df["Nb_freq"] > args.threshold).map({True: HIT, False: NOT_HIT})

    sample_col = args.sample_column.strip() if args.sample_column else ""

    if sample_col and sample_col in df.columns:
        # Heavy TSV carries anonymized sampleIds, so log a project-neutral
        # counter rather than the (fingerprint) id.
        groups = list(df.groupby(df[sample_col].astype(str), sort=True))
        total = len(groups)
        for idx, (_sample_id, group) in enumerate(groups, start=1):
            hits = int((group["fastStar"] == HIT).sum())
            print(
                f"[sample {idx}/{total}, chain {args.chain}] "
                f"threshold: {args.threshold}, hit count: {hits} / {len(group)}"
            )
    else:
        hits = int((df["fastStar"] == HIT).sum())
        print(
            f"[chain {args.chain}] threshold: {args.threshold}, "
            f"hit count: {hits} / {len(df)}"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, sep="\t", index=False)

    if args.stats_json is not None:
        stats = {
            "above": int((df["fastStar"] == HIT).sum()),
            "total": int(len(df)),
        }
        args.stats_json.parent.mkdir(parents=True, exist_ok=True)
        args.stats_json.write_text(json.dumps(stats))

    # No wall-clock log — pure template requires deterministic stdout
    # for cache stability (see compute_neighbours.py for the long form).
    print(f"[chain {args.chain}] apply-threshold done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
