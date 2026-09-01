# @platforma-open/milaboratories.clonotype-convergence.model

## 1.4.0

### Minor Changes

- 21ab756: Migrate onto the structurer and take the full SDK upgrade (block-tools 2.14.3, tengo-builder 4.0.23, model 1.83.0, ui-vue 1.83.3), porting the model onto the 1.83 column-discovery and column-selector APIs.

  Adds the mandatory block kind. Its init-params contract is the dataset pick plus every analysis setting, so a project template can seed a fully configured Clonotype Convergence block.

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

- 3d00629: Don't offer scFv datasets in the input dropdown. scFv clonotyping output is an engineered single-chain (VH-linker-VL) construct that passes as SC-paired IG, so it would otherwise be selectable and silently produce meaningless per-chain convergence — but convergence is for in-vivo repertoires only. Excluded via the `pl7.app/vdj/scFv-sequence` column (the platform's scFv marker), not the unfinished `scClonotypeKey/structure` domain placeholder.
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
