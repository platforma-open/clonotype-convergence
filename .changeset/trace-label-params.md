---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
'@platforma-open/milaboratories.clonotype-convergence.model': patch
---

Encode the block's settings (threshold(s), nMin when non-default, cluster
filter) into the column trace label so downstream blocks (graph-maker,
data-mapping) can tell apart columns from multiple convergence blocks on the
same dataset — previously they collapsed to identical labels. The page
subtitle and the trace label now derive from one shared builder
(getDefaultBlockLabel): the subtitle prefixes the dataset, the trace omits it
(the dataset is already in the column domain). A user-set block label still
overrides both.
