"""Stage 1 — multiplicity-weighted Hamming-1 aa CDR3 neighbour count.

Wraps statbiophys/STAR's Get_df (vendored to ./get_df.py). Threshold is
intentionally NOT consumed here so this stage's pure-template cache
survives threshold tweaks.

CLI:
    compute_neighbours.py
        --input <tsv>
        --output <tsv>
        --nMin <int>
        --chain <str>
        [--status-json <path>]

Input TSV is ONE sample's clonotypes (the per-sample fan-out slices the
whole-dataset input by sampleId before this runs — see
workflow/src/per-sample-neighbours.tpl.tengo). It must contain `aaSeqCDR3`
and `nSeqCDR3` columns; any other columns (e.g. the clonotype-key axis) pass
through unused. Abundance is intentionally NOT provided — the neighbour count
is weighted by nt-per-aa multiplicity, not read abundance.

Output TSV is the input TSV with three columns appended:
    multiplicity  — nt-CDR3 count per aa CDR3 (informational)
    neighbours    — multiplicity-weighted Hamming-1 neighbour count
    Nb_freq       — neighbours / N_nt (continuous density)

`--status-json` writes `{"nUniqueNt": <int>, "nMin": <int>}` — the
unique-nt-CDR3 count for this sample (after dropping null/empty CDR3s) and
the floor in effect. The model reads it per sample to decide the
skipped-samples warning (below nMin vs no usable CDR3); it exists even when
the sample is skipped and the output TSV is empty.

Structured stdout, one event per line, prefixed ``[chain <chain>]``. The
sample identity is supplied by the workflow (the result is keyed by the
real sampleId), so logs intentionally carry no sampleId.
"""

from __future__ import annotations

import argparse
import json
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
        "--status-json",
        type=Path,
        default=None,
        dest="status_json",
        help="Optional JSON sidecar with this sample's unique-nt-CDR3 count "
        "and nMin. The model reads it to surface the skipped-samples warning.",
    )
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}")


def process_sample(
    sample_df: pd.DataFrame,
    chain: str,
    n_min: int,
):
    """Run Get_df on this sample's rows. Returns ``(annotated_df_or_None,
    n_nt)`` — the dataframe is None when the sample's unique-nt-CDR3 count is
    below the nMin floor; ``n_nt`` is always the post-drop unique-nt count so
    the caller can report it regardless of the skip decision."""
    prefix = f"[chain {chain}]"
    log(prefix, f"input rows: {len(sample_df)}")

    # Drop rows with null / empty / NaN in either CDR3 column.
    before = len(sample_df)
    df = sample_df[sample_df["aaSeqCDR3"].notna() & sample_df["nSeqCDR3"].notna()]
    df = df[(df["aaSeqCDR3"] != "") & (df["nSeqCDR3"] != "")]
    dropped = before - len(df)
    if dropped > 0:
        log(prefix, f"dropped {dropped} rows with null/empty aaSeqCDR3 or nSeqCDR3")

    n_nt = int(df["nSeqCDR3"].nunique())
    n_aa = int(df["aaSeqCDR3"].nunique())
    log(prefix, f"unique nt CDR3: {n_nt}")
    log(prefix, f"unique aa CDR3: {n_aa}")

    if n_nt < n_min:
        log(
            prefix,
            f"unique nt CDR3 count ({n_nt}) below the defined minimum ({n_min}). "
            "This minimum defines the floor where neighbour density is "
            "meaningful; sample skipped",
        )
        return None, n_nt

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
    return out, n_nt


def main() -> int:
    args = parse_args()

    df = pd.read_csv(args.input, sep="\t")

    required = {"aaSeqCDR3", "nSeqCDR3"}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    result, n_nt = process_sample(df, args.chain, args.nMin)

    args.output.parent.mkdir(parents=True, exist_ok=True)

    # Always write the per-sample status sidecar so the output exists
    # regardless of input quality. The model reads `nUniqueNt` (vs `nMin`)
    # per sample to distinguish "below nMin" (adjustable) from "no usable
    # CDR3" (nUniqueNt == 0) in the skipped-samples warning.
    if args.status_json is not None:
        args.status_json.parent.mkdir(parents=True, exist_ok=True)
        args.status_json.write_text(
            json.dumps({"nUniqueNt": n_nt, "nMin": args.nMin})
        )

    if result is None:
        # Below nMin — emit a header-only TSV and exit 0 so the downstream
        # pipeline (threshold + xsv.importFile) produces empty PColumns
        # rather than aborting. The model surfaces the skip via the status
        # sidecar; the empty rows drop the sample from the assembled output.
        empty = pd.DataFrame(
            columns=list(df.columns) + ["multiplicity", "neighbours", "Nb_freq"]
        )
        empty.to_csv(args.output, sep="\t", index=False)
        print(
            f"[chain {args.chain}] unique nt CDR3 ({n_nt}) below nMin "
            f"({args.nMin}); emitting empty output"
        )
        return 0

    result.to_csv(args.output, sep="\t", index=False)

    # Intentionally NO wall-clock log line here: this exec is cache-pinned
    # (cache key omits threshold), so stdout content must be
    # deterministic across re-runs with identical inputs. A wall-clock
    # elapsed value would mutate the captured stdout-stream resource and
    # break the cache (CID conflict when threshold-only changes attempt to
    # reuse this slot).
    print(f"[chain {args.chain}] compute-neighbours done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
