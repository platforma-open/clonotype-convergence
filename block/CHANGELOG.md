# @platforma-open/milaboratories.clonotype-convergence

## 1.4.0

### Minor Changes

- 21ab756: Migrate onto the structurer and take the full SDK upgrade (block-tools 2.14.3, tengo-builder 4.0.23, model 1.83.0, ui-vue 1.83.3), porting the model onto the 1.83 column-discovery and column-selector APIs.

  Adds the mandatory block kind. Its init-params contract is the dataset pick plus every analysis setting, so a project template can seed a fully configured Clonotype Convergence block.

## 1.3.1

### Patch Changes

- a11a244: prepublish script

## 1.3.0

### Minor Changes

- e5fa413: Add parallel fast-STAR + full-STAR convergence with a clonotype-only aggregated export (A-0003/A-0011/A-0012 v2) — the downstream-consumable convergence signal.

  **fast-STAR and full-STAR run in parallel, emitted side by side (A-0003 v2).** fast-STAR is the always-on baseline computed on every processed chain; full-STAR is _added_ per chain wherever that chain's Generation Probability is available. They carry distinct v1-style names — method lives in the name, not a domain key — so v1 consumers (the lead-selection in-vivo preset) resolve fast-STAR unchanged: fast-STAR = `nbFreq` (score) + `fastStar` (hit) + `neighbours`; full-STAR = `fullStarScore` (−log10 p) + `fullStar` (hit). A clonotype seen in several samples collapses to one value per column on the clonotype-only axis (A-0006), per emitted mode. The pool export carries each emitted mode's aggregated score + hit plus the full per-sample `neighbours` column (both `sampleId` and clonotypeKey axes).

  - **Software:** new `aggregate` entrypoint, parameterised by `--score-column`/`--hit-column`/`--method` and called once per emitted mode. Two-level shape — eligibility filter → unit assignment → within-unit collapse (max) → across-unit aggregate. The aggregated score is a reproducibility-aware blend of two percentile ranks across clonotypes: `w·pct(peak) + (1−w)·pct(support)`, where `peak` is the clone's strongest per-donor convergence and `support` is its cross-donor hit count; no independence grouping → `support` undefined → `pct(peak)` alone. Private / low-support clones are downranked but never emptied. The aggregated hit is the `≥ k` partial conjunction with Benjamini-Hochberg across clonotypes at `alpha`. Unit-tested (incl. the w=1 / w=0 ranking flip and the BH edge case below).
  - **Workflow:** Stage 2 runs fast-STAR on every chain and adds full-STAR per chain where Pgen is present, emitting both per-sample column sets. Stage 4 aggregates each emitted mode independently to the clonotype-only axis as `exports.*` and as model-facing outputs. The optional sample-metadata columns (timepoint filter, biological-replicate grouping) are resolved BY REF — the refs in args establish the samples-block dependency, like the Pgen ref. `neighbours` is per-sample only (kept in the pool export by operator request).
  - **Model / UI:** the fast-STAR nb_freq thresholds are always shown (fast-STAR always runs); the "Process light chain" checkbox is the user's free choice (no disable-on-mixed-Pgen). An always-visible aggregation settings section — a timepoint filter (metadata column + value multiselect) and a biological-replicate grouping; setting the grouping turns on cross-donor reproducibility (k=2) and the support half of the score. Advanced adds the reproducibility weight (default 0.5) + the FDR target `alpha`. The Main table shows all present modes' aggregated columns default-visible, with clonotype-keyed enrichment (MiXCR context available in the column panel). Two selector-driven distribution chart pages (aggregated + per-sample) replace the per-chain histogram routes — the Y-axis offers every score across chain × mode; grouping is the matching hit; the threshold line shows only for the fast-STAR score. A per-chain "full-STAR not computed" banner appears where Pgen is absent. Stats report per chain × per mode.

  **Chain-domain fix:** convergence columns now stamp the correct chain domain per mode — single-cell uses the column-domain `pl7.app/vdj/scClonotypeChain` letter (`A`/`B`), matching the SC clonotype-key convention (gen-prob's Pgen, MiXCR siblings); bulk keeps `pl7.app/vdj/chain`. Previously SC columns carried a bulk-style `pl7.app/vdj/chain`, which broke enrichment against SC siblings.

  **Stats:** the hit-statistics badge counts the aggregated, clonotype-only export — convergent clonotypes / total clonotypes, reported per chain × per emitted mode — instead of summing per-sample hits (which counted a shared clonotype once per sample).

  **Automatic Generation Probability detection:** Pgen availability + refs are now re-discovered from the live result pool every render (`pgenStatus` output) and mirrored into the dataset snapshot by a UI watcher, instead of being frozen at dataset-pick time. Generation Probability added, removed, or re-created (new blockId) after the pick is picked up automatically — full-STAR toggles and the ref refreshes with no re-pick. Fixes the failure where a stale/dead Pgen ref made full-STAR silently produce 0 hits.

  **Benjamini-Hochberg fix (`full_star.py` + `aggregate.py`):** the crossing loop started at the second ordered p-value, so a test set where even the smallest p-value failed its own BH threshold still forced the lowest-p clonotype to `Hit`. The loop now tests from rank 1 with the correct 1-based threshold `(rank/m)·alpha`, yielding zero hits when nothing is significant. The STAR reference (M1 golden) still matches exactly.

  Deferred (A-0011, future work, not blocking): mean/median within-unit collapse, the large-cohort α-trim, and multi-column/tuple independence grouping.

### Patch Changes

- Updated dependencies [e5fa413]
  - @platforma-open/milaboratories.clonotype-convergence.workflow@1.3.0
  - @platforma-open/milaboratories.clonotype-convergence.model@1.3.0
  - @platforma-open/milaboratories.clonotype-convergence.ui@1.3.0

## 1.2.1

### Patch Changes

- Updated dependencies [e69537f]
- Updated dependencies [b8f8e6e]
- Updated dependencies [a257782]
- Updated dependencies [3d00629]
- Updated dependencies [0937ac2]
- Updated dependencies [ae3958a]
- Updated dependencies [d5498c4]
  - @platforma-open/milaboratories.clonotype-convergence.model@1.2.1
  - @platforma-open/milaboratories.clonotype-convergence.ui@1.2.1
  - @platforma-open/milaboratories.clonotype-convergence.workflow@1.2.1

## 1.2.0

### Minor Changes

- fa2898c: Add single-sample convergence export for antibody lead selection.

  A new "Sample to export" setting collapses the chosen sample's convergence
  columns (neighbour count, neighbour frequency, hit flag) onto a clonotype-only
  axis — dropping the per-sample axis that lead selection rejects — and exports
  them under their own column family. Nothing exports until a sample is picked
  and the block is re-run, so the choice stays explicit; the sample name lives in
  the column labels and trace.

  The multi-sample family stays internal to the block: it drives the in-block
  table and histograms, but is not exported to the result pool — downstream
  consumers enrich by clonotype key, never by the per-sample axis, so the
  single-sample family is the only convergence data the block exposes
  downstream. The collapse runs in a pure template.

### Patch Changes

- Updated dependencies [50125af]
- Updated dependencies [e0fbaba]
- Updated dependencies [eaaa9fd]
- Updated dependencies [b7e5dab]
- Updated dependencies [fa2898c]
  - @platforma-open/milaboratories.clonotype-convergence.workflow@1.2.0
  - @platforma-open/milaboratories.clonotype-convergence.model@1.2.0
  - @platforma-open/milaboratories.clonotype-convergence.ui@1.2.0

## 1.1.2

### Patch Changes

- Updated dependencies [8424b69]
- Updated dependencies [bf83c72]
- Updated dependencies [2c8fead]
- Updated dependencies [85090fc]
  - @platforma-open/milaboratories.clonotype-convergence.workflow@1.1.2
  - @platforma-open/milaboratories.clonotype-convergence.model@1.1.2
  - @platforma-open/milaboratories.clonotype-convergence.ui@1.1.2

## 1.1.1

### Patch Changes

- 245e096: minor fixes
- Updated dependencies [245e096]
  - @platforma-open/milaboratories.clonotype-convergence.workflow@1.1.1
  - @platforma-open/milaboratories.clonotype-convergence.model@1.1.1
  - @platforma-open/milaboratories.clonotype-convergence.ui@1.1.1

## 1.1.0

### Minor Changes

- c318d11: Initial release — fast-STAR clonotype convergence detection for BCR repertoires.

  Wraps statbiophys/STAR's neighbour-count algorithm to flag clonotypes under
  convergent selection. Accepts any BCR-compatible MiXCR anchor: bulk heavy,
  bulk light, or single-cell IG (with an explicit "Process light chain"
  opt-in for SC paired data).

  Pipeline runs as three pure-template stages — compute-neighbours
  (threshold-independent, expensive), apply-threshold (Hit / Not hit
  categorical), and an optional cluster filter (paper's binder definition,
  Hamming/Levenshtein-1 single-linkage). Outputs a per-(sample, clonotype)
  table with a sample picker above it, two per-chain neighbour-frequency
  histograms with a configurable threshold line, and a centered hit-statistics
  modal in the main-page header.

### Patch Changes

- Updated dependencies [c318d11]
  - @platforma-open/milaboratories.clonotype-convergence.model@1.1.0
  - @platforma-open/milaboratories.clonotype-convergence.ui@1.1.0
  - @platforma-open/milaboratories.clonotype-convergence.workflow@1.1.0

## 1.0.0

Initial scaffold.
