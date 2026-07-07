# @platforma-open/milaboratories.clonotype-convergence.workflow

## 1.2.1

### Patch Changes

- a257782: Drop the unused `stats.json` retention from the per-sample cluster-filter step. The sidecar was saved as content but never read (skipped-samples now come from the per-sample `compute_neighbours` status sidecar), so removing `saveFileContent("stats.json")` is functionally a no-op.
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
- Updated dependencies [ae3958a]
- Updated dependencies [d5498c4]
  - @platforma-open/milaboratories.clonotype-convergence.software@1.1.4

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

- 50125af: Anonymize the per-sample abundance before the heavy neighbour pipeline so identical datasets deduplicate across projects: Stages 1-3 (compute-neighbours, apply-threshold, cluster-filter) become content-identical regardless of project-local sample ids and recover from cache. Real sample ids are restored after the pure stages (main table + single-sample export), and the skipped-samples report is de-anonymized back to human sample labels. Stage logs reference samples by a project-neutral counter (e.g. "3/12") instead of the anonymized id, keeping logs live-streamed and dedup-safe.
- e0fbaba: Replace the apply-threshold Python step with an in-graph `pt` transform.

  Stage 2 (threshold → `fastStar`) was a pandas read/rewrite of the full
  multi-sample TSV — minutes of I/O on large projects. It now runs as a pure
  `pt` (ptabler) template: `fastStar = Nb_freq > threshold`, with the hit-count
  stats emitted as a one-row ndjson sidecar (same `{above, total}` contract the
  model reads via `getDataAsJson`). Cheap to recompute, so the stage needs no
  cache TTL and produces no per-variant accumulation. The `apply-threshold`
  software entrypoint and `apply_threshold.py` are removed.

- eaaa9fd: Annotate the exported convergence columns as scores so lead selection can use
  them in its defaults. Convergent neighbour frequency (`nbFreq`) gets
  `pl7.app/isScore` + `pl7.app/score/rankingOrder: decreasing`, making it a
  discoverable, rankable score. Convergent hit (`fastStar`) gets `pl7.app/isScore`
  - `pl7.app/score/defaultCutoff: ["Hit"]`, so it can serve as a default
    "keep only hits" filter (`string_in` via its existing discrete-value
    annotations). Both annotations propagate to the single-sample export family.
    Lead selection adds these to its in-vivo preset separately, in that block.
- Updated dependencies [50125af]
- Updated dependencies [e0fbaba]
  - @platforma-open/milaboratories.clonotype-convergence.software@1.1.3

## 1.1.2

### Patch Changes

- 8424b69: Cache the compute-neighbours (Stage 1) result with a 24h TTL. Stage 1 is the
  expensive, threshold-independent STAR neighbour computation; without a cache
  hint its intermediate output was reference-counted away once Stage 2 consumed
  it, so changing only the threshold re-ran the whole pipeline. With the TTL, a
  threshold change recovers Stage 1 from cache and recomputes only the cheap
  downstream stages (observed: ~1h → ~10min on a real project).
- 85090fc: Encode the block's settings (threshold(s), nMin when non-default, cluster
  filter) into the column trace label so downstream blocks (graph-maker,
  data-mapping) can tell apart columns from multiple convergence blocks on the
  same dataset — previously they collapsed to identical labels. The page
  subtitle and the trace label now derive from one shared builder
  (getDefaultBlockLabel): the subtitle prefixes the dataset, the trace omits it
  (the dataset is already in the column domain). A user-set block label still
  overrides both.
- Updated dependencies [542ba38]
  - @platforma-open/milaboratories.clonotype-convergence.software@1.1.2

## 1.1.1

### Patch Changes

- 245e096: minor fixes
- Updated dependencies [245e096]
  - @platforma-open/milaboratories.clonotype-convergence.software@1.1.1

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
  - @platforma-open/milaboratories.clonotype-convergence.software@1.1.0
