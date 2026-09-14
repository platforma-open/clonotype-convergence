---
"@platforma-open/milaboratories.clonotype-convergence.software": patch
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

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
