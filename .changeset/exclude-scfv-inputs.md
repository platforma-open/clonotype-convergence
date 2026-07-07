---
'@platforma-open/milaboratories.clonotype-convergence.model': patch
---

Don't offer scFv datasets in the input dropdown. scFv clonotyping output is an engineered single-chain (VH-linker-VL) construct that passes as SC-paired IG, so it would otherwise be selectable and silently produce meaningless per-chain convergence — but convergence is for in-vivo repertoires only. Excluded via the `pl7.app/vdj/scFv-sequence` column (the platform's scFv marker), not the unfinished `scClonotypeKey/structure` domain placeholder.
