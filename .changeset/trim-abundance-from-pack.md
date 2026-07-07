---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
'@platforma-open/milaboratories.clonotype-convergence.software': patch
---

Drop the unused abundance value from the per-sample packed input. The convergence math uses only the CDR3 sequences (STAR weights by nt-per-aa multiplicity, not read abundance), so the packed carrier is now `aaSeqCDR3|nSeqCDR3`. Abundance still takes part in the pack-input join to supply the sampleId axis (it is the sole 2-axis column), but its value is no longer packed or handed to compute_neighbours. This changes the packed-column content, so existing projects recompute the per-sample step once; results are unchanged.
