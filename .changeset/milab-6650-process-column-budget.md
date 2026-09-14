---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

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
