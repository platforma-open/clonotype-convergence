# @platforma-open/milaboratories.clonotype-convergence.ui

## 1.2.1

### Patch Changes

- e69537f: Fix spurious "missing required CDR3 columns" warning that could disable Run after a block reload / dev-block update.

  The input's CDR3/abundance facts are snapshotted into block data at pick time. While the result pool repopulates, the CDR3 sibling columns are transiently absent, so a re-pick in that window could persist a partial snapshot (`hasAaCDR3`/`hasNtCDR3` false), which the args gate and settings alert then trusted — disabling Run until the user re-picked.

  - `args` and the settings alert no longer gate on the churn-prone CDR3/abundance flags. The dataset dropdown only offers CDR3-ready inputs and the workflow hard-requires those columns, so the checks were redundant false-positive sources. A genuinely unavailable input still disables Run via the ref in args (`missingReference`). This also recovers already-affected projects on reopen.
  - `onPickMain` does nothing when the current dataset is re-picked (a re-emit during repopulation can no longer overwrite the good snapshot, and the light-chain pick is no longer cleared on an unchanged dataset). `factsFor` returns a copy so the persisted snapshot doesn't alias the reactive outputs object.

- b8f8e6e: Collapse the dual input-ref data model into a single dataset snapshot.

  There is one input-dataset selector, and in single-cell paired mode both chains are column-domain siblings on the same anchor — so `lightRef` was always equal to the main pick or undefined, and `lightRefFacts` always duplicated the main facts. That vestigial dual-ref structure is removed:

  - `mainRef`/`mainRefFacts`/`mainRefLabel` → `datasetRef`/`datasetFacts`/`datasetLabel`.
  - `lightRef`/`lightRefFacts` → a single `processLightChain` boolean (the light chain rides the same anchor).
  - `UpstreamFacts.axisName` → `clonotypeKeyAxisName` (it is the second/clonotype-key axis name).
  - Removed the unused live `mainRefFacts` model output.

  A `v1 → v2` data migration maps existing projects (carrying `chains`/`clonotypeKeyAxisName` across), so no behaviour changes and no re-pick is required.

- 0937ac2: Logs panel: in dual-chain mode, tab between heavy- and light-chain per-sample logs instead of stacking them, with settings-consistent "Heavy-chain" / "Light-chain" labels (was an uppercase "HEAVY CHAIN" heading).
- ae3958a: Make per-sample dedup the only compute path and remove the whole-dataset
  pipeline (MILAB-6413).

  The convergence computation now fans out per sample via `processColumn` end to
  end, so a project analysing a subset of another project's samples recovers each
  shared sample from cache (and a sample re-keyed under a different sampleId in
  another project still recovers — the per-sample body input carries no sampleId).
  The whole-dataset `compute-neighbours` path — kept only to feed logs and the
  skipped-samples warning — is deleted, ending the double-compute and the
  anonymize / de-anonymize apparatus it required.

  - **Logs** are now per sample: each sample's compute-neighbours stdout is
    captured as saved String content, collected per sampleId, labelled with the
    real sample name in the model, and rendered as a collapsible per-sample list
    (a "Starting…" placeholder shows until each sample finishes).
  - **Skipped-samples warning** is derived model-side from a per-sample status
    sidecar (`{ nUniqueNt, nMin }` per sample) instead of a workflow JSON. It now
    distinguishes samples below the nMin floor (lowering nMin helps) from samples
    with no usable CDR3 (it won't), surfacing a separate alert for each.
  - `compute_neighbours.py` is simplified to single-sample operation (the
    per-sample grouping, neutral-counter logging, and skipped-list machinery were
    whole-dataset concerns) and emits the per-sample status sidecar.
  - Removes the now-dead templates: `compute-neighbours`, `deanonimize-skipped`,
    `apply-threshold`, `cluster-filter`, `deanonimization`.

  **Performance (large projects):**

  - The packed per-sample input is imported as **Parquet**, not JSON — JSON
    storage of one stringified key + value per clonotype dominated the preamble on
    big projects (observed: a 50M-read project stuck >90 min in the import; Parquet
    cut the whole preamble to ~10 min).
  - The whole-dataset join → pack → import preamble runs in a new `pack-input`
    pure template whose packed-column output is **pinned** (24h TTL). This lets a
    second block with the same settings (and project copies) recover the packed
    input instead of rebuilding it, on top of the per-sample compute recovery.

  No change to the convergence algorithm, output column specs, stats badge, or
  single-sample export.

- Updated dependencies [e69537f]
- Updated dependencies [b8f8e6e]
- Updated dependencies [3d00629]
- Updated dependencies [ae3958a]
  - @platforma-open/milaboratories.clonotype-convergence.model@1.2.1

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

- Updated dependencies [b7e5dab]
- Updated dependencies [fa2898c]
  - @platforma-open/milaboratories.clonotype-convergence.model@1.2.0

## 1.1.2

### Patch Changes

- Updated dependencies [bf83c72]
- Updated dependencies [2c8fead]
- Updated dependencies [85090fc]
  - @platforma-open/milaboratories.clonotype-convergence.model@1.1.2

## 1.1.1

### Patch Changes

- 245e096: minor fixes
- Updated dependencies [245e096]
  - @platforma-open/milaboratories.clonotype-convergence.model@1.1.1

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
