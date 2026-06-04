"""Stage 3 — paper's "binder" cluster filter (optional, gated by
args.applyClusterFilter per R58).

Reads Stage 2's output (which has fastStar already set as String
"Hit"/"Not hit" by threshold). Per sample, runs DBSCAN with the
vendored Levenshtein-1 metric on the fastStar=="Hit" subset and
identifies clones whose cluster reaches --cluster-min. Emits an
**additive** new column `fastStarClusterFiltered` ("Hit" for survivors,
"Not hit" for everyone else — strict subset of fastStar's "Hit" set per
R32, R58, R60). Stage 2's `fastStar` is NOT modified. Surviving rows
additionally get a `clusterSize` column populated with the size of
their natural Levenshtein-1 cluster (non-hit rows get 0).

Output TSV has the input schema + `fastStarClusterFiltered` + `clusterSize`.
Per R60 this template stays pure: caching is keyed on
(stage2Output, clusterMin), independent of threshold.

CLI:
    cluster_filter.py
        --input <tsv>          # Stage 2 output
        --output <tsv>
        --cluster-min <int>    # DBSCAN min_samples (paper default: 10)
        --chain <str>
        [--sample-column <name>]    # defaults to sampleId; pass empty to disable
        [--stats-json <path>]       # write {above, total, beforeCluster} for stats modal (R65)

Per-group structured stdout per R44 — one event per line, prefixed
``[sample <label>, chain <chain>]``.

When --stats-json is given, writes a JSON sidecar with the
cluster-filtered survivor count, the pre-filter hit count (Stage 2's
output), and the total row count — consumed by the stats modal (R65).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

from output_HC import Output  # vendored for paper attribution; we use its lev_metric


HIT = "Hit"
NOT_HIT = "Not hit"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--cluster-min",
        required=True,
        type=int,
        dest="cluster_min",
    )
    parser.add_argument("--chain", required=True)
    parser.add_argument(
        "--sample-column",
        default="sampleId",
        dest="sample_column",
    )
    parser.add_argument("--stats-json", type=Path, dest="stats_json")
    return parser.parse_args()


def log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}")


def cluster_sample(
    sample_hits: pd.DataFrame,
    cluster_min: int,
) -> tuple[dict[int, int], set[int], int]:
    """Cluster one sample's hits by Levenshtein-1 on aa CDR3 and apply
    the cluster_min survivor filter.

    Returns: (cluster_size_by_original_index, survivors_idx, surviving_cluster_count).
      - cluster_size_by_original_index: {original df index -> cluster size}
        for EVERY hit (including those whose cluster is below cluster_min —
        the natural cluster size is reported regardless of the survivor
        threshold, so the column means the same thing across cluster_min
        tweaks).
      - survivors_idx: original df indices of rows whose cluster reached
        cluster_min.
      - surviving_cluster_count: number of distinct clusters that met the
        cluster_min threshold (log info).

    We DON'T use Output.cluster here — its DBSCAN(min_samples=cluster_min)
    label-then-drop pipeline conflates "cluster size" with "survivor". We
    need cluster size to be the natural Levenshtein-1 cluster structure
    (independent of cluster_min) so the column doesn't shift values when
    the user tweaks the threshold. So we call DBSCAN ourselves with
    min_samples=1 (every point is a core point — singletons become
    clusters of size 1, no -1 noise label) and reuse Output.lev_metric
    for the distance.
    """
    if len(sample_hits) == 0:
        return {}, set(), 0
    indexed = sample_hits.reset_index()
    # Deduplicate by aaSeqCDR3 BEFORE DBSCAN. compute_neighbours.py
    # left-merges per-aa STAR stats back onto per-(nt-clonotype) rows,
    # so the same aaSeqCDR3 can appear in N consecutive rows (one per
    # nt-variant). Running DBSCAN on those would count nt-variants of
    # one aa CDR3 as a 10-member cluster — the paper's binder
    # definition wants 10 DISTINCT aa CDR3s within Hamming-1. Dedupe →
    # cluster → fan back out so cluster_size is sequence-distinct.
    unique = indexed.drop_duplicates(subset=["aaSeqCDR3"]).reset_index(drop=True)
    data = unique["aaSeqCDR3"]
    X = np.arange(len(data)).reshape(-1, 1)
    labels = DBSCAN(
        metric=lambda x, y: Output.lev_metric(x, y, data),
        eps=1,
        min_samples=1,
    ).fit(X).labels_
    sizes_by_label: dict[int, int] = (
        pd.Series(labels).value_counts().astype(int).to_dict()
    )
    size_by_cdr3: dict[str, int] = {
        str(unique.iloc[i]["aaSeqCDR3"]): sizes_by_label[int(label)]
        for i, label in enumerate(labels)
    }
    cluster_size_by_idx: dict[int, int] = {
        int(row["index"]): size_by_cdr3[str(row["aaSeqCDR3"])]
        for _, row in indexed.iterrows()
    }
    survivors_idx = {
        idx for idx, size in cluster_size_by_idx.items() if size >= cluster_min
    }
    surviving_cluster_count = sum(
        1 for size in sizes_by_label.values() if size >= cluster_min
    )
    return cluster_size_by_idx, survivors_idx, surviving_cluster_count


def main() -> int:
    args = parse_args()
    t0 = time.monotonic()

    df = pd.read_csv(args.input, sep="\t")

    required = {"fastStar", "aaSeqCDR3", "Nb_freq"}
    missing = required - set(df.columns)
    if missing:
        print(f"error: input TSV missing required columns: {sorted(missing)}")
        return 2

    # Initialise additive columns:
    #   fastStarClusterFiltered: "Not hit" by default; survivors flip to "Hit"
    #     (R25 / R32 / R58: strict subset of fastStar's "Hit" set)
    #   clusterSize: 0 by default; populated for ALL hits below
    df["fastStarClusterFiltered"] = NOT_HIT
    df["clusterSize"] = 0

    sample_col = args.sample_column.strip() if args.sample_column else ""
    grouping = bool(sample_col) and sample_col in df.columns
    label_col = "sampleLabel" if "sampleLabel" in df.columns else None

    hits_before_total = int((df["fastStar"] == HIT).sum())
    survivors_idx: set[int] = set()
    surviving_clusters_total = 0

    def _write_stats(above: int, total: int, before_cluster: int) -> None:
        if args.stats_json is None:
            return
        args.stats_json.parent.mkdir(parents=True, exist_ok=True)
        args.stats_json.write_text(json.dumps({
            "above": above,
            "total": total,
            "beforeCluster": before_cluster,
        }))

    if hits_before_total == 0:
        # Nothing to cluster anywhere — pass through unchanged. Still
        # need to write stats.json so the model output can resolve it
        # (LC data is commonly sparse — sub-nMin → zero hits — and we
        # mustn't break the downstream resolver on that path).
        print(
            f"[chain {args.chain}] no hits to cluster; passing through unchanged"
        )
        df.to_csv(args.output, sep="\t", index=False)
        _write_stats(above=0, total=int(len(df)), before_cluster=0)
        return 0

    if grouping:
        for sample_id, group in df.groupby(df[sample_col].astype(str), sort=True):
            sample_hits = group[group["fastStar"] == HIT]
            display = (
                str(group[label_col].iloc[0])
                if label_col and len(group) > 0 and pd.notna(group[label_col].iloc[0])
                else sample_id
            )
            prefix = f"[sample {display}, chain {args.chain}]"
            hits_before = len(sample_hits)
            if hits_before == 0:
                log(prefix, "no hits to cluster")
                continue
            sizes_by_idx, sample_survivors, surviving_clusters_local = cluster_sample(
                sample_hits, args.cluster_min
            )
            # clusterSize: populated for ALL hits (independent of cluster_min)
            # so the column doesn't shift when the user tweaks the threshold.
            for original_idx, cluster_size in sizes_by_idx.items():
                df.at[original_idx, "clusterSize"] = cluster_size
            survivors_idx.update(sample_survivors)
            hits_after = len(sample_survivors)
            surviving_clusters_total += surviving_clusters_local
            if hits_after > 0:
                log(
                    prefix,
                    f"cluster-min={args.cluster_min} hits: {hits_before} → {hits_after} "
                    f"({surviving_clusters_local} surviving clusters)",
                )
            else:
                log(
                    prefix,
                    f"cluster-min={args.cluster_min} hits: {hits_before} → 0 "
                    "(no clusters reached min_samples)",
                )
    else:
        hits_df = df[df["fastStar"] == HIT]
        prefix = f"[chain {args.chain}]"
        sizes_by_idx, survivors_idx, surviving_clusters_total = cluster_sample(
            hits_df, args.cluster_min
        )
        for original_idx, cluster_size in sizes_by_idx.items():
            df.at[original_idx, "clusterSize"] = cluster_size
        log(
            prefix,
            f"cluster-min={args.cluster_min} hits: {hits_before_total} → {len(survivors_idx)}",
        )

    # Mark survivors in the additive column. fastStar itself is untouched
    # — R32 / R58 require the cluster filter to be additive, not
    # replacement: downstream consumers comparing runs across toggle
    # states see a consistent fastStar signal, with the filtered version
    # surfaced explicitly when present.
    survivor_mask = df.index.isin(survivors_idx)
    df.loc[survivor_mask, "fastStarClusterFiltered"] = HIT

    hits_after_total = int((df["fastStarClusterFiltered"] == HIT).sum())
    print(
        f"[chain {args.chain}] cluster-min={args.cluster_min} "
        f"total hits: {hits_before_total} → {hits_after_total} "
        f"({surviving_clusters_total} surviving clusters across all samples)"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, sep="\t", index=False)

    _write_stats(
        above=hits_after_total,
        total=int(len(df)),
        before_cluster=hits_before_total,
    )

    elapsed = time.monotonic() - t0
    print(f"[chain {args.chain}] elapsed: {elapsed:.2f}s")
    print(f"[chain {args.chain}] cluster-filter done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
