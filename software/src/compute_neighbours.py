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

Input TSV is ONE sample's PER-AA table: `aaSeqCDR3` (unique) and
`multiplicity` (distinct nt CDR3s collapsed into that aa CDR3). The
collapse, the null/empty CDR3 drop, and the fan-back-out to per-clonotype
rows all happen in ptabler around this step — see
workflow/src/per-sample-neighbours.tpl.tengo. This step therefore never sees
an nt CDR3 or a clonotype key, and its memory scales with the sample's
unique aa CDR3 count rather than its clonotype count.

Output TSV is one row per unique aa CDR3:
    aaSeqCDR3     — the key the workflow joins back on
    multiplicity  — nt-CDR3 count per aa CDR3 (passed through)
    neighbours    — multiplicity-weighted Hamming-1 neighbour count
    Nb_freq       — neighbours / N_nt (continuous density)

`--status-json` writes `{"nUniqueNt": <int>, "nMin": <int>}` — the
unique-nt-CDR3 count for this sample (the sum of the multiplicity column,
which the collapse computed over non-null CDR3s) and the floor in effect.
The model reads it per sample to decide the skipped-samples warning; it
exists even when the sample is skipped and the output TSV is empty.

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

OUTPUT_COLUMNS = ["aaSeqCDR3", "multiplicity", "neighbours", "Nb_freq"]


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


def process_sample(per_aa: pd.DataFrame, chain: str, n_min: int):
    """Run Get_df on this sample's per-aa table. Returns ``(stats_or_None,
    n_nt)`` — the frame is None when the sample's unique-nt-CDR3 count is
    below the nMin floor; ``n_nt`` is always reported so the caller can write
    the status sidecar regardless of the skip decision."""
    prefix = f"[chain {chain}]"

    n_aa = len(per_aa)
    n_nt = int(per_aa["multiplicity"].astype(int).sum()) if n_aa else 0
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

    stats = Get_df(per_aa).make().rename(
        columns={
            "Multiplicity": "multiplicity",
            "Neighbours": "neighbours",
            "Nb_freq": "Nb_freq",
        }
    )[OUTPUT_COLUMNS]
    log(prefix, f"output rows: {len(stats)}")
    return stats, n_nt


def main() -> int:
    args = parse_args()

    per_aa = pd.read_csv(args.input, sep="\t")

    required = {"aaSeqCDR3", "multiplicity"}
    missing = required - set(per_aa.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    result, n_nt = process_sample(per_aa, args.chain, args.nMin)

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
        # Below nMin — emit a header-only TSV and exit 0. The workflow joins
        # this onto the clonotype rows with an INNER join, so an empty stats
        # table yields an empty neighbours.tsv, which is what drops the sample
        # from the assembled output. The model surfaces the skip via the
        # status sidecar.
        pd.DataFrame(columns=OUTPUT_COLUMNS).to_csv(args.output, sep="\t", index=False)
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
