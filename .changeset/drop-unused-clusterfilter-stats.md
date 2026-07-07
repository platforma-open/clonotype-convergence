---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
---

Drop the unused `stats.json` retention from the per-sample cluster-filter step. The sidecar was saved as content but never read (skipped-samples now come from the per-sample `compute_neighbours` status sidecar), so removing `saveFileContent("stats.json")` is functionally a no-op.
