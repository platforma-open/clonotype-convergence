"""Unit tests for the clonotype-only aggregation engine (aggregate.py, A-0011 v1.1).

Synthetic per-sample tables with hand-computable expectations exercise each
rule: the reproducibility-aware starScore blend (w·pct(peak) + (1−w)·pct(support),
percentile-ranked across clonotypes; pct(peak) alone without a grouping), the
weight extremes (w=1 strength-only, w=0 support-only), full-STAR BH / fast-STAR
threshold hit calls, k>=2 replicability, the expected-sample eligibility filter,
and that `support` is NOT an exported column.

Run:  cd software && python -m pytest test/test_aggregate.py
"""

import subprocess
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
SRC = HERE.parent / "src"


def run_aggregate(tmp_path, rows, *, method="full-STAR", extra=None, metadata=None, tag="run"):
    """Write `rows` to a per-sample TSV, run aggregate.py, and return
    (dict keyed by clonotypeKey, list of output columns)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    inp = tmp_path / f"{tag}_in.tsv"
    pd.DataFrame(rows).to_csv(inp, sep="\t", index=False)
    out = tmp_path / f"{tag}_out.tsv"
    cmd = [
        sys.executable, str(SRC / "aggregate.py"),
        "--input", str(inp), "--output", str(out),
        "--chain", "IGHeavy", "--method", method, "--alpha", "0.005",
    ]
    if metadata is not None:
        meta_path = tmp_path / f"{tag}_meta.tsv"
        pd.DataFrame(metadata).to_csv(meta_path, sep="\t", index=False)
        cmd += ["--metadata", str(meta_path)]
    if extra:
        cmd += extra
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(SRC))
    assert proc.returncode == 0, f"aggregate.py failed:\n{proc.stdout}\n{proc.stderr}"
    df = pd.read_csv(out, sep="\t")
    return {r["clonotypeKey"]: r for _, r in df.iterrows()}, list(df.columns)


def test_no_grouping_score_is_peak_percentile(tmp_path):
    # No metadata → starScore = pct(peak); order follows peak. Support NOT exported.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "starScore": 5.0, "starHit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "starScore": 9.0, "starHit": "Hit"},
        {"clonotypeKey": "C", "sampleId": "S1", "starScore": 1.0, "starHit": "Not hit"},
    ]
    res, cols = run_aggregate(tmp_path, rows)
    assert "support" not in cols
    assert set(cols) == {"clonotypeKey", "starScore", "starHit"}
    # peak order B > A > C → starScore order B > A > C, all percentiles in (0,1].
    assert res["B"]["starScore"] > res["A"]["starScore"] > res["C"]["starScore"]
    assert 0 < res["C"]["starScore"] <= 1.0


def test_weight_extremes_flip_ranking(tmp_path):
    # A: peak 5 in TWO donors (support 2). B: peak 9 in ONE donor (support 1).
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "starScore": 5.0, "starHit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "starScore": 3.0, "starHit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "starScore": 9.0, "starHit": "Hit"},
        {"clonotypeKey": "C", "sampleId": "S1", "starScore": 1.0, "starHit": "Not hit"},
    ]
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D2"}]
    # w=1 → strength only: B (peak 9) tops.
    res1, _ = run_aggregate(tmp_path, rows, metadata=meta, extra=["--weight", "1"], tag="w1")
    assert res1["B"]["starScore"] == max(r["starScore"] for r in res1.values())
    # w=0 → reproducibility only: A (support 2) tops.
    res0, _ = run_aggregate(tmp_path, rows, metadata=meta, extra=["--weight", "0"], tag="w0")
    assert res0["A"]["starScore"] == max(r["starScore"] for r in res0.values())


def test_private_clone_included(tmp_path):
    # A single-donor clone is downranked but never emptied — it has a score.
    rows = [{"clonotypeKey": "P", "sampleId": "S1", "starScore": 7.0, "starHit": "Hit"}]
    res, _ = run_aggregate(tmp_path, rows)
    assert "P" in res and res["P"]["starScore"] > 0


def test_untestable_sample_ignored(tmp_path):
    # A blank per-sample score (untestable there) is not evidence, but the clone
    # still aggregates from its scored samples.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "starScore": "", "starHit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "starScore": 4.0, "starHit": "Hit"},
    ]
    res, _ = run_aggregate(tmp_path, rows)
    assert "A" in res


def test_fast_star_threshold(tmp_path):
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "starScore": 0.02, "starHit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "starScore": 0.0005, "starHit": "Not hit"},
    ]
    res, cols = run_aggregate(tmp_path, rows, method="fast-STAR", extra=["--threshold", "0.01"])
    assert "support" not in cols
    assert res["A"]["starHit"] == "Hit"  # peak 0.02 > 0.01
    assert res["B"]["starHit"] == "Not hit"


def test_expected_filter_excludes_samples(tmp_path):
    # S1 is "pre" (excluded); S2 is "post" (kept). B lives only in S1 → drops out.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S2", "starScore": 4.0, "starHit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "starScore": 9.0, "starHit": "Hit"},
    ]
    meta = [{"sampleId": "S1", "expected": "pre"}, {"sampleId": "S2", "expected": "post"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta, extra=["--expected-values", '["post"]'])
    assert "A" in res and "B" not in res


def test_k2_replicability(tmp_path):
    # k>=2 needs a hit in >= 2 independent units. A: D1 and D2 → Hit; B: 1 unit → Not.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "starScore": 5.0, "starHit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "starScore": 5.0, "starHit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "starScore": 9.0, "starHit": "Hit"},
    ]
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D2"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta, extra=["--k", "2"])
    assert res["A"]["starHit"] == "Hit"
    assert res["B"]["starHit"] == "Not hit"
