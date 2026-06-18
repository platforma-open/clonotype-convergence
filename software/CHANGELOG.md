# @platforma-open/milaboratories.clonotype-convergence.software

## 1.1.3

### Patch Changes

- 50125af: Anonymize the per-sample abundance before the heavy neighbour pipeline so identical datasets deduplicate across projects: Stages 1-3 (compute-neighbours, apply-threshold, cluster-filter) become content-identical regardless of project-local sample ids and recover from cache. Real sample ids are restored after the pure stages (main table + single-sample export), and the skipped-samples report is de-anonymized back to human sample labels. Stage logs reference samples by a project-neutral counter (e.g. "3/12") instead of the anonymized id, keeping logs live-streamed and dedup-safe.
- e0fbaba: Replace the apply-threshold Python step with an in-graph `pt` transform.

  Stage 2 (threshold → `fastStar`) was a pandas read/rewrite of the full
  multi-sample TSV — minutes of I/O on large projects. It now runs as a pure
  `pt` (ptabler) template: `fastStar = Nb_freq > threshold`, with the hit-count
  stats emitted as a one-row ndjson sidecar (same `{above, total}` contract the
  model reads via `getDataAsJson`). Cheap to recompute, so the stage needs no
  cache TTL and produces no per-variant accumulation. The `apply-threshold`
  software entrypoint and `apply_threshold.py` are removed.

## 1.1.2

### Patch Changes

- 542ba38: update stats

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
