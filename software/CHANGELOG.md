# @platforma-open/milaboratories.clonotype-convergence.software

## 1.1.1

### Patch Changes

- 245e096: minor fixes

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
