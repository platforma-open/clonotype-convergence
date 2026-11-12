"""One neighbour pass gives every compartment's count exactly.

Per-isotype scores used to run Get_df once per kept isotype X, over a table
of the scored aa CDR3s plus X's, with X's multiplicity and 0 elsewhere. Stage 1
now sums each compartment's multiplicity over the same neighbours as the
whole-sample count. The old count was `neighbours + 1`; the new one is the
raw sum, so the two must agree integer for integer.

Run:  cd software && python -m pytest test/test_compartment_neighbours.py
"""

import json
import random
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

SRC = Path(__file__).parent.parent / "src"
DATA = Path(__file__).parent / "data"
sys.path.insert(0, str(SRC))

from get_df import Get_df  # noqa: E402

ISOTYPES = ["IgM", "IgG", "IgA"]


@pytest.fixture(scope="module")
def clones():
    df = pd.read_csv(DATA / "star_Test.tsv", sep="\t")
    df = df[df["aaSeqCDR3"].notna() & df["nSeqCDR3"].notna()]
    rng = random.Random(7058)
    df = df.assign(isotype=[rng.choice(ISOTYPES) for _ in range(len(df))])
    return df


def per_aa(df):
    return df.groupby("aaSeqCDR3", sort=False)["nSeqCDR3"].nunique().reset_index(name="multiplicity")


def with_compartments(clones):
    table = per_aa(clones)
    for i, iso in enumerate(ISOTYPES):
        mult = per_aa(clones[clones["isotype"] == iso]).rename(columns={"multiplicity": f"mult_iso{i}"})
        table = table.merge(mult, on="aaSeqCDR3", how="left")
        table[f"mult_iso{i}"] = table[f"mult_iso{i}"].fillna(0).astype(int)
    return table


def old_counts(clones, iso):
    """The removed Stage 5 input and step: scored aa at 0, X's aa at its count."""
    query_aa = pd.DataFrame({"aaSeqCDR3": clones["aaSeqCDR3"].unique()})
    mult_x = per_aa(clones[clones["isotype"] == iso])
    comp = query_aa.merge(mult_x, on="aaSeqCDR3", how="outer")
    comp["multiplicity"] = comp["multiplicity"].fillna(0).astype(int)
    stats = Get_df(comp).make().set_index("aaSeqCDR3")
    return stats["Neighbours"] + 1, int(comp["multiplicity"].sum())


def test_one_pass_matches_per_compartment_runs(clones):
    table = with_compartments(clones)
    stats = Get_df(table).make({f"nbSum_iso{i}": f"mult_iso{i}" for i in range(len(ISOTYPES))})
    stats = stats.set_index("aaSeqCDR3")
    for i, iso in enumerate(ISOTYPES):
        expected, n_x = old_counts(clones, iso)
        got = stats[f"nbSum_iso{i}"]
        assert got.sort_index().tolist() == expected.loc[got.index].sort_index().tolist(), iso
        assert int(table[f"mult_iso{i}"].sum()) == n_x, iso


def test_whole_sample_count_is_unchanged(clones):
    table = with_compartments(clones)
    plain = Get_df(table[["aaSeqCDR3", "multiplicity"]]).make()
    multi = Get_df(table).make({"nbSum_iso0": "mult_iso0"})
    pd.testing.assert_frame_equal(plain, multi[plain.columns])


def run_cli(tmp_path, table, n_min):
    table.to_csv(tmp_path / "per_aa.tsv", sep="\t", index=False)
    args = [sys.executable, str(SRC / "compute_neighbours.py"),
            "--input", str(tmp_path / "per_aa.tsv"), "--output", str(tmp_path / "out.tsv"),
            "--nMin", str(n_min), "--chain", "IGH", "--status-json", str(tmp_path / "status.json")]
    for i, iso in enumerate(ISOTYPES):
        args += ["--compartment", f"iso{i}={iso}"]
    subprocess.run(args, check=True, cwd=SRC, capture_output=True)
    out = pd.read_csv(tmp_path / "out.tsv", sep="\t", dtype=str, keep_default_na=False)
    status = {i: json.loads((tmp_path / f"status_iso{i}.json").read_text()) for i in range(len(ISOTYPES))}
    return out, status


def test_compartment_below_nmin_is_empty(clones, tmp_path):
    table = with_compartments(clones)
    sizes = [int(table[f"mult_iso{i}"].sum()) for i in range(len(ISOTYPES))]
    n_min = sorted(sizes)[1]  # the smallest compartment falls below it
    small = sizes.index(min(sizes))
    out, status = run_cli(tmp_path, table, n_min)
    assert len(out) == len(table)
    for i in range(len(ISOTYPES)):
        assert status[i] == {"nUniqueNt": sizes[i], "nMin": n_min}
        values = set(out[f"nbSum_iso{i}"])
        if i == small:
            assert values == {""}
        else:
            assert "" not in values and all(v.isdigit() for v in values)


def test_sample_below_nmin_still_writes_compartment_status(clones, tmp_path):
    table = with_compartments(clones)
    n_min = int(table["multiplicity"].sum()) + 1
    out, status = run_cli(tmp_path, table, n_min)
    assert len(out) == 0
    assert list(out.columns) == ["aaSeqCDR3", "multiplicity", "neighbours", "Nb_freq"] + [
        c for i in range(len(ISOTYPES)) for c in (f"mult_iso{i}", f"nbSum_iso{i}")]
    for i in range(len(ISOTYPES)):
        assert status[i]["nUniqueNt"] == int(table[f"mult_iso{i}"].sum())
