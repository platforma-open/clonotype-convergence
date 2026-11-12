# @platforma-open/milaboratories.clonotype-convergence.kind

## 2.1.0

### Minor Changes

- 3fd8bad: Add a "Keep isotypes" filter: only clonotypes of the selected heavy-chain isotypes are analyzed (IgG in a new block). Other clonotypes, including those of unknown isotype (blank, or MiXCR's "cant_distinguish"), are removed before neighbours are counted; an empty selection keeps every clonotype. On single-cell data the heavy chain's isotype applies to both chains. Offered when the dataset has an isotype column; blocks created before this keep every isotype. Optionally, "Also score against each kept isotype" adds a score and hit per kept isotype (fast-STAR, and full-STAR where Pgen is available): each clone's convergence measured among that isotype's CDR3s only, under new column names (`pl7.app/vdj/convergence/isotype/*`, isotype in the domain), so the main columns are unchanged.

  The Score distribution chart names clonotypes by their label. Updated the SDK (model and UI 1.90.0, workflow-tengo 6.22.3) and graph-maker to 1.10.5. The skipped-sample and per-isotype warnings can be closed and scroll when long; Stats lists the skipped samples too. Per-isotype scores take one neighbour search per sample instead of one per isotype.

## 2.0.0

### Major Changes

- b4a6935: Columns are stored by their result-pool column ids: the dataset and its subset, the Generation Probability columns found for the dataset, and the expected-filter and replicate metadata columns. The expected values are stored as column value references of the expected-filter column, so the block that produced the metadata knows which of its values this block uses. The model finds columns, builds the options of the metadata pickers and reads the sample labels through the column collection API instead of the deprecated result pool API, and the workflow takes every column through its column bundle by id. The expected-values picker reads the values of the expected-filter column through the value options the model gives for it, and shows why under the picker when they cannot be read.
  Opening a project created before this change keeps its dataset, subset, expected-filter and replicate columns, converted to the new ids, and keeps its expected values, converted to column value references of the same expected-filter column. Expected values stored without an expected-filter column name no column and are cleared. A stored column that is not a reference to an upstream output is cleared, and a dataset cleared this way takes its details with it; the Generation Probability availability follows the columns kept. The initialization params of the kind carry the same ids and references, so templates made for an earlier version of the kind cannot be applied.
  Expected values that are no longer among the values of the expected-filter column stay selected and are marked as not available instead of being removed silently, with a tooltip naming the block that was to provide them, as a link to it, and what went wrong. Picking another expected-filter column now clears the expected values.

## 1.2.0

### Minor Changes

- ee77937: Allow selection of filtered data

## 1.1.0

### Minor Changes

- bd47f85: MILAB-6650: aggregation rebuilt, memory scaled with the data, tests reworked

  ### Aggregation and statistics

  - The clonotype-only aggregation drops the weighted percentile blend. Each mode
    aggregates by a named method: full-STAR collapses replicates with Bonferroni
    in `-log10` space and combines across them with Fisher
    (`X = -2 Σ ln p_unit ~ χ²(2k)`); fast-STAR takes the max within a replicate
    and the upper median across them.
  - `fullStarScore` is `-log10(combined p)` and the hit is Benjamini-Hochberg on
    that same p — score and hit are one quantity. BH is step-up, not
    first-crossing.
  - Each mode exports a reproducibility column: hit-units / D, where D is the
    eligible cohort over the whole sample universe, QC-failed units included.
  - `Pgen == 0` is tested rather than dropped (a valid null: rate 0.2 via the
    pseudocount). Only `NaN` Pgen stays untestable. `fullStarScore` is floored at
    each sample's smallest positive p-value, so underflowed clones get a finite
    on-scale score instead of `+inf`. Raw `Pvalue` is unchanged.
  - The binder cluster filter runs once per emitted mode and reaches the export;
    each mode gets its own filtered/size column pair, since cluster structure
    differs between the two hit sets. Cluster size stays per-sample.
  - `scoreWeight` is gone from the data model, the kind's `BlockParams`, its
    runtime parser and `templateParams`. A template still carrying one is
    rejected rather than ignored.

  ### Run gating and tables

  - Dataset validation moved from the dropdown to the args lambda: missing aa/nt
    CDR3, missing abundance, or no detected chain disables Run with a reason.
    The dropdown no longer hides datasets while another block is running.
  - Only the anchor is passed as a primary column, so visibility rules apply to
    the rest — previously every column was primary and every rule was inert.
  - `aggregate.py` requires `--score-column` / `--hit-column` /
    `--reproducibility-column` instead of defaulting to retired v1 names.

  ### Memory

  - Every compute budget is now sized from the data; no static `mem` remains in
    the workflow. Steps that reach a pt workflow leave it unset (SDK default);
    the python steps use `exec.formula` over their own input.
  - Neighbour density is computed over the per-aa table. The multiplicity
    collapse and the fan-back-out to clonotype rows moved into ptabler, so
    `compute_neighbours.py` never sees an nt CDR3 or a clonotype key and its
    memory tracks unique aa CDR3s rather than clonotypes. `Get_df` loses the
    unused `frequency()` and the dict round-trips. The statistic is unchanged and
    pinned to STAR's published reference.
  - `compute_neighbours` budget: `lineCount × 4096 + 1GiB`, clamped
    `[1GiB, 32GiB]` — measured 3.8 KiB/row at 100K rows, 2.7 KiB/row at 1M.
  - `aggregate.py` reads only the four columns it uses (`usecols`) and holds
    sampleId and the hit column as `category`; the unit is attached through the
    category codes instead of an inner merge over every row. Measured peak falls
    to 198 B/row at 18M rows. Budget: `lineCount × 512 + 1GiB`, `[1GiB, 32GiB]`.
    The Level 1 groupby passes `observed=True`, without which absent units are
    emitted as rows and silently zero-fill the aggregation.
  - full-STAR and the cluster filter size from input bytes
    (`size × 8 + 1-2GiB`); the cluster filter's memory is flat in hit count, its
    runtime quadratic (~1.6 µs/pair).
  - `processColumn` no longer pins `cpu`/`mem`, so the per-sample output import
    scales with the sample.

  ### UI

  - "Convergence expected at" and its value picker render as one joined control
    (`group-position` top/bottom, borders overlapped). The lower dropdown has no
    label and no placeholder.

  ### Tests

  - The end-to-end block test is replaced by template-level `tplTest` coverage of
    the per-sample chain (pt collapse → `compute_neighbours.py` → pt inner join):
    neighbour arithmetic and fan-back-out, empty-CDR3 rows dropped without
    shifting N, and the `nMin` skip. `test-per-sample.tpl.tengo` feeds it a
    PColumn, which a test cannot construct directly.
  - Removed with it: the `test` package, its five cross-block dependencies and
    6MB of FASTQ fixtures. The suite runs in ~17s instead of a MiXCR run with a
    900s timeout. No longer covered: dataset discovery against real MiXCR specs,
    and rendering of the model's tables in a real project.
  - The software package's 60 pytest tests now run under `turbo run test`. The
    runner script provisions its own environment (uv preferred, venv fallback)
    and fails rather than skipping if neither is available. CI has no uv, so the
    venv path is the one that runs there.
