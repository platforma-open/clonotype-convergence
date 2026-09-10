"""Phase-B software behaviours the workflow relies on, verified standalone.

1. full_star.py derives uniq_nucl from the nSeqCDR3 column (the workflow path,
   which avoids threading status.json as a file) and matches passing it
   explicitly.
2. cluster_filter.py is method-agnostic — it refines whichever hit column it is
   pointed at (--hit-column) and writes the pair of output columns it is told to
   (--filtered-column / --size-column), so the workflow can run it once per
   emitted mode without the second run clobbering the first.

Run:  cd software && python -m pytest test/test_workflow_mode.py
"""

import subprocess
import sys
from pathlib import Path

import pandas as pd

SRC = Path(__file__).parent.parent / "src"


def _run(script, args, cwd=SRC):
    subprocess.run([sys.executable, str(SRC / script), *args], cwd=str(cwd), check=True)


def test_uniq_nucl_derived_matches_explicit(tmp_path):
    # 5 clones, 4 distinct nt CDR3 (one synonymous pair) -> uniq_nucl == 4.
    df = pd.DataFrame({
        "clonotypeKey": ["k1", "k2", "k3", "k4", "k5"],
        "aaSeqCDR3": ["CARDYW", "CARDYW", "CARGYW", "CARWYW", "CARFYW"],
        "nSeqCDR3": ["TGTA", "TGTC", "TGTG", "TGTT", "TGTT"],  # TGTT repeats -> 4 unique
        "neighbours": [30, 21, 2, 1, 0],
        "Pgen": [1e-19, 6e-20, 1e-10, 5e-9, 2e-8],
    })
    inp = tmp_path / "in.tsv"
    df.to_csv(inp, sep="\t", index=False)

    derived = tmp_path / "derived.tsv"
    explicit = tmp_path / "explicit.tsv"
    common = ["--alpha", "0.005", "--chain", "IGHeavy",
              "--neighbours-column", "neighbours", "--pgen-column", "Pgen"]
    _run("full_star.py", ["--input", str(inp), "--output", str(derived), *common])
    _run("full_star.py", ["--input", str(inp), "--output", str(explicit),
                          "--uniq-nucl", "4", *common])

    d = pd.read_csv(derived, sep="\t")
    e = pd.read_csv(explicit, sep="\t")
    assert d["Pvalue"].fillna(-1).tolist() == e["Pvalue"].fillna(-1).tolist()
    assert d["starHit"].tolist() == e["starHit"].tolist()


def test_cluster_filter_method_agnostic(tmp_path):
    # 4 hits forming one Levenshtein-1 cluster (CARDYW/CARDYY/CARDYF/CARDYS all
    # within 1 aa of CARDYW) + 1 lone hit + 1 non-hit. cluster-min=3 keeps the
    # 4-member cluster, drops the singleton.
    df = pd.DataFrame({
        "aaSeqCDR3": ["CARDYW", "CARDYY", "CARDYF", "CARDYS", "CWWWWW", "CGGGGG"],
        "starHit":   ["Hit",    "Hit",    "Hit",    "Hit",    "Hit",    "Not hit"],
    })
    inp = tmp_path / "called.tsv"
    out = tmp_path / "out.tsv"
    df.to_csv(inp, sep="\t", index=False)
    _run("cluster_filter.py", ["--input", str(inp), "--output", str(out),
                               "--cluster-min", "3", "--chain", "IGHeavy",
                               "--hit-column", "starHit",
                               "--filtered-column", "starClusterFiltered",
                               "--size-column", "starClusterSize"])
    r = pd.read_csv(out, sep="\t")
    assert "starClusterFiltered" in r.columns and "starClusterSize" in r.columns
    filt = dict(zip(r["aaSeqCDR3"], r["starClusterFiltered"]))
    # 4-member cluster survives; singleton hit and the non-hit do not.
    assert filt["CARDYW"] == "Hit" and filt["CARDYS"] == "Hit"
    assert filt["CWWWWW"] == "Not hit" and filt["CGGGGG"] == "Not hit"
    size = dict(zip(r["aaSeqCDR3"], r["starClusterSize"]))
    assert size["CARDYW"] == 4


def test_cluster_filter_runs_per_mode_without_clobbering(tmp_path):
    """The two modes' invocations chain, and each owns its own column pair.

    This is the reason the output names are parameters: clusters are computed
    over the HIT SUBSET, so the same clone can sit in a 4-member cluster of
    fast-STAR hits and a 2-member cluster of full-STAR hits. A shared column
    name would have the second run silently overwrite the first's answer.
    """
    df = pd.DataFrame({
        "aaSeqCDR3": ["CARDYW", "CARDYY", "CARDYF", "CARDYS"],
        # fast-STAR calls all four; full-STAR only the first two.
        "fastStar":  ["Hit",    "Hit",    "Hit",    "Hit"],
        "fullStar":  ["Hit",    "Hit",    "Not hit", "Not hit"],
    })
    inp = tmp_path / "called.tsv"
    mid = tmp_path / "mid.tsv"
    out = tmp_path / "out.tsv"
    df.to_csv(inp, sep="\t", index=False)
    _run("cluster_filter.py", ["--input", str(inp), "--output", str(mid),
                               "--cluster-min", "2", "--chain", "IGHeavy",
                               "--hit-column", "fastStar",
                               "--filtered-column", "fastStarClusterFiltered",
                               "--size-column", "fastStarClusterSize"])
    _run("cluster_filter.py", ["--input", str(mid), "--output", str(out),
                               "--cluster-min", "2", "--chain", "IGHeavy",
                               "--hit-column", "fullStar",
                               "--filtered-column", "fullStarClusterFiltered",
                               "--size-column", "fullStarClusterSize"])
    r = pd.read_csv(out, sep="\t").set_index("aaSeqCDR3")
    # Both pairs survive the chaining.
    for col in ("fastStarClusterFiltered", "fastStarClusterSize",
                "fullStarClusterFiltered", "fullStarClusterSize"):
        assert col in r.columns, col
    # Different hit sets → different cluster structures → different sizes.
    assert r.loc["CARDYW", "fastStarClusterSize"] == 4
    assert r.loc["CARDYW", "fullStarClusterSize"] == 2
    # full-STAR's filtered column is a strict subset of ITS OWN hit set.
    assert r.loc["CARDYF", "fastStarClusterFiltered"] == "Hit"
    assert r.loc["CARDYF", "fullStarClusterFiltered"] == "Not hit"
