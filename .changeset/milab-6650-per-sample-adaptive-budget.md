---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: size the per-sample compute budgets from each sample's input

`compute_neighbours.py` was OOM-killed on k8s at its fixed 4GiB once the
preamble stopped failing ahead of it. A per-sample constant is only correct if
it fits the *largest* sample, and 4GiB does not on large projects.

The two pt steps (unpack, hit calling) drop their explicit budgets and fall
back to the SDK's size-adaptive default. The two python steps get an
`exec.formula` over their own input TSV:

- compute-neighbours: `size * 16 + 2GiB`, floored at 4GiB, capped at 32GiB.
  `get_df.py` holds an `atriegc` trie over the sample's unique aa CDR3s, four
  dicts keyed by the same strings, and a merge that rebuilds the frame —
  measured against the TSV's byte count that is roughly 10x, so 16x carries
  headroom.
- full-STAR: `size * 8 + 2GiB`, floored at 2GiB, capped at 32GiB. Numpy arrays
  over the row count, no string-keyed structures.

The 32GiB cap and both multipliers are unverified against a real large project
— they are floors-with-headroom, not measurements, and should be tuned once a
run on the failing project reports actual usage. The cap in particular should
be checked against the cluster's node pool and any `maxRamRequest` setting,
which silently shrinks a larger request before k8s enforces it as a limit.

Changing the compute-neighbours budget invalidates that step's `cacheHours(24)`
pin once, since the quota is part of the rendered template's inputs.

The cluster-filter step keeps its fixed 4GiB: its memory is quadratic in the
hit count (DBSCAN with a callable metric materialises a full pairwise distance
matrix), so a linear formula would not bound it. Tracked separately.
