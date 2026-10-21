---
"@platforma-open/milaboratories.clonotype-convergence": major
"@platforma-open/milaboratories.clonotype-convergence.kind": major
"@platforma-open/milaboratories.clonotype-convergence.model": major
"@platforma-open/milaboratories.clonotype-convergence.ui": major
"@platforma-open/milaboratories.clonotype-convergence.workflow": major
---

Columns are stored by their result-pool column ids: the dataset and its subset, the Generation Probability columns found for the dataset, and the expected-filter and replicate metadata columns. The expected values are stored as column value references of the expected-filter column, so the block that produced the metadata knows which of its values this block uses. The model finds columns, builds the options of the dataset, metadata and expected-value pickers and reads the sample labels through the column collection API instead of the deprecated result pool API, the expected values are read by the model instead of fetched by the settings panel, and the workflow takes every column through its column bundle by id.
Opening a project created before this change keeps its dataset, subset, expected-filter and replicate columns, converted to the new ids, but clears the expected values, since they were stored as plain values, which name no producing block; they have to be picked again, and until they are, the exported aggregate takes every sample. The initialization params of the kind carry the same ids and references, so templates made for an earlier version of the kind cannot be applied.
Expected values that are no longer among the values of the expected-filter column stay selected and are marked as not available instead of being removed silently, with a tooltip naming the block that was to provide them, as a link to it, and what went wrong. Picking another expected-filter column now clears the expected values.
