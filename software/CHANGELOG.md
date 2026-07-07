# @platforma-open/milaboratories.clonotype-convergence.software

## 1.1.4

### Patch Changes

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

- d5498c4: Drop the unused abundance value from the per-sample packed input. The convergence math uses only the CDR3 sequences (STAR weights by nt-per-aa multiplicity, not read abundance), so the packed carrier is now `aaSeqCDR3|nSeqCDR3`. Abundance still takes part in the pack-input join to supply the sampleId axis (it is the sole 2-axis column), but its value is no longer packed or handed to compute_neighbours. This changes the packed-column content, so existing projects recompute the per-sample step once; results are unchanged.

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
