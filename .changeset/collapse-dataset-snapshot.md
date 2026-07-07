---
'@platforma-open/milaboratories.clonotype-convergence.model': patch
'@platforma-open/milaboratories.clonotype-convergence.ui': patch
---

Collapse the dual input-ref data model into a single dataset snapshot.

There is one input-dataset selector, and in single-cell paired mode both chains are column-domain siblings on the same anchor — so `lightRef` was always equal to the main pick or undefined, and `lightRefFacts` always duplicated the main facts. That vestigial dual-ref structure is removed:

- `mainRef`/`mainRefFacts`/`mainRefLabel` → `datasetRef`/`datasetFacts`/`datasetLabel`.
- `lightRef`/`lightRefFacts` → a single `processLightChain` boolean (the light chain rides the same anchor).
- `UpstreamFacts.axisName` → `clonotypeKeyAxisName` (it is the second/clonotype-key axis name).
- Removed the unused live `mainRefFacts` model output.

A `v1 → v2` data migration maps existing projects (carrying `chains`/`clonotypeKeyAxisName` across), so no behaviour changes and no re-pick is required.
