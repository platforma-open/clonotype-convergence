---
"@platforma-open/milaboratories.clonotype-convergence.kind": minor
"@platforma-open/milaboratories.clonotype-convergence.model": minor
"@platforma-open/milaboratories.clonotype-convergence.software": minor
"@platforma-open/milaboratories.clonotype-convergence.ui": minor
"@platforma-open/milaboratories.clonotype-convergence.workflow": minor
"@platforma-open/milaboratories.clonotype-convergence": minor
---

MILAB-6650: aggregation rebuilt on named methods + reproducibility columns

The clonotype-only aggregation no longer produces a weighted percentile blend.
Each mode now aggregates with an established, one-line method:

- **full-STAR** — within a replicate, `p_unit = min(1, m · min p)` (Bonferroni,
  computed in `-log10` space); across replicates, Fisher's combination
  `X = −2 Σ ln p_unit ~ χ²(2k)` gives one combined p-value. Both exported
  values come from that same p: `fullStarScore = −log10(combined p)` and the
  hit is Benjamini-Hochberg on it across clonotypes at `alpha`. Score and hit
  are therefore two faces of one quantity — equal scores always mean equal
  verdicts — and at one replicate both reduce to the per-sample result.
- **fast-STAR** — `max` within a replicate, then the **upper median** `nbFreq`
  across the replicates the clone is present in; the hit thresholds that
  aggregated value. The aggregated column therefore keeps v1's percent format
  and its threshold line.
- **New reproducibility columns**, both modes: `fullStarReproducibility` /
  `fastStarReproducibility` = hit-replicates / `D`, where `D` is the eligible
  cohort (replicates with at least one sample passing the expected-at filter;
  QC-failed ones kept). `D` is a per-dataset constant, so the values are
  comparable across clonotypes — a clone hit in one replicate of many reads
  `1/D`, not 100%.
- Absent replicates are never zero-filled: aggregation runs over the units a
  clone is present in.

Settings simplify to match: the **Reproducibility weight** control is gone (the
score has no weight and no percentile), and the FDR target `alpha` is now the
only statistical knob. The replicate grouping is documented for what it now
does — collapse one unit's samples, define the units the score combines across,
and set the reproducibility cohort.

Also in this release:

- On a chain that carries full-STAR, the block's tables hide that chain's
  fast-STAR columns by default. They are still exported and still offered by
  the chart pickers, so the two calls stay comparable.
- First end-to-end block test: Samples & Data → MiXCR → convergence, asserting
  the clonotype-only export, the per-sample QC family and the reproducibility
  ratio against the replicate cohort.
- Stale file headers describing the superseded "full-STAR primary / fast-STAR
  fallback, unified starScore+starHit" design are corrected.

MILAB-6650: full-STAR — include Pgen==0 clones and bound fullStarScore

- Pgen==0 is a valid null (Lambda=0 → rate 0.2 via the pseudocount), so those
  clones are now tested rather than dropped to "Not hit" — they are the strongest
  convergent hits. Only NaN Pgen (OLGA could not compute one) stays untestable.
- fullStarScore = -log10(Pvalue) is now derived in full_star.py with a per-sample
  floor at the smallest positive Pvalue, so the strongest / underflowed clones get
  a finite, on-scale score instead of +inf; the workflow passes it through instead
  of recomputing. Raw Pvalue is unchanged, so M1 reproduction is unaffected.

MILAB-6650: the binder cluster filter now covers both hit calls, and reaches the export

The cluster filter refined fast-STAR only. That matched STAR's own
`output_HC.cluster`, which filters `Nb_freq > threshold` — but the block emits
two hit calls side by side, so restricting the binder definition to one of them
left full-STAR without one. It now runs once per emitted mode.

**Per-mode column pairs.** Clusters are computed over the hit subset, so the two
modes genuinely have different cluster structures: a clone can sit in a
12-member cluster of fast-STAR hits and a 3-member cluster of full-STAR hits.
Each mode therefore owns its own pair:

- `fastStarClusterFiltered` + `fastStarClusterSize` (the latter renamed from
  `clusterSize`)
- `fullStarClusterFiltered` + `fullStarClusterSize` (new)

The rename is safe — the per-sample family is internal to the block, so
`clusterSize` was never resolvable from the result pool.

