---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: stop small projects reserving 4GiB they never use

compute-neighbours and both aggregation runs asked for `lineCount * N + 2GiB`
clamped to a 4GiB lower bound, so any input below ~524K rows (compute-neighbours)
or ~4.2M rows (aggregate) reserved 4GiB regardless of size. On k8s the declared
RAM is the request AND the limit, so that is quota actually held, not just a
ceiling — small projects serialised more than they needed to.

Base and floor drop from 2GiB/4GiB to 1GiB/1GiB on both. Lowering only the floor
would have achieved nothing: the `+2GiB` base already put the effective minimum
at 2GiB, so the floor had to come down with it.

1GiB covers the interpreter and its imports (~300MB) with headroom; measured
peak at 100K rows is 378MB.

Large inputs are unaffected — there the per-row term dominates and the 32GiB
cap is what binds:

    compute-neighbours 100K rows : 4GiB   -> 1.4GiB   (needs 0.38GiB)
    compute-neighbours   1M rows : 5.8GiB -> 4.8GiB   (needs 2.5GiB)
    compute-neighbours  10M rows : 32GiB  -> 32GiB    (capped, unchanged)
    aggregate            1M rows : 4GiB   -> 1.5GiB   (needs ~0.5GiB)
    aggregate           45M rows : 23.5GiB-> 22.5GiB  (needs ~9GiB)

full-STAR keeps its 2GiB base/floor — same shape, but a 2GiB minimum is far less
wasteful than 4GiB and it was not part of this change. The staticFallback values
are unchanged deliberately: they apply when the backend cannot evaluate formulas
at all, where over-provisioning is the safe direction.
