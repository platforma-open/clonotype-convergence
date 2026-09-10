---
"@platforma-open/milaboratories.clonotype-convergence.kind": minor
"@platforma-open/milaboratories.clonotype-convergence.model": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: drop `scoreWeight` from the block's init-params contract

The aggregation no longer carries a score weight — it scores the combined
p-value directly — so `scoreWeight` is gone from the block's data model. The
kind's `BlockParams` and its runtime parser drop it too, and `templateParams`
stops projecting it. A template that still carries a `scoreWeight` value is
rejected by the parser rather than silently ignored.
