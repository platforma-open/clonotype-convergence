---
"@platforma-open/milaboratories.clonotype-convergence.software": minor
---

Update build dependencies. Per-isotype neighbour counts come from the whole-sample neighbour pass (`compute_neighbours.py --compartment`), and aggregation can process several column sets in one call (`aggregate.py --set`). A minor bump, not a patch: this PR's CI already published 1.3.3 before these changes, and an existing version is never re-uploaded.
