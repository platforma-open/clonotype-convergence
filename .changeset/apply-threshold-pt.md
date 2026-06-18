---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
'@platforma-open/milaboratories.clonotype-convergence.software': patch
---

Replace the apply-threshold Python step with an in-graph `pt` transform.

Stage 2 (threshold → `fastStar`) was a pandas read/rewrite of the full
multi-sample TSV — minutes of I/O on large projects. It now runs as a pure
`pt` (ptabler) template: `fastStar = Nb_freq > threshold`, with the hit-count
stats emitted as a one-row ndjson sidecar (same `{above, total}` contract the
model reads via `getDataAsJson`). Cheap to recompute, so the stage needs no
cache TTL and produces no per-variant accumulation. The `apply-threshold`
software entrypoint and `apply_threshold.py` are removed.
