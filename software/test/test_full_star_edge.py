"""full_star.py edge cases (MILAB-6650): Pgen==0 inclusion (1d) and the
-log10 score floor that keeps the strongest / underflowed clones finite (1a).

Pgen==0 is a *valid* null (Lambda=0 -> rate a=0.2 via the pseudocount), so those
clones must be TESTED, not dropped; and the emitted fullStarScore must be finite
even when the Poisson tail underflows to Pvalue==0.0. Only Pgen==NaN (OLGA could
not compute) is untestable.

Run:  cd software && python -m pytest test/test_full_star_edge.py
"""

import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
SRC = HERE.parent / "src"
UNIQ_NUCL = 1000
ALPHA = 0.005

# All length 15; distinct sequences so rows stay separate.
A = "CARDYWGQGTLVTVW"  # Pgen == 0        -> tested, tail underflows to 0.0
B = "CARDYWGQGTLVTVY"  # strong, positive p
C = "CARDYWGQGTLVTVF"  # weak -> Not hit
D = "CARDYWGQGTLVTVL"  # Pgen missing (NaN) -> untestable
ROWS = [
    {"aaSeqCDR3": A, "Neighbours": 300, "Pgen": 0.0},  # tail underflows to exactly 0.0
    {"aaSeqCDR3": B, "Neighbours": 10, "Pgen": 1e-6},
    {"aaSeqCDR3": C, "Neighbours": 2, "Pgen": 1e-2},
    {"aaSeqCDR3": D, "Neighbours": 10, "Pgen": ""},
]


def _run(tmp_path):
    inp = tmp_path / "in.tsv"
    pd.DataFrame(ROWS).to_csv(inp, sep="\t", index=False)
    out = tmp_path / "out.tsv"
    subprocess.run(
        [
            sys.executable, str(SRC / "full_star.py"),
            "--input", str(inp),
            "--output", str(out),
            "--alpha", str(ALPHA),
            "--chain", "IGHeavy",
            "--uniq-nucl", str(UNIQ_NUCL),
            "--neighbours-column", "Neighbours",
            "--pgen-column", "Pgen",
        ],
        cwd=str(SRC),  # so `from output_MC import Output_MC` resolves
        check=True,
    )
    return pd.read_csv(out, sep="\t").set_index("aaSeqCDR3")


def test_pgen_zero_is_tested_not_dropped(tmp_path):
    """1d: a Pgen==0 clone with neighbours is tested and called a hit."""
    res = _run(tmp_path)
    a = res.loc[A]
    assert pd.notna(a["Pvalue"]), "Pgen==0 clone must be tested (Pvalue assigned)"
    assert float(a["Pvalue"]) == 0.0, "expected the underflow path (Pvalue==0.0)"
    assert a["starHit"] == "Hit", "Pgen==0 clone with many neighbours must be a hit"


def test_scores_finite_despite_underflow(tmp_path):
    """1a: every tested clone gets a finite fullStarScore even when Pvalue==0."""
    res = _run(tmp_path)
    tested = res[res["Pvalue"].notna()]
    assert len(tested) == 3, "A, B, C tested; D (NaN Pgen) excluded"
    scores = tested["fullStarScore"].to_numpy(dtype=float)
    assert np.isfinite(scores).all(), f"non-finite fullStarScore: {scores}"
    # The underflowed clone ranks at the top (tied at the sample's max finite score).
    assert res.loc[A, "fullStarScore"] == res["fullStarScore"].max()


def test_missing_pgen_stays_untestable(tmp_path):
    """NaN Pgen (OLGA could not compute) → null score, Not hit."""
    res = _run(tmp_path)
    d = res.loc[D]
    assert pd.isna(d["Pvalue"])
    assert pd.isna(d["fullStarScore"])
    assert d["starHit"] == "Not hit"


# --- the output schema must not depend on the data (early-return paths) ------
# The workflow vertically concatenates the per-sample outputs and then projects
# `fullStarScore`. A sample that returns early without emitting that column
# fails the concat with ColumnNotFoundError and takes every other sample's
# result down with it, so the column set must be identical on every path.

EXPECTED_APPENDED = ["Pvalue", "starHit", "fullStarScore"]


def _run_rows(tmp_path, rows, tag):
    inp = tmp_path / f"{tag}_in.tsv"
    pd.DataFrame(rows, columns=["aaSeqCDR3", "Neighbours", "Pgen"]).to_csv(
        inp, sep="\t", index=False
    )
    out = tmp_path / f"{tag}_out.tsv"
    subprocess.run(
        [
            sys.executable, str(SRC / "full_star.py"),
            "--input", str(inp),
            "--output", str(out),
            "--alpha", str(ALPHA),
            "--chain", "IGHeavy",
            "--uniq-nucl", str(UNIQ_NUCL),
            "--neighbours-column", "Neighbours",
            "--pgen-column", "Pgen",
        ],
        cwd=str(SRC),
        check=True,
    )
    return pd.read_csv(out, sep="\t")


def test_empty_sample_still_emits_the_full_column_set(tmp_path):
    # A sample skipped upstream (below nMin, or no usable CDR3) arrives empty.
    df = _run_rows(tmp_path, [], "empty")
    assert len(df) == 0
    for col in EXPECTED_APPENDED:
        assert col in df.columns, f"{col} missing on the empty-input path"


def test_sample_without_testable_clones_still_emits_the_full_column_set(tmp_path):
    # Every clone has a missing Pgen (OLGA produced nothing for this sample):
    # nothing is testable, but the schema must still match the tested path.
    rows = [
        {"aaSeqCDR3": A, "Neighbours": 10, "Pgen": ""},
        {"aaSeqCDR3": B, "Neighbours": 3, "Pgen": ""},
    ]
    df = _run_rows(tmp_path, rows, "untestable")
    assert len(df) == 2
    for col in EXPECTED_APPENDED:
        assert col in df.columns, f"{col} missing on the no-testable-clones path"
    assert df["fullStarScore"].isna().all()
    assert (df["starHit"] == "Not hit").all()
