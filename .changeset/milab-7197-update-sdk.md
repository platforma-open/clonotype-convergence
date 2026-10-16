---
"@platforma-open/milaboratories.clonotype-convergence": minor
"@platforma-open/milaboratories.clonotype-convergence.model": minor
"@platforma-open/milaboratories.clonotype-convergence.workflow": minor
---

Update the SDK and build the dataset list with buildDatasetOptions (requireEnrichments: false), replacing the custom merge of datasets and their subset filters. With a subset filter, the input table now has one filtered primary (abundance) with the CDR3 and Pgen columns left-joined onto it, instead of a filtered primary per column. Results are unchanged.
