---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
---

Cache the compute-neighbours (Stage 1) result with a 24h TTL. Stage 1 is the
expensive, threshold-independent STAR neighbour computation; without a cache
hint its intermediate output was reference-counted away once Stage 2 consumed
it, so changing only the threshold re-ran the whole pipeline. With the TTL, a
threshold change recovers Stage 1 from cache and recomputes only the cheap
downstream stages (observed: ~1h → ~10min on a real project).
