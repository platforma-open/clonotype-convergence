"""Unit tests for the clonotype-only aggregation engine (aggregate.py).

Synthetic per-sample tables with hand-computable expectations exercise each rule:
the full-STAR Fisher score and its chi2 -> BH hit, the Bonferroni within-unit
collapse, the fast-STAR upper median and its threshold hit, the reproducibility
ratio over the common cohort D (including QC-failed units the sample universe
carries but the results do not), the expected-sample eligibility filter, and the
mode-named output columns the workflow actually asks for.

Run:  cd software && python -m pytest test/test_aggregate.py
"""

import math
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest
from scipy.stats import chi2

approx = pytest.approx

HERE = Path(__file__).parent
SRC = HERE.parent / "src"

# The column names the workflow passes for each mode.
FULL = ["--score-column", "fullStarScore", "--hit-column", "fullStar",
        "--reproducibility-column", "fullStarReproducibility"]
FAST = ["--score-column", "nbFreq", "--hit-column", "fastStar",
        "--reproducibility-column", "fastStarReproducibility"]


def run_aggregate(tmp_path, rows, *, method="full-STAR", cols=None, extra=None,
                  metadata=None, tag="run"):
    """Write `rows` to a per-sample TSV, run aggregate.py, and return
    (dict keyed by clonotypeKey, list of output columns)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    cols = cols if cols is not None else (FULL if method == "full-STAR" else FAST)
    inp = tmp_path / f"{tag}_in.tsv"
    score_c, hit_c = cols[1], cols[3]
    pd.DataFrame(rows).rename(
        columns={"score": score_c, "hit": hit_c}
    ).to_csv(inp, sep="\t", index=False)
    out = tmp_path / f"{tag}_out.tsv"
    cmd = [
        sys.executable, str(SRC / "aggregate.py"),
        "--input", str(inp), "--output", str(out),
        "--chain", "IGHeavy", "--method", method, "--alpha", "0.005", *cols,
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


# --- output shape -----------------------------------------------------------


def test_output_columns_are_mode_named(tmp_path):
    # The workflow renames per mode; the aggregated TSV must carry those names
    # (and nothing else — no internal `support` / `peak` leakage).
    rows = [{"clonotypeKey": "A", "sampleId": "S1", "score": 5.0, "hit": "Hit"}]
    _, cols = run_aggregate(tmp_path, rows)
    assert cols == ["clonotypeKey", "fullStarScore", "fullStar", "fullStarReproducibility"]
    _, cols_fast = run_aggregate(
        tmp_path, rows, method="fast-STAR", extra=["--threshold", "0.01"], tag="fast"
    )
    assert cols_fast == ["clonotypeKey", "nbFreq", "fastStar", "fastStarReproducibility"]


# --- full-STAR: Fisher score ------------------------------------------------


def test_score_is_the_combined_p_not_the_raw_sum(tmp_path):
    # Three replicates of one sample each. The raw Fisher sum would be
    # 8.3+1.5+4.0 = 13.8; the exported score is that combination's own
    # significance, -log10 of the chi2(6) tail, which is strictly smaller
    # because three tests had three chances to accumulate -log10 p by chance.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 8.3, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 1.5, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S3", "score": 4.0, "hit": "Hit"},
    ]
    meta = [
        {"sampleId": "S1", "unit": "D1"},
        {"sampleId": "S2", "unit": "D2"},
        {"sampleId": "S3", "unit": "D3"},
    ]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    score = res["A"]["fullStarScore"]
    assert 0 < score < 13.8
    assert score == approx(-math.log10(chi2.sf(2 * math.log(10) * 13.8, 6)))


def test_a_silent_replicate_lowers_the_score(tmp_path):
    # THE case the operator hit: same evidence, but one clone is also present
    # in a replicate where it shows nothing (p = 1, contributing 0 to the sum).
    # Under the raw sum both scored identically while only one was a hit; the
    # combined p separates them, so score and hit can no longer disagree.
    rows = [
        {"clonotypeKey": "ONE", "sampleId": "S1", "score": 4.0, "hit": "Hit"},
        {"clonotypeKey": "TWO", "sampleId": "S1", "score": 4.0, "hit": "Hit"},
        {"clonotypeKey": "TWO", "sampleId": "S2", "score": 0.0, "hit": "Not hit"},
    ]
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D2"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["ONE"]["fullStarScore"] == approx(4.0)  # k=1: the unit's own -log10 p
    assert res["TWO"]["fullStarScore"] < res["ONE"]["fullStarScore"]


def test_more_real_evidence_still_scores_higher(tmp_path):
    # The df penalty must not swamp genuine accumulation: three replicates each
    # carrying signal beat two carrying the same per-replicate signal.
    rows = [
        {"clonotypeKey": "TWO", "sampleId": "S1", "score": 2.0, "hit": "Hit"},
        {"clonotypeKey": "TWO", "sampleId": "S2", "score": 2.0, "hit": "Hit"},
        {"clonotypeKey": "THREE", "sampleId": "S1", "score": 2.0, "hit": "Hit"},
        {"clonotypeKey": "THREE", "sampleId": "S2", "score": 2.0, "hit": "Hit"},
        {"clonotypeKey": "THREE", "sampleId": "S3", "score": 2.0, "hit": "Hit"},
    ]
    meta = [{"sampleId": f"S{i}", "unit": f"D{i}"} for i in (1, 2, 3)]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["THREE"]["fullStarScore"] > res["TWO"]["fullStarScore"]


def test_equal_scores_always_get_equal_verdicts(tmp_path):
    # Score and hit are now one quantity, so the table can never show the same
    # score with different calls (the operator's #358).
    rows = []
    for i in range(60):
        rows.append({"clonotypeKey": f"A{i:02d}", "sampleId": "S1", "score": 5.0, "hit": "Hit"})
        if i % 2:  # half also present in a silent second replicate
            rows.append({"clonotypeKey": f"A{i:02d}", "sampleId": "S2", "score": 0.0, "hit": "Not hit"})
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D2"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    by_score = {}
    for r in res.values():
        by_score.setdefault(round(float(r["fullStarScore"]), 12), set()).add(r["fullStar"])
    assert all(len(v) == 1 for v in by_score.values()), by_score


def test_bonferroni_within_unit(tmp_path):
    # One donor holding m=3 samples: the unit p is min(1, 3 * min p), i.e. the
    # best score minus log10(3) — and Level 2 has a single unit, so that IS the
    # exported score (SPEC: 8.3 as best-of-3 → 7.8).
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 8.3, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 2.0, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S3", "score": 1.0, "hit": "Not hit"},
    ]
    meta = [{"sampleId": s, "unit": "D1"} for s in ("S1", "S2", "S3")]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["A"]["fullStarScore"] == approx(8.3 - math.log10(3))


def test_bonferroni_never_goes_below_zero(tmp_path):
    # p_unit = min(1, m*p) is capped at 1 → the -log10 form floors at 0.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 0.1, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 0.05, "hit": "Not hit"},
    ]
    meta = [{"sampleId": s, "unit": "D1"} for s in ("S1", "S2")]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["A"]["fullStarScore"] == 0.0


def test_single_unit_is_the_identity(tmp_path):
    # k=1: Fisher returns the unit's own p, so a one-donor clone's combined p IS
    # its per-sample p. score 3 → p = 1e-3; alpha 0.005 with m=1 → Hit.
    rows = [{"clonotypeKey": "A", "sampleId": "S1", "score": 3.0, "hit": "Hit"}]
    res, _ = run_aggregate(tmp_path, rows)
    assert res["A"]["fullStarScore"] == approx(3.0)
    assert res["A"]["fullStar"] == "Hit"


def test_absent_units_are_not_zero_filled(tmp_path):
    # B is present in one donor only; its score is that donor's, not diluted by
    # the donors it is absent from.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 4.0, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 4.0, "hit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "score": 4.0, "hit": "Hit"},
    ]
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D2"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    # B is present in one unit only, so its score is that unit's own -log10 p;
    # A combines two units and, being genuinely convergent in both, outscores it.
    assert res["B"]["fullStarScore"] == approx(4.0)
    assert res["A"]["fullStarScore"] > res["B"]["fullStarScore"]


def test_untestable_sample_ignored(tmp_path):
    # A blank per-sample score (untestable there) is not evidence, but the clone
    # still aggregates from its scored samples.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": "", "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 4.0, "hit": "Hit"},
    ]
    res, _ = run_aggregate(tmp_path, rows)
    assert res["A"]["fullStarScore"] == approx(4.0)


# --- full-STAR: the BH hit --------------------------------------------------


def test_bh_hit_is_a_population_decision(tmp_path):
    # 4 clonotypes, alpha 0.005. A is overwhelming (p=1e-12), D is noise (p=0.5).
    # BH's sliding line admits A and stops well before D — "hit" is not "p<alpha".
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 12.0, "hit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "score": 6.0, "hit": "Hit"},
        {"clonotypeKey": "C", "sampleId": "S1", "score": 2.0, "hit": "Not hit"},
        {"clonotypeKey": "D", "sampleId": "S1", "score": 0.3, "hit": "Not hit"},
    ]
    res, _ = run_aggregate(tmp_path, rows)
    assert res["A"]["fullStar"] == "Hit"
    assert res["B"]["fullStar"] == "Hit"
    assert res["D"]["fullStar"] == "Not hit"


# --- fast-STAR: upper median + threshold ------------------------------------


def test_upper_median_across_units(tmp_path):
    # n=3 units with 0.001 / 0.02 / 0.03 → the upper median is the 2nd smallest
    # (0.02): an actual unit's observation, and a lone spike cannot carry it.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 0.001, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 0.02, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S3", "score": 0.03, "hit": "Hit"},
    ]
    meta = [{"sampleId": f"S{i}", "unit": f"D{i}"} for i in (1, 2, 3)]
    res, _ = run_aggregate(
        tmp_path, rows, method="fast-STAR", metadata=meta, extra=["--threshold", "0.01"]
    )
    assert res["A"]["nbFreq"] == approx(0.02)
    assert res["A"]["fastStar"] == "Hit"


def test_upper_median_is_identity_at_two_units(tmp_path):
    # n<=2 must not dilute: the upper of two is the larger value.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 0.001, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 0.02, "hit": "Hit"},
    ]
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D2"}]
    res, _ = run_aggregate(
        tmp_path, rows, method="fast-STAR", metadata=meta, extra=["--threshold", "0.01"]
    )
    assert res["A"]["nbFreq"] == approx(0.02)


def test_fast_star_within_unit_is_max(tmp_path):
    # Within one donor the peak is the signal (the response peaks at a timepoint).
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 0.001, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 0.02, "hit": "Hit"},
    ]
    meta = [{"sampleId": s, "unit": "D1"} for s in ("S1", "S2")]
    res, _ = run_aggregate(
        tmp_path, rows, method="fast-STAR", metadata=meta, extra=["--threshold", "0.01"]
    )
    assert res["A"]["nbFreq"] == approx(0.02)


def test_fast_star_hit_thresholds_the_aggregated_value(tmp_path):
    # B peaks above the threshold in one of three units, but its typical unit is
    # below → the aggregated hit is stricter than a best-unit rule.
    rows = [
        {"clonotypeKey": "B", "sampleId": "S1", "score": 0.05, "hit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S2", "score": 0.002, "hit": "Not hit"},
        {"clonotypeKey": "B", "sampleId": "S3", "score": 0.003, "hit": "Not hit"},
    ]
    meta = [{"sampleId": f"S{i}", "unit": f"D{i}"} for i in (1, 2, 3)]
    res, _ = run_aggregate(
        tmp_path, rows, method="fast-STAR", metadata=meta, extra=["--threshold", "0.01"]
    )
    assert res["B"]["nbFreq"] == approx(0.003)
    assert res["B"]["fastStar"] == "Not hit"


# --- reproducibility over the common cohort D -------------------------------


def test_reproducibility_uses_the_common_denominator(tmp_path):
    # Cohort D = 4 donors. A is a hit in 2 → 0.5; B in 1 → 0.25 (NOT 1.0, even
    # though it is a hit in the only donor it appears in).
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 5.0, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 5.0, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S3", "score": 0.1, "hit": "Not hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "score": 9.0, "hit": "Hit"},
    ]
    meta = [{"sampleId": f"S{i}", "unit": f"D{i}"} for i in (1, 2, 3, 4)]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["A"]["fullStarReproducibility"] == approx(0.5)
    assert res["B"]["fullStarReproducibility"] == approx(0.25)


def test_qc_failed_units_stay_in_the_denominator(tmp_path):
    # D4 produced no convergence rows (QC-skipped sample) but is in the sample
    # universe → D counts it, so a 1-of-4 hit reads 0.25, not 0.33.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 5.0, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 0.1, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S3", "score": 0.1, "hit": "Not hit"},
    ]
    meta = [{"sampleId": f"S{i}", "unit": f"D{i}"} for i in (1, 2, 3, 4)]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["A"]["fullStarReproducibility"] == approx(0.25)


def test_reproducibility_counts_samples_without_grouping(tmp_path):
    # No independence grouping → the cohort is the samples themselves.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 5.0, "hit": "Hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 0.1, "hit": "Not hit"},
    ]
    meta = [{"sampleId": "S1"}, {"sampleId": "S2"}, {"sampleId": "S3"}, {"sampleId": "S4"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["A"]["fullStarReproducibility"] == approx(0.25)


def test_within_unit_hit_is_any_of(tmp_path):
    # A donor counts as a hit donor if ANY of its samples is a hit.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S1", "score": 0.1, "hit": "Not hit"},
        {"clonotypeKey": "A", "sampleId": "S2", "score": 5.0, "hit": "Hit"},
    ]
    meta = [{"sampleId": "S1", "unit": "D1"}, {"sampleId": "S2", "unit": "D1"},
            {"sampleId": "S3", "unit": "D2"}]
    res, _ = run_aggregate(tmp_path, rows, metadata=meta)
    assert res["A"]["fullStarReproducibility"] == approx(0.5)


# --- eligibility ------------------------------------------------------------


def test_expected_filter_excludes_samples_and_shrinks_the_cohort(tmp_path):
    # S1 is "pre" (excluded); S2/S3 are "post". B lives only in S1 → drops out,
    # and D counts only the post donors (2), so A's 1-of-2 reads 0.5.
    rows = [
        {"clonotypeKey": "A", "sampleId": "S2", "score": 4.0, "hit": "Hit"},
        {"clonotypeKey": "B", "sampleId": "S1", "score": 9.0, "hit": "Hit"},
    ]
    meta = [
        {"sampleId": "S1", "unit": "D1", "expected": "pre"},
        {"sampleId": "S2", "unit": "D2", "expected": "post"},
        {"sampleId": "S3", "unit": "D3", "expected": "post"},
    ]
    res, _ = run_aggregate(
        tmp_path, rows, metadata=meta, extra=["--expected-values", '["post"]']
    )
    assert "A" in res and "B" not in res
    assert res["A"]["fullStarReproducibility"] == approx(0.5)


def test_private_clone_included(tmp_path):
    # A single-donor clone is never emptied — it keeps a score and a call.
    rows = [{"clonotypeKey": "P", "sampleId": "S1", "score": 7.0, "hit": "Hit"}]
    res, _ = run_aggregate(tmp_path, rows)
    assert "P" in res and res["P"]["fullStarScore"] > 0


def test_empty_input_emits_empty_output(tmp_path):
    # A chain whose samples were all skipped: header-only in, header-only out,
    # with the mode's column names still present so xsv.importFile finds them.
    tmp_path.mkdir(parents=True, exist_ok=True)
    inp = tmp_path / "empty_in.tsv"
    pd.DataFrame(
        columns=["clonotypeKey", "sampleId", "fullStarScore", "fullStar"]
    ).to_csv(inp, sep="\t", index=False)
    out = tmp_path / "empty_out.tsv"
    proc = subprocess.run(
        [
            sys.executable, str(SRC / "aggregate.py"),
            "--input", str(inp), "--output", str(out),
            "--chain", "IGHeavy", "--method", "full-STAR", "--alpha", "0.005", *FULL,
        ],
        capture_output=True, text=True, cwd=str(SRC),
    )
    assert proc.returncode == 0, f"aggregate.py failed:\n{proc.stdout}\n{proc.stderr}"
    df = pd.read_csv(out, sep="\t")
    assert len(df) == 0
    assert list(df.columns) == [
        "clonotypeKey", "fullStarScore", "fullStar", "fullStarReproducibility",
    ]
