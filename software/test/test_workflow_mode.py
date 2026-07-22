"""Phase-B software behaviours the workflow relies on, verified standalone.

1. full_star.py derives uniq_nucl from the nSeqCDR3 column (the workflow path,
   which avoids threading status.json as a file) and matches passing it
   explicitly.
2. cluster_filter.py is method-agnostic — it refines whatever `starHit`=="Hit"
   set exists (full- or fast-STAR) via --hit-column, emitting
   starHitClusterFiltered + clusterSize.

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
                               "--hit-column", "starHit"])
    r = pd.read_csv(out, sep="\t")
    assert "starHitClusterFiltered" in r.columns and "clusterSize" in r.columns
    filt = dict(zip(r["aaSeqCDR3"], r["starHitClusterFiltered"]))
    # 4-member cluster survives; singleton hit and the non-hit do not.
    assert filt["CARDYW"] == "Hit" and filt["CARDYS"] == "Hit"
    assert filt["CWWWWW"] == "Not hit" and filt["CGGGGG"] == "Not hit"
    size = dict(zip(r["aaSeqCDR3"], r["clusterSize"]))
    assert size["CARDYW"] == 4
