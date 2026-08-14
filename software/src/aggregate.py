"""Stage 4 — aggregate the per-sample convergence signal to the clonotype-only axis.

The block computes convergence PER SAMPLE (Stages 1-3); the downstream
repertoire score / lead selection consume a CLONOTYPE-ONLY signal, so a
clonotype seen in several samples is collapsed to one value per column. Each
emitted mode aggregates INDEPENDENTLY: the workflow calls this once per mode
with that mode's per-sample score/hit columns, and `--method` selects the
statistic. `neighbours` is never aggregated — it stays a per-sample
inner/QC value.

Three exported values per mode: a score, a hit, and a reproducibility ratio.

Two-level shape, mirroring the within-sample discipline one level up:

    per-sample rows
      → (eligibility)        keep technically-good ∩ biologically-expected samples
      → unit assignment      unit = independence-grouping value, else the sampleId
      → Level 1 collapse     one value per (clonotype, unit)
      → Level 2 aggregate    one value per clonotype

  Level 1 (identity when every sample is its own unit, i.e. m = 1):
      fast-STAR  nbFreq_unit = max over the unit's samples — within a unit,
                 variation across samples is signal (the response peak).
      full-STAR  p_unit = min(1, m · min p)  (Bonferroni over the unit's m
                 samples). Computed in -log10 space, where it is exactly
                 score_unit = max(0, max(score) - log10(m)). The SAME p_unit
                 feeds both the score contribution and the Fisher combination —
                 one number, both faces.

  Level 2, over the units the clonotype is PRESENT in (no zero-filling):
      full-STAR  Fisher: X = -2 Σ ln p_unit ~ χ²(2k) → one combined p.
                 score = -log10(combined p)   (NOT the raw Σ -log10 p, which
                         ignores k and so contradicts the hit — see
                         fisher_combined)
                 hit   = Benjamini-Hochberg on that same p across all
                         clonotypes at --alpha.
                 Score and hit are therefore one quantity; at k = 1 both reduce
                 to the unit's own p.
      fast-STAR  score = the upper median: the ⌊n/2⌋+1-th smallest nbFreq_unit
                 across the n present units (Wilkinson's r-th ordered statistic).
                 Identity at n <= 2, robust from n = 3. Always an actual unit's
                 observation, never an interpolation.
                 hit   = that aggregated nbFreq > --threshold (no p, no BH).

  Reproducibility (both modes): hit-units / D.
      hit-units  = units in which the clonotype is a per-sample hit of that mode
                   (any-of within the unit).
      D          = units with at least one sample surviving the expected-at
                   filter — a per-dataset CONSTANT, the same for every clonotype
                   and both modes, which is what makes the ratio comparable
                   across clonotypes. QC-failed units are KEPT in D, so it is
                   counted over the sample universe in --metadata (which lists
                   every sample of the dataset, including ones that produced no
                   convergence rows), not over the samples present in --input.

`alpha` is the only exposed statistical knob (plus fast-STAR's threshold): no
weight, no percentile, no replicability `k`.

Input TSV: the reassembled per-sample convergence table — one row per
(sampleId, clonotypeKey) with the mode's score column (Double; -log10 p for
full-STAR, nbFreq for fast-STAR; blank when a clone was untestable in that
sample) and hit column ("Hit"/"Not hit"). Optional `--metadata` TSV is the
sample universe: one row per dataset sample, `sampleId` plus an optional
`expected` column (biological eligibility) and/or `unit` column (independence
grouping). Output TSV: one row per clonotype with score + hit + reproducibility.

Structured stdout, one event per line, prefixed ``[chain <chain>]``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.special import gammaln, logsumexp
from scipy.stats import chi2

# ln(10): converts a -log10 p to the natural-log form Fisher's statistic needs.
LN10 = float(np.log(10.0))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--chain", required=True)
    parser.add_argument("--method", required=True, choices=["full-STAR", "fast-STAR"])
    # full-STAR knob (BH FDR target across clonotypes); fast-STAR knob (nbFreq cutoff).
    parser.add_argument("--alpha", type=float, default=0.005)
    parser.add_argument("--threshold", type=float, default=None)
    # Sample universe: sampleId + optional `expected` / `unit` columns. One row
    # per dataset sample, including samples that produced no convergence rows —
    # that is what makes D count QC-failed units.
    parser.add_argument("--metadata", type=Path, default=None)
    # JSON list of `expected` values that count as biologically eligible; when
    # given, samples whose `expected` value is outside the list are dropped from
    # the EXPORTED aggregate (the block's own per-sample table keeps them) and
    # from D.
    parser.add_argument("--expected-values", dest="expected_values", default=None)
    parser.add_argument("--clonotype-column", dest="clonotype_column", default="clonotypeKey")
    parser.add_argument("--sample-column", dest="sample_column", default="sampleId")
    parser.add_argument("--score-column", dest="score_column", default="starScore")
    parser.add_argument("--hit-column", dest="hit_column", default="starHit")
    parser.add_argument("--reproducibility-column", dest="repro_column", default="reproducibility")
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}")


# --- rule functions (each independently swappable) --------------------------


def bonferroni_unit_score(scores: np.ndarray) -> float:
    """Level 1, full-STAR — one unit p from the unit's m sample p-values:
    ``p_unit = min(1, m * min p)``, expressed in -log10 space where it is
    ``max(0, max(score) - log10(m))``. Identity at m = 1.

    The correction prices the width of the search (not knowing in advance which
    of the unit's samples peaks); the smallest of m p-values is not itself a
    p-value, and both the Fisher combination and BH downstream read p_unit as a
    probability. Working in log space keeps the strongest clones exact — their
    raw p underflows to 0.0 upstream."""
    m = len(scores)
    best = float(np.max(scores))
    if m <= 1:
        return best
    return max(0.0, best - float(np.log10(m)))


def upper_median(values: np.ndarray) -> float:
    """Level 2, fast-STAR — the ⌊n/2⌋+1-th smallest of the n per-unit values
    (Wilkinson's r-th ordered statistic at the upper-median rank).

    The reported value is always an actual unit's observation, never an
    interpolation, and the rule is the identity at n <= 2 (so single- and
    two-unit clonotypes are never diluted); robustness engages from n = 3.
    nbFreq is not size-adjusted, so across units a lone spike is more likely a
    shallow-sampling artifact than biology — hence the typical unit, not the
    peak."""
    ordered = np.sort(values)
    return float(ordered[len(ordered) // 2])


def log_chi2_sf_even(x: float, k: int) -> float:
    """``log P(χ²(2k) > x)`` — exact, and stable where the tail underflows.

    The degrees of freedom here are always even (2k, k = the clonotype's units),
    and for even df the survival function is a finite sum:

        P(χ²(2k) > x) = exp(-x/2) · Σ_{i=0..k-1} (x/2)^i / i!

    so its log is ``-x/2 + logsumexp(i·log(x/2) - lgamma(i+1))``. Evaluating it
    this way keeps the strongest clones finite: `chi2.sf` underflows to 0.0
    around x ≈ 1500 (score ≈ 325) and `chi2.logsf` follows it to -inf, which
    surfaced as an +inf score on exactly the clones the block exists to find."""
    if x <= 0.0:
        return 0.0  # P(χ² > 0) = 1
    half = 0.5 * x
    i = np.arange(k)
    return float(-half + logsumexp(i * np.log(half) - gammaln(i + 1.0)))


def fisher_combined(unit_scores: np.ndarray) -> tuple[float, float]:
    """Level 2, full-STAR — Fisher's combination, returned as (score, p).

    ``X = -2 Σ ln p_unit = 2·ln(10)·Σ (-log10 p_unit) ~ χ²(2k)`` under the null,
    k = the number of independent units. The χ² tail of X is the clonotype's
    combined p-value; the exported score is that same p on the readable scale,
    ``-log10(combined p)``.

    The score is deliberately the COMBINED P, not the raw sum ``Σ -log10 p``.
    The sum ignores k, so it is not monotone in significance: a clone present in
    two units with one silent (p = 1) sums to exactly the same value as a clone
    present in one, while its χ²(4) tail is far less significant — same score,
    opposite verdict, and a ranking that contradicts the hit set. Scoring the
    combined p makes score and hit one quantity: equal scores always mean equal
    verdicts, and ranking by score orders clones exactly as the hit call does.
    Breadth across replicates is not lost — it is the reproducibility column.

    At k = 1 the χ²(2) tail is ``exp(-X/2) = p``, so the score is the unit's own
    ``-log10 p`` unchanged — a one-unit clonotype is scored exactly as it is
    within its sample.

    Computed in LOG space (see ``log_chi2_sf_even``): the strongest clones
    underflow the tail to 0.0, and scipy's own ``logsf`` underflows with it, so
    either would report the most convergent clonotypes as score +inf."""
    k = len(unit_scores)
    x = 2.0 * LN10 * float(np.sum(unit_scores))
    log_p = log_chi2_sf_even(x, k)
    return -log_p / LN10, float(np.exp(log_p))


def bh_hit_mask(pvalues: np.ndarray, alpha: float) -> np.ndarray:
    """Benjamini-Hochberg STEP-UP selection: find the LARGEST rank r whose
    p_(r) <= (r/m)*alpha, and reject ranks 1..r. Stable sort → deterministic
    ties; equal p-values always land on the same side of the cut, because the
    BH line only rises with rank.

    Deliberately NOT the same rule as full_star.py's within-sample pass. That
    one stops at the FIRST rank to exceed the line, verbatim from STAR's
    `Output_MC.BH_procedure`, and must stay that way to reproduce the reference
    (M1). Here nothing constrains us to STAR's variant, and first-crossing is
    severely conservative at repertoire scale: rank 1 has to clear alpha/m, so
    with ~70k clonotypes a single moderately-significant leader stops the whole
    procedure and the block reports ZERO hits while looking perfectly healthy.
    Step-up is the textbook procedure and controls the FDR at alpha just the
    same, while rejecting everything up to the last rank that clears its line."""
    m = len(pvalues)
    if m == 0:
        return np.zeros(0, dtype=bool)
    order = np.argsort(pvalues, kind="stable")
    sorted_p = pvalues[order]
    ranks = np.arange(1, m + 1)
    passing = np.nonzero(sorted_p <= (ranks / m) * alpha)[0]
    mask = np.zeros(m, dtype=bool)
    if passing.size > 0:
        mask[order[: passing[-1] + 1]] = True
    return mask


# --- main -------------------------------------------------------------------


def main() -> int:
    args = parse_args()
    prefix = f"[chain {args.chain}]"

    clone_c, sample_c = args.clonotype_column, args.sample_column
    # The sample column is read as text on BOTH sides (here and for --metadata):
    # it is joined against the universe, and a numeric sampleId inferred as a
    # float on one side only ("12345" vs "12345.0") would silently join nothing.
    df = pd.read_csv(args.input, sep="\t", dtype={sample_c: str, clone_c: str})
    score_c, hit_c, repro_c = args.score_column, args.hit_column, args.repro_column
    required = {clone_c, sample_c, score_c, hit_c}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    is_full = args.method == "full-STAR"
    if not is_full and args.threshold is None:
        print("error: fast-STAR aggregation requires --threshold")
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Output columns are named after the MODE being aggregated: the
    # workflow calls this once per emitted mode with --score-column/--hit-column/
    # --reproducibility-column = nbFreq/fastStar/fastStarReproducibility
    # (fast-STAR) or fullStarScore/fullStar/fullStarReproducibility (full-STAR),
    # and the aggregated result carries those same names.
    out_cols = [clone_c, score_c, hit_c, repro_c]

    def emit_empty(reason: str) -> int:
        pd.DataFrame(columns=out_cols).to_csv(args.output, sep="\t", index=False)
        log(prefix, reason)
        return 0

    log(prefix, f"input rows (sample x clonotype): {len(df)}")
    if len(df) == 0:
        return emit_empty("empty input; emitting empty output")

    # --- the sample universe: unit assignment + eligibility -----------------
    # `universe` is one row per DATASET sample (sampleId, unit), independent of
    # whether that sample produced convergence rows — QC-failed samples are in
    # it, which is what the D definition requires. Without --metadata the per-sample
    # table is the only universe available (standalone / test use).
    expected_values = set(json.loads(args.expected_values)) if args.expected_values else None
    if args.metadata is not None and args.metadata.exists():
        meta = pd.read_csv(args.metadata, sep="\t", dtype=str)
        if sample_c not in meta.columns:
            print(f"error: metadata TSV missing the '{sample_c}' column")
            return 2
        universe = meta[[c for c in (sample_c, "unit", "expected") if c in meta.columns]].copy()
    else:
        universe = pd.DataFrame({sample_c: df[sample_c].astype(str).unique()})
    universe[sample_c] = universe[sample_c].astype(str)
    universe = universe.drop_duplicates(subset=[sample_c])

    has_grouping = "unit" in universe.columns
    if has_grouping:
        # Fall back to the sampleId where the grouping value is missing.
        universe["_unit"] = (
            universe["unit"].astype("string").fillna(universe[sample_c]).astype(str)
        )
        log(prefix, "independence grouping active")
    else:
        universe["_unit"] = universe[sample_c]

    if expected_values is not None and "expected" in universe.columns:
        before = len(universe)
        universe = universe[universe["expected"].astype("string").isin(expected_values)]
        log(prefix, f"expected-sample filter: kept {len(universe)}/{before} samples")
    elif expected_values is not None:
        log(prefix, "expected-sample filter requested but no 'expected' column; keeping all samples")

    # D — the eligible-unit cohort: units with >= 1 sample surviving the
    # expected-at filter. A per-dataset constant, common to every clonotype and
    # both modes; QC-failed units are kept (they are in the universe even
    # though they contributed no rows).
    cohort_d = int(universe["_unit"].nunique())
    log(prefix, f"eligible cohort D (units): {cohort_d}")
    if cohort_d == 0:
        return emit_empty("no samples remain after eligibility; emitting empty output")

    # Restrict the per-sample rows to the eligible samples and attach their unit.
    df[sample_c] = df[sample_c].astype(str)
    df = df.merge(universe[[sample_c, "_unit"]], on=sample_c, how="inner")
    if len(df) == 0:
        return emit_empty("no convergence rows in the eligible samples; emitting empty output")

    # A per-sample row contributes only if it carries a numeric score (a clone
    # untestable in a sample has a blank score and is not evidence). Absence is
    # never zero-filled: aggregation runs over the units the clone is present in.
    df["_score"] = pd.to_numeric(df[score_c], errors="coerce")
    df["_hit"] = df[hit_c].astype(str) == "Hit"
    scored = df[df["_score"].notna()].copy()
    log(prefix, f"units with data: {df['_unit'].nunique()}; scored rows: {len(scored)}")
    if len(scored) == 0:
        return emit_empty("no scored rows; emitting empty output")

    # --- Level 1: collapse each (clonotype, unit) to one per-unit value -----
    collapse = bonferroni_unit_score if is_full else (lambda s: float(np.max(s)))
    per_unit = (
        scored.groupby([clone_c, "_unit"])
        .agg(
            unit_score=("_score", lambda s: collapse(s.to_numpy(dtype=float))),
            unit_hit=("_hit", "any"),
        )
        .reset_index()
    )

    # --- Level 2: one value per clonotype -----------------------------------
    grouped = per_unit.groupby(clone_c)
    clones = []
    scores = []
    combined_p = []
    hit_units = []
    for clone, g in grouped:
        unit_scores = g["unit_score"].to_numpy(dtype=float)
        clones.append(clone)
        hit_units.append(int(g["unit_hit"].sum()))
        if is_full:
            # One quantity, two faces: the combined p is the hit's p-value and
            # the score is that same p as -log10.
            score, p = fisher_combined(unit_scores)
            scores.append(score)
            combined_p.append(p)
        else:
            scores.append(upper_median(unit_scores))

    per_clone = pd.DataFrame({clone_c: clones, "_score": scores})
    per_clone[repro_c] = np.asarray(hit_units, dtype=float) / cohort_d

    if is_full:
        pvals = np.asarray(combined_p, dtype=float)
        hits = bh_hit_mask(pvals, args.alpha)
        per_clone["_hit"] = np.where(hits, "Hit", "Not hit")
        log(
            prefix,
            f"BH across {len(pvals)} clonotypes at alpha={args.alpha}: {int(hits.sum())} hits",
        )
    else:
        per_clone["_hit"] = np.where(per_clone["_score"] > args.threshold, "Hit", "Not hit")
        log(prefix, f"fast-STAR threshold {args.threshold} on the aggregated score")

    # Stable sort: the output bytes are the input of a pure import step, so ties
    # must not reorder run to run (that would break dedup downstream).
    result = (
        per_clone[[clone_c, "_score", "_hit", repro_c]]
        .sort_values("_score", ascending=False, kind="stable")
        .rename(columns={"_score": score_c, "_hit": hit_c})
    )
    result.to_csv(args.output, sep="\t", index=False)
    log(prefix, f"aggregated to {len(result)} clonotypes; {int((result[hit_c] == 'Hit').sum())} hits")
    log(prefix, "aggregate done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
