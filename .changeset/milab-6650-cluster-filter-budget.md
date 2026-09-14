---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: size the cluster filter from its input, and record what actually limits it

The cluster filter was the last fixed budget (`cpu(1).mem("4GiB")`). It reads the
whole per-sample table, so its memory grows with the sample; it now sizes from
the input like the other per-sample python step (`size * 8 + 1GiB`, clamped to
[1GiB, 32GiB]).

Correcting the record on why it was left fixed earlier: this step was described
in previous changesets as having memory quadratic in the hit count, on the
assumption that DBSCAN with a callable metric materialises an n x n distance
matrix. Measured, that is not what happens — sklearn chunks the pairwise pass and
RSS stays flat:

      400 hits  0.26s  149 MB
      800 hits  1.02s  149 MB
    1,600 hits  4.02s  149 MB

What is quadratic is TIME: DBSCAN calls the Python metric once per pair, at
~1.6us. That extrapolates to ~11 minutes at 20K hits and ~4 hours at 100K, with
memory never becoming the binding constraint. No budget bounds that.

The durable fix, when it is needed: at `eps=1, min_samples=1` DBSCAN is exactly
connected components of the Levenshtein-<=1 graph, so it can be a neighbour join
plus union-find instead of an all-pairs scan. Note the metric is Levenshtein
(`from Levenshtein import distance`), NOT the Hamming-1 relation stage 1 computes
with its trie — indels are included here, so the stage-1 structure cannot be
reused directly. The analogous trick is the deletion-neighbourhood bucket: index
each sequence under itself plus its length-1 deletions, and two sequences are
within Levenshtein-1 iff they share a key.

Every budget in the workflow is now data-scaled; no static `mem` remains.