**The result now leaves the block.** The cluster-filtered call was per-sample
only, so it never reached the Main table, the export, or downstream — which
made it invisible to exactly the consumers a "binder" call is for. Each mode now
also exports a clonotype-level pair:

- `<mode>StarClusterFiltered` — the mode's aggregated hit AND a cluster hit in
  at least one replicate. Anchoring on the mode's own aggregated hit keeps the
  cluster call a strict subset of it, the same relationship the two columns have
  per sample.
- `<mode>StarClusterFilteredReproducibility` — cluster-hit replicates over the
  same cohort `D` as every other reproducibility column, so all of them read on
  one scale.

Cluster *size* stays per-sample: there is no defensible single value per
clonotype (max advertises the luckiest sample, median invents a cluster nobody
observed), so it is treated like `neighbours`.

`clusterMin` remains a single setting governing both modes — the cluster
criterion is a property of the CDR3 neighbourhood, not of the hit-calling
method.

**Table visibility follows the mode.** On a chain that carries full-STAR, the
fast-STAR family is demoted to optional and that now includes its cluster
columns, so a refinement is never left visible while the hit it refines is
hidden. full-STAR's cluster columns stay default-visible.

MILAB-6650: drop `scoreWeight` from the block's init-params contract

The aggregation no longer carries a score weight — it scores the combined
p-value directly — so `scoreWeight` is gone from the block's data model. The
kind's `BlockParams` and its runtime parser drop it too, and `templateParams`
stops projecting it. A template that still carries a `scoreWeight` value is
rejected by the parser rather than silently ignored.

MILAB-6650: refuse to run on a dataset the workflow can't process, plus cleanup

The input dataset used to be validated in the dropdown: a dataset was offered
only once its aa/nt CDR3 and abundance siblings were discoverable. That gate was
removed because it hid valid datasets for as long as any other block in the
project was running — but it was also the only thing keeping an unprocessable
dataset away from the Run button, so the block would start and fail deep in the
workflow instead.

The check now lives in the args lambda, which is where Run-gating belongs:

- no aa/nt CDR3, or no abundance → Run is disabled with the reason, and the
  dropdown still lists every BCR dataset;
- no BCR chain detected → Run is disabled. Previously this filled neither chain
  slot, the workflow skipped both chain branches, and the block reported
  success with no outputs at all.

Validating here reads the pick-time snapshot rather than a live pool query, so
it can't flicker while an unrelated block runs — the failure mode that forced
the original gate out.

Other changes, no behaviour attached:

- `aggregate.py` requires `--score-column` / `--hit-column` /
  `--reproducibility-column` instead of defaulting them to retired v1 names.
  Those flags select which mode is aggregated and name the output columns, so a
  default silently aggregates the wrong mode rather than failing.
- Dead code removed: an unused `scipy.stats.chi2` import, the never-read
  `settingsOpen` / `logsOpen` block-data fields, and a workflow-side `alpha`
  fallback that duplicated the model's default.
- Duplication collapsed in the model — the two per-sample log outputs, the four
  distribution p-frame outputs, the two table column filters and the four hit
  stats resolvers now share named helpers.
- Comments corrected where they described code that no longer exists, including
  a per-sample light-chain table that was never built.

MILAB-6650: make the tables' column visibility actually apply

Two bugs, both visible as "the table shows the wrong columns".

**Every column was a primary column, and primary columns ignore visibility
rules.** `createPlDataTableV3` filters only the non-primary sets against the
visibility rules, and column discovery classes every zero-hop column as primary.
Both tables discover with `maxHops: 0`, so everything was primary and no rule
had any effect: the fast-STAR demotion on a full-STAR chain, the "enrichment
starts optional" default, and the per-sample hidden rule were all inert — which
is why upstream MiXCR columns arrived visible by default.

Only the anchor is passed as a primary column now; everything else goes through
the regular column set. The anchor is also chosen per availability — full-STAR's
hit column where the chain has one, else fast-STAR's — since the anchor is
permanently visible and should therefore be the call being foregrounded.

**A saved column layout outlived the columns it named.** The persisted
hidden-column list replaces the rule-derived one instead of merging with it, so
a layout captured while full-STAR existed kept hiding the fast-STAR family after
the Generation Probability block was removed. With full-STAR gone as well, the
table rendered every value column hidden — 70k rows of clone ids.

