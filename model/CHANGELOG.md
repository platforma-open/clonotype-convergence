# @platforma-open/milaboratories.clonotype-convergence.model

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

- b7e5dab: Settings-panel UX hardening.

  - Auto-close the Settings panel on a committed Run via a new `runArgsId` output
    (canonicalized `activeArgs`) instead of watching the `isRunning` edge. The
    `isRunning` false→true edge raced on the running-state sync and was missed for
    fast / cached recomputes (threshold or export-sample changes), so the panel
    intermittently stayed open after Run.
  - Keep the already-selected input dataset in `datasetOptions` unconditionally.
    Post-run pool churn could briefly fail its CDR3-readiness gate and drop it
    from the options, making the `required` dropdown reconcile to another dataset
    — a transient input flip (e.g. IG Heavy → IG Light) with a spurious "no BCR
    chain" alert that healed when the pool settled. The gate still applies to
    datasets that aren't currently selected.

## 1.1.2

### Patch Changes

- bf83c72: Exclude convergence columns produced by other instances of this block from the
  main table. The table's anchor enrichment pulls every column sharing the
  clonotype axes from the result pool, which surfaced duplicate convergence
  columns when another convergence block was upstream. The discovered columns are
  now filtered in the model by the `pl7.app/block` domain — keeping this block's
  own convergence columns plus all non-convergence enrichment, dropping other
  instances'.
- 2c8fead: Separate the dataset name from the settings in the page subtitle with " - " so
  the commas inside the settings part (threshold, nMin, cluster filter) don't blur
  into the dataset name.
- 85090fc: Encode the block's settings (threshold(s), nMin when non-default, cluster
  filter) into the column trace label so downstream blocks (graph-maker,
  data-mapping) can tell apart columns from multiple convergence blocks on the
  same dataset — previously they collapsed to identical labels. The page
  subtitle and the trace label now derive from one shared builder
  (getDefaultBlockLabel): the subtitle prefixes the dataset, the trace omits it
  (the dataset is already in the column domain). A user-set block label still
  overrides both.

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
