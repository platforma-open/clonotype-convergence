"""M1 — full-STAR reproduces STAR's output_MC reference end-to-end.

Reference: statbiophys/STAR, run of Pipeline.ipynb on data_test/Test.tsv,
committed as output/df_read_test.tsv (mirrored here as
data/star_df_read_test_golden.tsv). It carries, per unique aa CDR3, the
Neighbours count, the OLGA Pgen, STAR's Pvalue, and the full-STAR hit call.

The harness supplies the same Pgen values STAR's get_pgen would
compute (we read them straight from the golden file), so ONLY the output_MC
step — Lambda -> capped Poisson tail -> Benjamini-Hochberg at alpha=0.005 —
is under test. uniq_nucl is the unique-nt-CDR3 count of Test.tsv (== the
nUniqueNt compute_neighbours writes to status.json in the workflow).

Run:  cd software && python -m pytest test/test_full_star_m1.py
"""

import subprocess
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
SRC = HERE.parent / "src"
DATA = HERE / "data"
GOLDEN = DATA / "star_df_read_test_golden.tsv"
STAR_INPUT = DATA / "star_Test.tsv"
ALPHA = 0.005


def _uniq_nucl() -> int:
    """Replicates get_df.multiplicity's unique-nt count on STAR's Test.tsv."""
    raw = pd.read_csv(STAR_INPUT, sep="\t")
    return int(raw["nSeqCDR3"].nunique())


def _run_full_star(tmp_path: Path, uniq_nucl: int) -> pd.DataFrame:
    golden = pd.read_csv(GOLDEN, sep="\t")
    # Feed only what output_MC consumes; Pgen is taken from the golden file
    # (== what STAR's get_pgen produced), so only output_MC is under test.
    inp = tmp_path / "full_star_in.tsv"
    golden[["aaSeqCDR3", "Neighbours", "Pgen"]].to_csv(inp, sep="\t", index=False)
    out = tmp_path / "full_star_out.tsv"
    subprocess.run(
        [
            sys.executable, str(SRC / "full_star.py"),
            "--input", str(inp),
            "--output", str(out),
            "--alpha", str(ALPHA),
            "--chain", "IGHeavy",
            "--uniq-nucl", str(uniq_nucl),
            "--neighbours-column", "Neighbours",
            "--pgen-column", "Pgen",
        ],
        cwd=str(SRC),  # so `from output_MC import Output_MC` resolves
        check=True,
    )
    return pd.read_csv(out, sep="\t")


def test_m1_pvalue_matches_star(tmp_path):
    golden = pd.read_csv(GOLDEN, sep="\t")
    result = _run_full_star(tmp_path, _uniq_nucl())
    # Row order is preserved, so compare positionally.
    rel = ((result["Pvalue"] - golden["Pvalue"]).abs() / golden["Pvalue"].abs())
    assert rel.max() < 1e-9, f"max relative Pvalue error {rel.max():.2e}"


def test_m1_hit_set_matches_star(tmp_path):
    golden = pd.read_csv(GOLDEN, sep="\t")
    result = _run_full_star(tmp_path, _uniq_nucl())
    got_hit = result["starHit"].eq("Hit").to_numpy()
    want_hit = golden["full-STAR"].astype(str).str.lower().eq("true").to_numpy()
    assert got_hit.sum() == want_hit.sum() == 25, (
        f"hit count got={got_hit.sum()} want={want_hit.sum()} (golden 25)"
    )
    assert (got_hit == want_hit).all(), "full-STAR hit set differs from STAR reference"
