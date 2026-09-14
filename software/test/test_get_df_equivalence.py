"""Get_df still reproduces the paper's reference after the per-aa rewrite.

MILAB-6650 moved the multiplicity collapse and the fan-back-out to
per-clonotype rows out of pandas and into ptabler, so Get_df now takes a
PER-AA table (aaSeqCDR3 + multiplicity) instead of the per-clonotype table.
The statistic must be untouched by that.

`data/star_Test.tsv` is STAR's own test input (500 clonotype rows) and
`data/star_df_read_test_golden.tsv` is the per-aa reference it produces, so
these assertions pin the rewrite to the published numbers rather than to a
snapshot of our own code.

The collapse here is the pandas equivalent of the ptabler step in
workflow/src/per-sample-neighbours.tpl.tengo:

    filter(aa/nt not null and not "")
      .groupBy(aaSeqCDR3)
      .agg(nSeqCDR3.nUnique() as multiplicity)

Run:  cd software && python -m pytest test/test_get_df_equivalence.py
"""

import sys
from pathlib import Path

import pandas as pd
import pytest

SRC = Path(__file__).parent.parent / "src"
DATA = Path(__file__).parent / "data"
sys.path.insert(0, str(SRC))

from get_df import Get_df  # noqa: E402

STAR_INPUT = DATA / "star_Test.tsv"
GOLDEN = DATA / "star_df_read_test_golden.tsv"


def collapse_to_per_aa(df: pd.DataFrame) -> pd.DataFrame:
    """What the ptabler step hands compute_neighbours.py."""
    usable = df[df["aaSeqCDR3"].notna() & df["nSeqCDR3"].notna()]
    usable = usable[(usable["aaSeqCDR3"] != "") & (usable["nSeqCDR3"] != "")]
    return (
        usable.groupby("aaSeqCDR3", sort=False)["nSeqCDR3"]
        .nunique()
        .reset_index(name="multiplicity")
    )


@pytest.fixture(scope="module")
def computed():
    per_aa = collapse_to_per_aa(pd.read_csv(STAR_INPUT, sep="\t"))
    return Get_df(per_aa).make().set_index("aaSeqCDR3")


@pytest.fixture(scope="module")
def golden():
    return pd.read_csv(GOLDEN, sep="\t").set_index("aaSeqCDR3")


def test_covers_the_same_aa_cdr3s(computed, golden):
    assert set(computed.index) == set(golden.index)


def test_multiplicity_matches_golden(computed, golden):
    aligned = computed.reindex(golden.index)
    pd.testing.assert_series_equal(
        aligned["Multiplicity"].astype(int),
        golden["Multiplicity"].astype(int),
        check_names=False,
    )


def test_neighbours_match_golden(computed, golden):
    aligned = computed.reindex(golden.index)
    pd.testing.assert_series_equal(
        aligned["Neighbours"].astype(int),
        golden["Neighbours"].astype(int),
        check_names=False,
    )


def test_nb_freq_matches_golden(computed, golden):
    aligned = computed.reindex(golden.index)
    pd.testing.assert_series_equal(
        aligned["Nb_freq"].astype(float),
        golden["Nb_freq"].astype(float),
        check_names=False,
    )


def test_normaliser_is_the_unique_nt_count(computed):
    """Nb_freq's denominator is N, the sample's unique nt CDR3 count — which
    after the rewrite is the sum of the multiplicity column, not a separately
    computed value. Recover it from the golden ratio and check it agrees."""
    raw = pd.read_csv(STAR_INPUT, sep="\t")
    n_nt = raw["nSeqCDR3"].nunique()
    assert int(computed["Multiplicity"].sum()) == n_nt

    nonzero = computed[computed["Neighbours"] != 0].iloc[0]
    assert nonzero["Neighbours"] / nonzero["Nb_freq"] == pytest.approx(n_nt)


def test_empty_input_is_handled():
    empty = pd.DataFrame({"aaSeqCDR3": [], "multiplicity": []})
    out = Get_df(empty).make()
    assert list(out.columns) == ["aaSeqCDR3", "Multiplicity", "Neighbours", "Nb_freq"]
    assert len(out) == 0
