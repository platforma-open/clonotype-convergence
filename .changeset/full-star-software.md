---
'@platforma-open/milaboratories.clonotype-convergence.software': minor
'@platforma-open/milaboratories.clonotype-convergence.workflow': minor
'@platforma-open/milaboratories.clonotype-convergence.model': minor
'@platforma-open/milaboratories.clonotype-convergence.ui': minor
'@platforma-open/milaboratories.clonotype-convergence': minor
---

Add full-STAR: the FDR-controlled convergence call, now the block's primary signal (fast-STAR retained as a fallback when Pgen is unavailable).

- **Software:** new `full-star` entrypoint vendoring STAR's `output_MC` (`Output_MC` + Poisson tail kernel) — per-clone Poisson test against a Pgen-derived null (`Lambda = CDR3_len·19·Pgen·uniq_nucl`) with Benjamini–Hochberg at FDR target `alpha`. Reproduces STAR's `output_MC` reference at `alpha=0.005` (M1). `cluster_filter` generalized to be method-agnostic (refines the unified `starHit` set). Adds `scipy`.
- **Workflow:** per-chain Pgen is resolved **by reference** — the model locates gen-prob's Pgen column (by name + the dataset's own clonotype axis/chain) and carries its `PlRef` in args, which establishes convergence's dependency on the Generation Probability block so the Pgen data is present in the workflow's context pool (a sibling block's output is otherwise invisible to the bundle). When no Pgen column exists for a chain, the block automatically falls back to fast-STAR (A-0010). Pgen is threaded through the per-sample pack; hit-calling runs full-STAR (primary) or fast-STAR (fallback); unified output columns `neighbours` / `starHit` / `starScore` (+ `starHitClusterFiltered` / `clusterSize` with the filter on) distinguished by the `method` domain (A-0012). v1's single-sample export removed (clonotype-only aggregated export pending Q-0002).
- **Model / UI:** `starHit` / `starScore` replace v1's `fastStar` / `nbFreq`; FDR target `alpha` added (Advanced, default 0.005). Method (full- vs fast-STAR) is decided per chain from a dataset-facts **snapshot** captured at input-pick time (Pgen availability), so the args lambda, UI, and workflow always agree; the same snapshot carries the Pgen ref that wires the gen-prob dependency. Per-chain fast-STAR thresholds are fallback-only (shown only when a chain has no Pgen; `thresholdL` no longer defaults); a fast-STAR fallback banner reflects what actually ran (`ranFallback`); light-chain processing is disabled when heavy and light differ in Pgen availability (mixing methods in one run is unsupported). Single-sample export dropdown removed.

Note: the antibody lead-selection in-vivo preset keys on the old `nbFreq` / `fastStar` names and must be updated to `starScore` / `starHit` (cross-block, tracked separately).
