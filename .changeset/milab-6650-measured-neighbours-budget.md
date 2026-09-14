---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: correct the compute-neighbours budget to the measured per-row cost

The per-aa rewrite made memory scale with unique aa CDR3s, but the budget that
went with it guessed 1KiB per row. Measured on the real code path (synthetic
CDR3-shaped input, peak RSS of the child process):

    100,000 rows ->  378 MB  (3.8 KiB/row)
    300,000 rows ->  928 MB  (3.1 KiB/row)
  1,000,000 rows -> 2721 MB  (2.7 KiB/row)

The atriegc trie dominates and costs per sequence, not per character, so the
per-row figure falls slowly with scale. 4KiB/row carries ~1.5x headroom over
the measured 2.7KiB.

The 32GiB cap is now the binding constraint rather than the multiplier: a
sample of ~8M unique aa CDR3s asks for ~34GiB. Raising it needs the cluster's
node capacity, which is still unconfirmed.
