"""Stage 4 — aggregate the per-sample convergence signal to the clonotype-only axis.

Implements A-0011. The block computes convergence PER SAMPLE (Stages 1-3); the
downstream in-vivo score / lead selection consume a CLONOTYPE-ONLY signal
(A-0006), so a clonotype seen in several samples is collapsed to one value per
column. Only `starScore` and `starHit` are aggregated/exported here; `neighbours`
stays a per-sample inner/QC value (A-0012 follow-up).

Aggregation is always WITHIN ONE MODE (A-0003): a run is full-STAR or fast-STAR,
never both, so `--method` selects the interpretation of the per-sample score.

Two-level shape (A-0011), mirroring the within-sample discipline one level up:

    per-sample rows
      → (eligibility)        keep technically-good ∩ biologically-expected samples
      → unit assignment      unit = independence-grouping value, else the sampleId
      → Level 1 collapse     one value per (clonotype, unit)   [--within-unit]
      → Level 2 aggregate    one value per clonotype           [max / BH]

Rules are intentionally parameterised (the exact semantics are still settling in
Q-0009); each lives in its own small function so it can be swapped without
restructuring.

  starScore  → a reproducibility-aware blend of two percentile ranks across the
               dataset's clonotypes (A-0011):
                   starScore = w * pct(peak) + (1 - w) * pct(support)
               peak    = the clone's strongest per-unit convergence
                         (max(-log10 p) full-STAR, max(nbFreq) fast-STAR);
               support = the count of independent units (donors) in which it is
                         a convergent hit — a count, NOT a fraction;
               pct(.)  = percentile-rank into (0, 1]; `w` = --weight in [0, 1].
               No independence grouping → support is undefined → starScore =
               pct(peak) alone. Private / low-support clones are downranked
               (shrunk, never emptied).
  starHit    → full-STAR: per clonotype take the k-th ordered per-unit p-value
               (k=1 ⇒ min-p, with a multiplicity correction over its units),
               then Benjamini-Hochberg across all clonotypes at `--alpha`.
               fast-STAR: count of per-unit hits >= k (k=1 ⇒ max(nbFreq) >
               threshold).

`support` (the donor-hit count) is computed internally — it feeds the starScore
blend and the >= k hit call — but is NOT exported as its own column (A-0012 /
A-0014 export only starScore + starHit).

`--k >= 2` (replicability) needs the independence grouping and >= k units; a
clone in fewer than k units is "Not hit" for the replicability claim (the k=1
call is never blocked — full-STAR always produces, A-0011).

Input TSV: the reassembled per-sample convergence table — one row per
(sampleId, clonotypeKey) with `starScore` (Double; -log10 p for full-STAR,
nbFreq for fast-STAR; blank when a clone was untestable in that sample) and
`starHit` ("Hit"/"Not hit"). Optional `--metadata` TSV maps sampleId → an
`expected` column (biological eligibility) and/or a `unit` column (independence
grouping). Output TSV: one row per clonotype with `starScore` + `starHit`.

Structured stdout, one event per line, prefixed ``[chain <chain>]``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--chain", required=True)
    parser.add_argument("--method", required=True, choices=["full-STAR", "fast-STAR"])
    # full-STAR knob (BH FDR target across clonotypes); fast-STAR knob (nbFreq cutoff).
    parser.add_argument("--alpha", type=float, default=0.005)
    parser.add_argument("--threshold", type=float, default=None)
    # Replicability: independent units a clonotype must be a hit in.
    parser.add_argument("--k", type=int, default=1)
    # Optional sample metadata: sampleId + optional `expected` / `unit` columns.
    parser.add_argument("--metadata", type=Path, default=None)
    # JSON list of `expected` values that count as biologically eligible; when
    # given, samples whose `expected` value is outside the list are dropped from
    # the EXPORTED aggregate (the block's own per-sample table keeps them).
    parser.add_argument("--expected-values", dest="expected_values", default=None)
    # starScore strength<->reproducibility weight (A-0011): w in [0,1] for
    # starScore = w*pct(peak) + (1-w)*pct(support). Default 0.5 (50/50).
    parser.add_argument("--weight", type=float, default=0.5)
    parser.add_argument(
        "--within-unit",
        dest="within_unit",
        default="peak",
        choices=["peak", "mean"],
        help="Level-1 collapse of correlated samples in one unit (Q-0009).",
    )
    parser.add_argument(
        "--multiplicity",
        default="sidak",
        choices=["sidak", "bonferroni", "none"],
        help="full-STAR k=1 correction of min-p over a clone's units.",
    )
    parser.add_argument("--clonotype-column", dest="clonotype_column", default="clonotypeKey")
    parser.add_argument("--sample-column", dest="sample_column", default="sampleId")
    parser.add_argument("--score-column", dest="score_column", default="starScore")
    parser.add_argument("--hit-column", dest="hit_column", default="starHit")
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}")


# --- rule functions (each independently swappable) --------------------------


def collapse_within_unit(scores: np.ndarray, rule: str) -> float:
    """Level 1 — collapse the scores of correlated samples in one unit to a
    single per-unit score. `peak` (the default) keeps the unit's strongest
    signal (== min p for full-STAR, since score = -log10 p); `mean` suits
    technical replicates. Exact choice is a Q-0009 parameter."""
    if rule == "mean":
        return float(np.mean(scores))
    return float(np.max(scores))  # peak


def combine_unit_pvalues(unit_p: np.ndarray, k: int, multiplicity: str) -> float | None:
    """Level 2 (full-STAR) — one combined p per clonotype from its per-unit
    p-values. k=1: min-p with a multiplicity correction over the clone's units.
    k>=2: the k-th ordered p (replicability); None when the clone spans < k
    units (cannot support the replicability claim)."""
    n = len(unit_p)
    if k <= 1:
        p_min = float(np.min(unit_p))
        if multiplicity == "none" or n <= 1:
            return p_min
        if multiplicity == "bonferroni":
            return min(p_min * n, 1.0)
        return 1.0 - (1.0 - p_min) ** n  # sidak
    if n < k:
        return None
    return float(np.sort(unit_p)[k - 1])


def bh_hit_mask(pvalues: np.ndarray, alpha: float) -> np.ndarray:
    """Benjamini-Hochberg first-crossing selection (same rule as full_star's
    within-sample pass, one level up). Hits are the lowest-p clonotypes up to
    the largest rank still under the BH line. Stable sort → deterministic ties."""
    m = len(pvalues)
    if m == 0:
        return np.zeros(0, dtype=bool)
    order = np.argsort(pvalues, kind="stable")
    sorted_p = pvalues[order]
    # 1-based ranks: reject the first (rank-1) rows at the smallest rank whose
    # p_(rank) exceeds (rank/m)*alpha; default to m (all) if never crossed.
    # rank starts at 1 so the smallest p is tested against its own threshold —
    # otherwise a set where even p_(1) fails BH would still force order[:1] to Hit.
    k = m
    for rank in range(1, m + 1):
        if sorted_p[rank - 1] > (rank / m) * alpha:
            k = rank - 1
            break
    mask = np.zeros(m, dtype=bool)
    mask[order[:k]] = True
    return mask


# --- main -------------------------------------------------------------------


def main() -> int:
    args = parse_args()
    prefix = f"[chain {args.chain}]"

    df = pd.read_csv(args.input, sep="\t")
    clone_c, sample_c = args.clonotype_column, args.sample_column
    score_c, hit_c = args.score_column, args.hit_column
    required = {clone_c, sample_c, score_c, hit_c}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Only starScore + starHit are exported (A-0012/A-0014). `support` (donor-hit
    # count) is computed internally — it feeds the starScore blend and the k-call
    # — but is NOT emitted as its own column.
    out_cols = [clone_c, "starScore", "starHit"]

    log(prefix, f"input rows (sample x clonotype): {len(df)}")
    if len(df) == 0:
        pd.DataFrame(columns=out_cols).to_csv(args.output, sep="\t", index=False)
        log(prefix, "empty input; emitting empty output")
        return 0

    # --- metadata: eligibility filter + unit assignment ---------------------
    # `has_grouping` gates the support term of starScore (A-0011): without an
    # independence grouping, support is undefined → starScore = pct(peak) alone.
    has_grouping = False
    df["_unit"] = df[sample_c].astype(str)  # default: each sample is its own unit
    if args.metadata is not None and args.metadata.exists():
        meta = pd.read_csv(args.metadata, sep="\t", dtype=str)
        if sample_c in meta.columns:
            df = df.merge(meta, on=sample_c, how="left", suffixes=("", "_meta"))
            if "unit" in meta.columns:
                has_grouping = True
                # Fall back to sampleId where the grouping value is missing.
                grp = df["unit"].astype("string")
                df["_unit"] = grp.fillna(df[sample_c].astype(str)).astype(str)
                log(prefix, "independence grouping active")
            if args.expected_values is not None and "expected" in meta.columns:
                expected = set(json.loads(args.expected_values))
                before = df[sample_c].nunique()
                df = df[df["expected"].astype("string").isin(expected)]
                after = df[sample_c].nunique()
                log(prefix, f"expected-sample filter: kept {after}/{before} samples")

    if len(df) == 0:
        pd.DataFrame(columns=out_cols).to_csv(args.output, sep="\t", index=False)
        log(prefix, "no samples remain after eligibility; emitting empty output")
        return 0

    # A per-sample row contributes only if it carries a numeric score (a clone
    # untestable in a sample has a blank starScore and is not evidence).
    df["_score"] = pd.to_numeric(df[score_c], errors="coerce")
    df["_hit"] = df[hit_c].astype(str) == "Hit"
    scored = df[df["_score"].notna()].copy()
    log(prefix, f"units: {df['_unit'].nunique()}; scored rows: {len(scored)}")

    # --- Level 1: collapse each (clonotype, unit) to one per-unit value -----
    per_unit = (
        scored.groupby([clone_c, "_unit"])
        .agg(
            unit_score=("_score", lambda s: collapse_within_unit(s.to_numpy(dtype=float), args.within_unit)),
            unit_hit=("_hit", "any"),
        )
        .reset_index()
    )

    # --- Level 2: one value per clonotype -----------------------------------
    is_full = args.method == "full-STAR"
    threshold = args.threshold
    if not is_full and threshold is None:
        print("error: fast-STAR aggregation requires --threshold")
        return 2

    # peak = strongest per-unit score; support = number of hit units (donors).
    per_clone = (
        per_unit.groupby(clone_c)
        .agg(peak=("unit_score", "max"), support=("unit_hit", "sum"))
        .reset_index()
    )
    per_clone["support"] = per_clone["support"].astype(int)

    # starHit — the >= k partial conjunction with Benjamini-Hochberg across
    # clonotypes (full-STAR) or a per-unit hit count / threshold (fast-STAR).
    if is_full:
        # score = -log10 p ⇒ p = 10^-score. One combined p per clonotype
        # (min-p x multiplicity for k=1, k-th ordered p for k>=2; None when the
        # clone spans < k units → untestable → Not hit).
        per_unit["_p"] = np.power(10.0, -per_unit["unit_score"].to_numpy(dtype=float))
        combined = {
            clone: combine_unit_pvalues(g["_p"].to_numpy(dtype=float), args.k, args.multiplicity)
            for clone, g in per_unit.groupby(clone_c)
        }
        per_clone["_combined_p"] = per_clone[clone_c].map(combined)
        testable = per_clone["_combined_p"].notna().to_numpy()
        per_clone["starHit"] = "Not hit"
        hits = bh_hit_mask(per_clone.loc[testable, "_combined_p"].to_numpy(dtype=float), args.alpha)
        per_clone.loc[per_clone.index[testable][hits], "starHit"] = "Hit"
        log(
            prefix,
            f"BH across {int(testable.sum())} testable clonotypes at alpha={args.alpha}: "
            f"{int(hits.sum())} hits",
        )
    elif args.k >= 2:
        per_clone["starHit"] = np.where(per_clone["support"] >= args.k, "Hit", "Not hit")
    else:
        per_clone["starHit"] = np.where(per_clone["peak"] > threshold, "Hit", "Not hit")

    # starScore — reproducibility-aware blend of two percentile ranks across
    # clonotypes (A-0011): w*pct(peak) + (1-w)*pct(support). Without an
    # independence grouping, support is undefined → pct(peak) alone. Both terms
    # monotone-increasing, so the score rewards strength AND cross-donor recurrence.
    # rank(pct=True) maps to (0, 1] (ties averaged).
    pct_peak = per_clone["peak"].rank(pct=True)
    if has_grouping:
        pct_support = per_clone["support"].rank(pct=True)
        per_clone["starScore"] = args.weight * pct_peak + (1.0 - args.weight) * pct_support
        log(prefix, f"starScore = {args.weight}*pct(peak) + {1.0 - args.weight}*pct(support)")
    else:
        per_clone["starScore"] = pct_peak
        log(prefix, "starScore = pct(peak) (no grouping → support undefined)")

    result = per_clone[[clone_c, "starScore", "starHit"]].sort_values("starScore", ascending=False)
    result.to_csv(args.output, sep="\t", index=False)
    log(prefix, f"aggregated to {len(result)} clonotypes; {int((result['starHit'] == 'Hit').sum())} hits")
    log(prefix, "aggregate done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
