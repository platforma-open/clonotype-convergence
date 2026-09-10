---
"@platforma-open/milaboratories.clonotype-convergence.software": minor
"@platforma-open/milaboratories.clonotype-convergence.workflow": minor
"@platforma-open/milaboratories.clonotype-convergence.model": minor
"@platforma-open/milaboratories.clonotype-convergence.ui": minor
"@platforma-open/milaboratories.clonotype-convergence": minor
---

MILAB-6650: aggregation rebuilt on named methods + reproducibility columns

The clonotype-only aggregation no longer produces a weighted percentile blend.
Each mode now aggregates with an established, one-line method:

- **full-STAR** — within a replicate, `p_unit = min(1, m · min p)` (Bonferroni,
  computed in `-log10` space); across replicates, Fisher's combination
  `X = −2 Σ ln p_unit ~ χ²(2k)` gives one combined p-value. Both exported
  values come from that same p: `fullStarScore = −log10(combined p)` and the
  hit is Benjamini-Hochberg on it across clonotypes at `alpha`. Score and hit
  are therefore two faces of one quantity — equal scores always mean equal
  verdicts — and at one replicate both reduce to the per-sample result.
- **fast-STAR** — `max` within a replicate, then the **upper median** `nbFreq`
  across the replicates the clone is present in; the hit thresholds that
  aggregated value. The aggregated column therefore keeps v1's percent format
  and its threshold line.
- **New reproducibility columns**, both modes: `fullStarReproducibility` /
  `fastStarReproducibility` = hit-replicates / `D`, where `D` is the eligible
  cohort (replicates with at least one sample passing the expected-at filter;
  QC-failed ones kept). `D` is a per-dataset constant, so the values are
  comparable across clonotypes — a clone hit in one replicate of many reads
  `1/D`, not 100%.
- Absent replicates are never zero-filled: aggregation runs over the units a
  clone is present in.

Settings simplify to match: the **Reproducibility weight** control is gone (the
score has no weight and no percentile), and the FDR target `alpha` is now the
only statistical knob. The replicate grouping is documented for what it now
does — collapse one unit's samples, define the units the score combines across,
and set the reproducibility cohort.

Also in this release:

- On a chain that carries full-STAR, the block's tables hide that chain's
  fast-STAR columns by default. They are still exported and still offered by
  the chart pickers, so the two calls stay comparable.
- First end-to-end block test: Samples & Data → MiXCR → convergence, asserting
  the clonotype-only export, the per-sample QC family and the reproducibility
  ratio against the replicate cohort.
- Stale file headers describing the superseded "full-STAR primary / fast-STAR
  fallback, unified starScore+starHit" design are corrected.
