---
"@platforma-open/milaboratories.clonotype-convergence.software": minor
"@platforma-open/milaboratories.clonotype-convergence.workflow": minor
"@platforma-open/milaboratories.clonotype-convergence.model": minor
"@platforma-open/milaboratories.clonotype-convergence.ui": minor
"@platforma-open/milaboratories.clonotype-convergence": minor
---

MILAB-6650: the binder cluster filter now covers both hit calls, and reaches the export

The cluster filter refined fast-STAR only. That matched STAR's own
`output_HC.cluster`, which filters `Nb_freq > threshold` — but the block emits
two hit calls side by side, so restricting the binder definition to one of them
left full-STAR without one. It now runs once per emitted mode.

**Per-mode column pairs.** Clusters are computed over the hit subset, so the two
modes genuinely have different cluster structures: a clone can sit in a
12-member cluster of fast-STAR hits and a 3-member cluster of full-STAR hits.
Each mode therefore owns its own pair:

- `fastStarClusterFiltered` + `fastStarClusterSize` (the latter renamed from
  `clusterSize`)
- `fullStarClusterFiltered` + `fullStarClusterSize` (new)

The rename is safe — the per-sample family is internal to the block, so
`clusterSize` was never resolvable from the result pool.

**The result now leaves the block.** The cluster-filtered call was per-sample
only, so it never reached the Main table, the export, or downstream — which
made it invisible to exactly the consumers a "binder" call is for. Each mode now
also exports a clonotype-level pair:

- `<mode>StarClusterFiltered` — the mode's aggregated hit AND a cluster hit in
  at least one replicate. Anchoring on the mode's own aggregated hit keeps the
  cluster call a strict subset of it, the same relationship the two columns have
  per sample.
- `<mode>StarClusterFilteredReproducibility` — cluster-hit replicates over the
  same cohort `D` as every other reproducibility column, so all of them read on
  one scale.

Cluster *size* stays per-sample: there is no defensible single value per
clonotype (max advertises the luckiest sample, median invents a cluster nobody
observed), so it is treated like `neighbours`.

`clusterMin` remains a single setting governing both modes — the cluster
criterion is a property of the CDR3 neighbourhood, not of the hit-calling
method.

**Table visibility follows the mode.** On a chain that carries full-STAR, the
fast-STAR family is demoted to optional and that now includes its cluster
columns, so a refinement is never left visible while the hit it refines is
hidden. full-STAR's cluster columns stay default-visible.
