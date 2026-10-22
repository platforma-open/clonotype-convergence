---
"@platforma-open/milaboratories.clonotype-convergence": major
"@platforma-open/milaboratories.clonotype-convergence.kind": major
"@platforma-open/milaboratories.clonotype-convergence.model": major
"@platforma-open/milaboratories.clonotype-convergence.ui": major
"@platforma-open/milaboratories.clonotype-convergence.workflow": major
---

Columns are stored by their result-pool column ids: the dataset and its subset, the Generation Probability columns found for the dataset, and the expected-filter and replicate metadata columns. The expected values are stored as column value references of the expected-filter column, so the block that produced the metadata knows which of its values this block uses. The model finds columns, builds the options of the dataset and metadata pickers and reads the sample labels through the column collection API instead of the deprecated result pool API, and the workflow takes every column through its column bundle by id. The settings panel reads the expected values from a frame of the expected-filter column alone, and shows why under the picker when they cannot be read.
Opening a project created before this change keeps its dataset, subset, expected-filter and replicate columns, converted to the new ids, and keeps its expected values, converted to column value references of the same expected-filter column. Expected values stored without an expected-filter column name no column and are cleared. The initialization params of the kind carry the same ids and references, so templates made for an earlier version of the kind cannot be applied.
Expected values that are no longer among the values of the expected-filter column stay selected and are marked as not available instead of being removed silently, with a tooltip naming the block that was to provide them, as a link to it, and what went wrong. Picking another expected-filter column now clears the expected values.
