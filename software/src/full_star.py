"""Stage 2 (full-STAR) — FDR-controlled convergence hit call.

Wraps statbiophys/STAR's Output_MC (vendored to ./output_MC.py). This is
the block's PRIMARY hit call in v2, used whenever a per-clonotype
generation probability (Pgen) is available; the fast-STAR threshold
(per-sample-neighbours Stage 2) is the fallback when it is not.

Runs AFTER compute_neighbours (Stage 1), which stays untouched — full-STAR
plugs into the hit-calling stage only (the counting/calling seam). One
sample per invocation (the per-sample fan-out slices by sampleId upstream).

CLI:
    full_star.py
        --input <tsv>          # Stage 1 output for ONE sample, joined with
                               #   the per-clone Pgen column
        --output <tsv>
        --alpha <float>        # BH FDR target (STAR default 0.005)
        --chain <str>
        [--uniq-nucl <int> | --status-json <path>]  # unique nt CDR3 count;
                               #   if neither given, derived from the input's
                               #   nucleotide-CDR3 column (--uniq-nucl-column)
        [--neighbours-column neighbours]
        [--pgen-column Pgen]
        [--uniq-nucl-column nSeqCDR3]

Input TSV must contain: aaSeqCDR3, <neighbours-column>, <pgen-column>; any
other columns pass through. ``uniq_nucl`` is the sample's unique-nt-CDR3
count. In the workflow it is derived from the input's <uniq-nucl-column>
(the compute_neighbours output already carries the cleaned nSeqCDR3, whose
distinct count == the nUniqueNt in status.json), so compute_neighbours stays
byte-identical (cache preserved). --uniq-nucl / --status-json remain for
standalone / M1 use.

Output TSV = the input TSV with two columns appended:
    Pvalue   — the raw Poisson-tail p-value from output_MC. The block derives
               starScore = -log10(Pvalue) downstream (kept raw here for
               reference fidelity and so the transform is visible in the
               workflow).
    starHit  — "Hit" / "Not hit" (Benjamini-Hochberg selection at alpha).

Clones with a null/NA Pgen cannot be tested (no null model): they are
EXCLUDED from the BH set (do not count toward m) and emitted "Not hit". An
empty input (a skipped sample) yields a header-only output with the two
columns appended.

Structured stdout, one event per line, prefixed ``[chain <chain>]``. The
sample identity is supplied by the workflow (the result is keyed by the real
sampleId), so logs intentionally carry no sampleId.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from output_MC import Output_MC


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--alpha", required=True, type=float)
    parser.add_argument("--chain", required=True)
    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument("--uniq-nucl", type=int, dest="uniq_nucl")
    group.add_argument("--status-json", type=Path, dest="status_json")
    parser.add_argument("--neighbours-column", default="neighbours", dest="neighbours_column")
    parser.add_argument("--pgen-column", default="Pgen", dest="pgen_column")
    parser.add_argument("--uniq-nucl-column", default="nSeqCDR3", dest="uniq_nucl_column")
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}")


def resolve_uniq_nucl(args: argparse.Namespace, df: pd.DataFrame) -> int:
    if args.uniq_nucl is not None:
        return args.uniq_nucl
    if args.status_json is not None:
        status = json.loads(args.status_json.read_text())
        return int(status["nUniqueNt"])
    # Derive from the cleaned nucleotide-CDR3 column (matches get_df's n_un:
    # unique nt CDR3 count after null/empty drops, which compute_neighbours
    # already applied before writing this TSV).
    col = args.uniq_nucl_column
    if col not in df.columns:
        raise SystemExit(
            f"error: cannot derive uniq_nucl — column '{col}' absent and neither "
            "--uniq-nucl nor --status-json given"
        )
    s = df[col]
    s = s[s.notna() & (s.astype(str) != "")]
    return int(s.nunique())


def bh_hit_mask(pvalues: np.ndarray, alpha: float) -> np.ndarray:
    """BH first-crossing selection — identical rule to Output_MC.BH_procedure,
    but returns a boolean mask in the INPUT order (selection by row position,
    not by aaSeqCDR3 membership) so it stays correct when the same aa CDR3
    appears as several nt clonotypes.

    Hits are the k lowest-p rows, where k is the smallest 1-based rank with
    ``p_sorted[k] > (k/m)*alpha``; k defaults to m (all hits) when the line is
    never crossed. Stable sort makes the tie-break deterministic (canonical),
    unlike upstream's quicksort.
    """
    m = len(pvalues)
    if m == 0:
        return np.zeros(0, dtype=bool)
    order = np.argsort(pvalues, kind="stable")
    sorted_p = pvalues[order]
    # 1-based ranks: reject the first (rank-1) rows at the smallest rank whose
    # p_(rank) exceeds (rank/m)*alpha; default to m (all) if the line is never
    # crossed. rank starts at 1 so the smallest p is tested against its own
    # threshold — otherwise a set where even p_(1) fails BH would still force
    # order[:1] to Hit.
    k = m
    for rank in range(1, m + 1):
        if sorted_p[rank - 1] > (rank / m) * alpha:
            k = rank - 1
            break
    mask = np.zeros(m, dtype=bool)
    mask[order[:k]] = True
    return mask


def main() -> int:
    args = parse_args()
    prefix = f"[chain {args.chain}]"

    df = pd.read_csv(args.input, sep="\t")
    required = {"aaSeqCDR3", args.neighbours_column, args.pgen_column}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    uniq_nucl = resolve_uniq_nucl(args, df)
    log(prefix, f"input rows: {len(df)}")
    log(prefix, f"uniq_nucl (unique nt CDR3): {uniq_nucl}")
    log(prefix, f"alpha (FDR target): {args.alpha}")

    args.output.parent.mkdir(parents=True, exist_ok=True)

    # Default columns for every row; overwritten for the testable subset below.
    df["Pvalue"] = np.nan
    df["starHit"] = "Not hit"

    if len(df) == 0:
        # Skipped sample — header-only passthrough, columns appended.
        df.to_csv(args.output, sep="\t", index=False)
        log(prefix, "empty input; emitting empty output")
        return 0

    # Testable = has a null model (Pgen present) AND a neighbour count. Pgen is
    # allowNA upstream (OLGA could not compute it for some clonotypes); such
    # clones cannot be tested, so they are excluded from BH (m) and stay
    # "Not hit".
    neigh = pd.to_numeric(df[args.neighbours_column], errors="coerce")
    pgen = pd.to_numeric(df[args.pgen_column], errors="coerce")
    testable = neigh.notna() & pgen.notna() & (pgen > 0)
    n_test = int(testable.sum())
    n_skip = len(df) - n_test
    if n_skip > 0:
        log(prefix, f"{n_skip} clones without usable Pgen — excluded from the test, marked Not hit")

    if n_test == 0:
        df.to_csv(args.output, sep="\t", index=False)
        log(prefix, "no testable clones (no Pgen); all Not hit")
        return 0

    # Build the frame Output_MC expects: aaSeqCDR3, Neighbours, Pgen. Preserve
    # input row order via a positional id so results map back regardless of
    # BH's internal sort.
    sub = pd.DataFrame(
        {
            "_row": np.arange(len(df))[testable.to_numpy()],
            "aaSeqCDR3": df.loc[testable, "aaSeqCDR3"].to_numpy(),
            "Neighbours": neigh[testable].to_numpy(),
            "Pgen": pgen[testable].to_numpy(),
        }
    )

    mc = Output_MC(sub)
    mc.get_pvalue(uniq_nucl)  # populates sub["Pvalue"] in place, order preserved
    pvals = sub["Pvalue"].to_numpy(dtype=float)
    hits = bh_hit_mask(pvals, args.alpha)

    # Scatter p-value and hit call back to the original rows.
    rows = sub["_row"].to_numpy()
    df.loc[df.index[rows], "Pvalue"] = pvals
    df.loc[df.index[rows[hits]], "starHit"] = "Hit"

    log(prefix, f"tested {n_test} clones; {int(hits.sum())} full-STAR hits at alpha={args.alpha}")
    df.to_csv(args.output, sep="\t", index=False)
    log(prefix, "full-STAR done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