The table's source identifier now covers which column families a run emits
(chains processed, full-STAR per chain, cluster filter), not just the dataset,
so any change to the set of existing columns resets the layout. The trade-off is
that those transitions also reset manual column choices and sort order for that
table, exactly as a dataset change already did.

**The sample picker described a different run from the table under it.** The
per-sample table's sheet selector was built from the dataset currently selected
in Settings, while the table itself is built from the args that produced the
current rows. Selecting another dataset without pressing Run therefore listed
the new dataset's samples above the old dataset's data. The picker now reads the
same committed args as the table.

Column discovery in both tables now goes through `ColumnsCollection` rather
than the older `discoverTableColumnSnaphots` helper, and the Generation
Probability columns are excluded in the discovery selector instead of being
filtered out in JS afterwards. One behavioural consequence: the hit anchor is
now read from the block's own output collection, so a table renders with its
anchor column even when enrichment finds nothing to add — previously the whole
table disappeared in that case.

MILAB-6650: size the whole-dataset preamble's compute budget from its input

The preamble packer asked for a fixed `cpu(2)` / `mem("4GiB")` on all three of
its steps — the `tsvFileBuilder` join, the pt encode and the Parquet import.
That is the only part of the block whose input grows with the whole project;
everything else runs inside the per-sample `processColumn` fan-out, where a
constant budget is correct.

The k8s runner enforces a declared request as a hard container limit, so on a
large project the join was OOM-killed (`ptabler` exited with code -1) before
the fan-out ever started, and the failure surfaced as an input-error chain up
to `heavyAggregatedPf`. The local runner treats the same number as a scheduling
soft limit, which is why desktop was unaffected.

All three requests are now left undefined, so the SDK sizes them from the
actual input (ram = 4*size + 2GiB clamped to [2GiB, 64GiB], cpu = size/16GiB + 2
clamped to [2, 8]) instead of pinning them to the bottom of that range.

MILAB-6650: size the per-sample compute budgets from each sample's input

`compute_neighbours.py` was OOM-killed on k8s at its fixed 4GiB once the
preamble stopped failing ahead of it. A per-sample constant is only correct if
it fits the *largest* sample, and 4GiB does not on large projects.

The two pt steps (unpack, hit calling) drop their explicit budgets and fall
back to the SDK's size-adaptive default. The two python steps get an
`exec.formula` over their own input TSV:

- compute-neighbours: `size * 16 + 2GiB`, floored at 4GiB, capped at 32GiB.
  `get_df.py` holds an `atriegc` trie over the sample's unique aa CDR3s, four
  dicts keyed by the same strings, and a merge that rebuilds the frame —
  measured against the TSV's byte count that is roughly 10x, so 16x carries
  headroom.
- full-STAR: `size * 8 + 2GiB`, floored at 2GiB, capped at 32GiB. Numpy arrays
  over the row count, no string-keyed structures.

The 32GiB cap and both multipliers are unverified against a real large project
— they are floors-with-headroom, not measurements, and should be tuned once a
run on the failing project reports actual usage. The cap in particular should
be checked against the cluster's node pool and any `maxRamRequest` setting,
which silently shrinks a larger request before k8s enforces it as a limit.

Changing the compute-neighbours budget invalidates that step's `cacheHours(24)`
pin once, since the quota is part of the rendered template's inputs.

The cluster-filter step keeps its fixed 4GiB: its memory is quadratic in the
hit count (DBSCAN with a callable metric materialises a full pairwise distance
matrix), so a linear formula would not bound it. Tracked separately.

MILAB-6650: compute neighbour density over the per-aa table, not the clonotype table

compute-neighbours was OOM-killed on a 15.7M-clonotype sample (an unselected
phage-display library) regardless of the budget it was given. The step held the
whole sample in Python objects at once — ~47M string objects from the initial
read, two `nunique()` hash sets, four 10M-entry dicts built by calling
`set_index().to_dict()` twice to use two of them, and a final 15.7M-row pandas
`merge` on a string key — for a statistic that only reads unique aa CDR3s and
their nt multiplicities. Peak was tens of GB and scaled with clonotype count.

Both ends now run in ptabler, which streams and spills:

- **Before** the step, the per-sample pt workflow drops null/empty CDR3s and
  collapses to one row per unique aa CDR3 with `multiplicity =
  n_unique(nSeqCDR3)`, saved as `per_aa.tsv`.
