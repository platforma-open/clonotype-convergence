---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

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
