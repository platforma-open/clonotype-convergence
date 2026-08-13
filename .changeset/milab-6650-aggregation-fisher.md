---
"@platforma-open/milaboratories.clonotype-convergence.software": minor
"@platforma-open/milaboratories.clonotype-convergence.workflow": minor
"@platforma-open/milaboratories.clonotype-convergence.model": minor
"@platforma-open/milaboratories.clonotype-convergence.ui": minor
"@platforma-open/milaboratories.clonotype-convergence": minor
---

MILAB-6650: aggregation rebuilt on named methods (A-0011 v5) + reproducibility columns

The clonotype-only aggregation no longer produces a weighted percentile blend.
Each mode now aggregates with an established, one-line method, and every
exported value stays on its per-sample statistic's own scale:

- **full-STAR** — within a donor, `p_unit = min(1, m · min p)` (Bonferroni,
  computed in `-log10` space); across donors, Fisher's combination
  `fullStarScore = Σ −log10 p_unit`. The hit is that same statistic's own
  significance: `X = −2 Σ ln p_unit ~ χ²(2k)` → Benjamini-Hochberg across
  clonotypes at `alpha`. Score and hit are two faces of one p-value; at one
  donor both reduce to the per-sample result.
- **fast-STAR** — `max` within a donor, then the **upper median** `nbFreq`
  across the donors the clone is present in; the hit thresholds that aggregated
  value. The aggregated column therefore keeps v1's percent format and its
  threshold line.
- **New reproducibility columns**, both modes: `fullStarReproducibility` /
  `fastStarReproducibility` = hit-donors / `D`, where `D` is the eligible-donor
  cohort (donors with at least one sample passing the expected-at filter;
  QC-failed donors kept). `D` is a per-dataset constant, so the values are
  comparable across clonotypes — a clone hit in one donor of many reads `1/D`,
  not 100%.
- Absent donors are never zero-filled: aggregation runs over the units a clone
  is present in.

Settings simplify to match: the **Reproducibility weight** control is gone (the
score has no weight and no percentile), and the FDR target `alpha` is now the
only statistical knob. The replicate grouping is documented for what it now
does — collapse a donor's samples, define the units the score combines across,
and set the reproducibility cohort.

Also in this release:

- On a chain that carries full-STAR, the block's tables hide that chain's
  fast-STAR columns by default (A-0015). They are still exported and still
  offered by the chart pickers, so the two calls stay comparable.
- First end-to-end block test: Samples & Data → MiXCR → convergence, asserting
  the clonotype-only export, the per-sample QC family and the reproducibility
  ratio against the donor cohort.
- Stale file headers describing the superseded "full-STAR primary / fast-STAR
  fallback, unified starScore+starHit" design are corrected.
