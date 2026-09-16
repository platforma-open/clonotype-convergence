---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

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
