---
'@platforma-open/milaboratories.clonotype-convergence.model': patch
---

Exclude convergence columns produced by other instances of this block from the
main table. The table's anchor enrichment pulls every column sharing the
clonotype axes from the result pool, which surfaced duplicate convergence
columns when another convergence block was upstream. The discovered columns are
now filtered in the model by the `pl7.app/block` domain — keeping this block's
own convergence columns plus all non-convergence enrichment, dropping other
instances'.
