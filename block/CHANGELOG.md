# @platforma-open/milaboratories.clonotype-convergence

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