- **After** it, a pt inner join fans the per-aa stats back onto the clonotype
  rows on `aaSeqCDR3`, producing the same `neighbours.tsv` the rest of the
  per-sample chain already consumed.

`compute_neighbours.py` therefore reads `per_aa.tsv` and writes
`per_aa_stats.tsv`; it never sees an nt CDR3 or a clonotype key, and its memory
tracks unique aa CDR3s instead of clonotypes. Its RAM budget is now driven by
`lineCount` rather than file size, since the cost is per row.

The statistic is unchanged. `test/test_get_df_equivalence.py` pins the rewritten
`Get_df` to STAR's own test input and published per-aa reference
(`data/star_Test.tsv` / `data/star_df_read_test_golden.tsv`), asserting identical
Multiplicity, Neighbours and Nb_freq, and that N — Nb_freq's denominator — is
the sum of the multiplicity column.

Behaviour preserved: the inner join drops rows with null/empty CDR3s exactly as
the old pandas filter did, and a sample skipped for `nMin` emits empty stats, so
the join yields an empty `neighbours.tsv` and the sample drops out as before.
`status.json` still carries `{nUniqueNt, nMin}` with the same meaning.

Two removals, neither observable: `Get_df.frequency()` (a per-aa share of
clonotype rows that nothing consumed, and which is not derivable from the per-aa
input), and the "input rows" / "dropped N rows" log lines, which counted rows the
step no longer sees. The nMin skip and small-sample warning lines are unchanged.

The cluster-filter step is untouched and still holds a fixed 4GiB; its memory is
quadratic in the hit count (DBSCAN with a callable metric builds a full pairwise
distance matrix), which is a separate problem.

MILAB-6650: correct the compute-neighbours budget to the measured per-row cost

The per-aa rewrite made memory scale with unique aa CDR3s, but the budget that
went with it guessed 1KiB per row. Measured on the real code path (synthetic
CDR3-shaped input, peak RSS of the child process):

    100,000 rows ->  378 MB  (3.8 KiB/row)
    300,000 rows ->  928 MB  (3.1 KiB/row)
  1,000,000 rows -> 2721 MB  (2.7 KiB/row)

The atriegc trie dominates and costs per sequence, not per character, so the
per-row figure falls slowly with scale. 4KiB/row carries ~1.5x headroom over
the measured 2.7KiB.

The 32GiB cap is now the binding constraint rather than the multiplier: a
sample of ~8M unique aa CDR3s asks for ~34GiB. Raising it needs the cluster's
node capacity, which is still unconfirmed.

MILAB-6650: cut aggregate.py's footprint and size the aggregation from the dataset

`aggregate.py` is a whole-dataset step — `per_sample.tsv` spans every sample, so
on a large project it is tens of millions of rows — but it ran on a fixed 4GiB
and read far more than it used.

Read less:

- `usecols` — only the four columns the aggregation touches (clonotype key,
  sampleId, the mode's score and hit). `per_sample.tsv` carries every
  convergence column, and `neighbours` / `multiplicity` / `Nb_freq` were being
  parsed into Python strings and never read. Column validation now runs against
  the header (`nrows=0`) so the "missing required columns" error is unchanged.
- `category` dtype for sampleId and the hit column — a handful of distinct
  values over tens of millions of rows, and as text they were the two largest
  objects in the process after the clonotype key (which stays text; that cost is
  irreducible).
- sampleId -> unit is applied to the CATEGORIES and carried by the codes instead
  of inner-merging the universe onto every row, which rebuilt the whole frame to
  add one column with a handful of distinct values. The redundant `.copy()` is
  gone and the source frame is freed before the groupby.

Measured peak RSS after those changes: 1.83 GB at 6M rows (305 B/row), 3.57 GB
at 18M (198 B/row) — the per-row cost falls as fixed overhead amortises.

Size it from the data: both aggregation builders move from `cpu(1).mem("4GiB")`
to `lineCount(per_sample.tsv) * 512 + 2GiB`, clamped to [4GiB, 32GiB]. The cost
is per row rather than per byte (one Python string per row for the clonotype
key), so lineCount is the right metric, and 512 B/row is ~2.5x the measured
figure. The two downstream steps that also see the aggregated per-clonotype
table — the hit-count stats pt workflow and the aggregated `xsv.importFile` —
drop their fixed 2GiB for the SDK's size-adaptive default.

NOTE for reviewers: the Level 1 groupby now passes `observed=True`, and it is
load-bearing rather than cosmetic. `_unit` became a Categorical, and pandas'
default (`observed=False`) emits a row for every category — every unit in the
dataset — including ones a clonotype is absent from. That is precisely the
zero-filling the two-level shape forbids: it inflates k in the Fisher
combination and lowers full-STAR scores (4.0 -> 2.99 on the existing fixtures)
with no error. Caught by `test_absent_units_are_not_zero_filled` and two
siblings; all 60 software tests pass.

Still fixed, deliberately: the cluster-filter step's 4GiB (its memory is
quadratic in the hit count, so a linear budget would not bound it) and the
`processColumn` per-iteration 4GiB.

MILAB-6650: stop small projects reserving 4GiB they never use

compute-neighbours and both aggregation runs asked for `lineCount * N + 2GiB`
clamped to a 4GiB lower bound, so any input below ~524K rows (compute-neighbours)
or ~4.2M rows (aggregate) reserved 4GiB regardless of size. On k8s the declared
RAM is the request AND the limit, so that is quota actually held, not just a
ceiling — small projects serialised more than they needed to.

Base and floor drop from 2GiB/4GiB to 1GiB/1GiB on both. Lowering only the floor
would have achieved nothing: the `+2GiB` base already put the effective minimum
at 2GiB, so the floor had to come down with it.

1GiB covers the interpreter and its imports (~300MB) with headroom; measured
peak at 100K rows is 378MB.

Large inputs are unaffected — there the per-row term dominates and the 32GiB
cap is what binds:

    compute-neighbours 100K rows : 4GiB   -> 1.4GiB   (needs 0.38GiB)
    compute-neighbours   1M rows : 5.8GiB -> 4.8GiB   (needs 2.5GiB)
    compute-neighbours  10M rows : 32GiB  -> 32GiB    (capped, unchanged)
    aggregate            1M rows : 4GiB   -> 1.5GiB   (needs ~0.5GiB)
    aggregate           45M rows : 23.5GiB-> 22.5GiB  (needs ~9GiB)

full-STAR keeps its 2GiB base/floor — same shape, but a 2GiB minimum is far less
wasteful than 4GiB and it was not part of this change. The staticFallback values
are unchanged deliberately: they apply when the backend cannot evaluate formulas
at all, where over-provisioning is the safe direction.

MILAB-6650: let the per-sample output import scale with the sample

`pframes.processColumn` was given `cpu: 2, mem: "4GiB"`. Those options reach a pt
workflow inside the SDK's process-pcolumn-data template, which imports each
sample's output — so the budget was a constant against something that grows with
the sample. It survived a 15.7M-clonotype sample, but only by luck.

The options take static values only (they become `wf.cpu()` / `wf.mem()` on a pt
workflow, which does not accept an `exec.formula`), so the way to make them scale
is to omit them: the SDK then sizes the request from the actual input
(`size * 4 + 2GiB`, clamped to [2GiB, 64GiB]) exactly as it does for every other
unbudgeted pt step in this block.

This also raises the effective ceiling for that step from 4GiB to 64GiB, which is
higher than anything the block's own formulas can request.

MILAB-6650: size the cluster filter from its input, and record what actually limits it

The cluster filter was the last fixed budget (`cpu(1).mem("4GiB")`). It reads the
whole per-sample table, so its memory grows with the sample; it now sizes from
the input like the other per-sample python step (`size * 8 + 1GiB`, clamped to
[1GiB, 32GiB]).

Correcting the record on why it was left fixed earlier: this step was described
in previous changesets as having memory quadratic in the hit count, on the
assumption that DBSCAN with a callable metric materialises an n x n distance
matrix. Measured, that is not what happens — sklearn chunks the pairwise pass and
RSS stays flat:

      400 hits  0.26s  149 MB
      800 hits  1.02s  149 MB
    1,600 hits  4.02s  149 MB

What is quadratic is TIME: DBSCAN calls the Python metric once per pair, at
~1.6us. That extrapolates to ~11 minutes at 20K hits and ~4 hours at 100K, with
memory never becoming the binding constraint. No budget bounds that.

The durable fix, when it is needed: at `eps=1, min_samples=1` DBSCAN is exactly
connected components of the Levenshtein-<=1 graph, so it can be a neighbour join
plus union-find instead of an all-pairs scan. Note the metric is Levenshtein
(`from Levenshtein import distance`), NOT the Hamming-1 relation stage 1 computes
with its trie — indels are included here, so the stage-1 structure cannot be
reused directly. The analogous trick is the deletion-neighbourhood bucket: index
each sequence under itself plus its length-1 deletions, and two sequences are
within Levenshtein-1 iff they share a key.

Every budget in the workflow is now data-scaled; no static `mem` remains.

MILAB-6650: render "Convergence expected at" and its values as one joined control

The metadata column and its value picker were two separate dropdowns with a 6px
gap. They now read as a single control the way the table filters do: the column
dropdown takes `group-position="top"`, the value multiselect `group-position="bottom"`
(both PlDropdown and PlDropdownMulti expose the prop — it squares off the
adjoining corners), and the wrapper's gap is removed so the borders meet.

The lower dropdown loses its "Selected values" label, as the joined form
intends, and carries no placeholder. It is also pulled up 1px
(`margin-top: -1px`) so the two adjoining 1px borders overlap into a single
line instead of stacking into a 2px seam.

MILAB-6650: replace the end-to-end block test with template-level tests

The block test built a real project — Samples & Data -> MiXCR Clonotyping -> this
block — to reach 24 assertions. Only ~5 of them needed a real MiXCR run (that
the block's sibling selectors match the specs MiXCR actually emits); the other
19 needed correctly-shaped PColumns, not MiXCR's specifically. MiXCR's specs
change rarely, and when they do every block reading MiXCR output breaks at once,
so this block is not where that would be discovered — yet the clonotyping run
sat on every CI build behind `test: true`.

`workflow/src/wf.test.ts` now covers the per-sample chain with `tplTest`:
the pt collapse to unique aa CDR3s, compute_neighbours.py, and the pt inner join
back onto the clonotype rows — the path the per-aa rewrite introduced and the
one nothing exercised until now. Three cases: the neighbour arithmetic and the
fan-back-out (two clonotypes sharing an aa CDR3 both receive its stats), rows
with an empty CDR3 dropped without shifting N, and the nMin skip.

Every expected number is derived by hand in the fixture comment rather than
snapshotted, so a wrong answer names itself instead of being re-recorded.

`workflow/src/test-per-sample.tpl.tengo` is the harness that makes this possible:
:per-sample-neighbours takes its slice as PColumn DATA, and a test can only
create JSON values, so the harness materialises a packed TSV, imports it into
the one-axis String column the body expects, and exports the result as a blob.
It is ~2KB and does ship in the workflow's dist, which is the cost of testing a
template that takes a PColumn.

Removed with the old test: the `test` package, its five cross-block dependencies
and 6MB of FASTQ fixtures. The suite now runs in ~17s against a local backend
instead of a MiXCR run with a 900s timeout.

Lost coverage, stated plainly: nothing now checks that the block discovers a
MiXCR dataset through its anchored query, nor that the model's outputs and
tables render in a real project. The first is the trade described above; the
second is a genuine gap that template tests cannot reach.

MILAB-6650: run the software package's pytest suite in CI

The 60 python tests were never executed by `turbo run test` — the software
package had no `test` script, so the suite that pins the vendored fast-STAR
implementation to the paper's published reference
(`test_get_df_equivalence.py`) and covers the aggregation statistics only ran
when someone remembered to invoke pytest by hand.

`software/scripts/run-python-tests.sh` provisions the environment itself,
because the shared Node CI sets up no interpreter and offers no hook to add
one:

  - `uv` present -> ephemeral env from `src/requirements.txt`; uv fetches its
    own Python, so the runner needs nothing else. ~12s warm.
  - `uv` absent  -> a venv under `.cache/`, reused between runs.
  - neither      -> FAILS with an explanatory message rather than skipping. A
    suite that silently skips is worse than none, because it reports green.

UNVERIFIED: whether `hz-ubuntu-dind` (the self-hosted runner this block builds
on) has `uv` or `python3`. Both paths work locally; the first CI run is the
real test. If neither is present the build fails loudly, which is the intended
failure mode — but it is a build failure, so watch the first run.
